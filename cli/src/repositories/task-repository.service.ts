import { ITaskRepository, TaskFilter, RawTaskMetadata } from './task-repository';
import { Task, TaskConfig } from '../domain/task-entity';
import { normalizeDependencyInput } from '../core/task-dependencies';
import { parseTaskContent, isPathSafeSegment } from '../core/task-parser';
import { extractTaskFilePath } from '../core/task-writer';
import { IFileSystem } from '../infrastructure/file-system';
import * as path from 'path';
import * as yaml from 'yaml';
import { randomUUID } from 'crypto';

/**
 * Task index structure stored in index.json
 */
interface TaskIndex {
  version: string;
  updatedAt: string;
  metadata: {
    projectGoal: string;
    languageConfig?: any;
  };
  tasks: Record<
    string,
    {
      status: string;
      priority: number;
      module: string;
      description: string;
      filePath?: string;
      dependencies?: string[];
      estimatedMinutes?: number;
    }
  >;
}

/**
 * File system implementation of ITaskRepository
 *
 * Stores tasks as Markdown files with YAML frontmatter in a directory structure.
 * Maintains an index.json file for fast lookups and metadata.
 *
 * Directory structure:
 * - {tasksDir}/
 *   - index.json
 *   - {module}/
 *     - {taskName}.md
 */
export class FileSystemTaskRepository implements ITaskRepository {
  private indexPath: string;

  constructor(
    private fileSystem: IFileSystem,
    private tasksDir: string
  ) {
    this.indexPath = path.join(tasksDir, 'index.json');
  }

  /**
   * Find task by ID
   */
  async findById(taskId: string): Promise<Task | null> {
    try {
      const index = await this.readIndex();
      const taskEntry = index.tasks[taskId];

      if (!taskEntry) {
        return null;
      }

      const taskFilePath = this.getTaskFilePath(taskId, taskEntry.module, taskEntry.filePath);

      // Check if file exists
      const exists = await this.fileSystem.exists(taskFilePath);
      if (!exists) {
        delete index.tasks[taskId];
        await this.writeIndex(index);
        return null;
      }

      // Read and parse task file (markdown frontmatter is source of truth)
      const content = (await this.fileSystem.readFile(taskFilePath, 'utf-8')) as string;
      const task = this.parseTaskFile(content);

      const relativePath = this.relativeFilePathForIndex(task, taskEntry.filePath);
      if (this.indexEntryDiffersFromTask(taskEntry, task)) {
        await this.updateIndex(task, relativePath);
      }

      return task;
    } catch (error) {
      // If index doesn't exist or any other error, return null
      return null;
    }
  }

  /**
   * Read raw task markdown content for prompt generation.
   */
  async getTaskFileContent(taskId: string): Promise<string | null> {
    try {
      const index = await this.readIndex();
      const taskEntry = index.tasks[taskId];

      if (!taskEntry) {
        return null;
      }

      const taskFilePath = this.getTaskFilePath(taskId, taskEntry.module, taskEntry.filePath);
      const exists = await this.fileSystem.exists(taskFilePath);
      if (!exists) {
        return null;
      }

      const content = await this.fileSystem.readFile(taskFilePath, 'utf-8');
      return typeof content === 'string' ? content : content.toString('utf-8');
    } catch (error) {
      return null;
    }
  }

  /**
   * Check whether index.json contains an entry for the given task id without
   * repairing any stale data. Create-mode duplicate checks must be side-effect free.
   */
  async taskIdExists(taskId: string): Promise<boolean> {
    const index = await this.readIndex();
    return Boolean(index.tasks[taskId]);
  }

  /**
   * Find all tasks matching the filter
   */
  async findAll(filter?: TaskFilter): Promise<Task[]> {
    try {
      const index = await this.readIndex();
      const tasks: Task[] = [];

      // Load from disk and reconcile index; filter on parsed tasks so index.json
      // cannot drift from frontmatter for status/module/priority.
      const taskIds = Object.keys(index.tasks);

      for (const taskId of taskIds) {
        const task = await this.findById(taskId);
        if (!task) {
          continue;
        }

        if (filter?.status && task.status !== filter.status) {
          continue;
        }

        if (filter?.module && task.module !== filter.module) {
          continue;
        }

        if (filter?.priority !== undefined && task.priority !== filter.priority) {
          continue;
        }

        tasks.push(task);
      }

      return tasks;
    } catch (error) {
      // If index doesn't exist, return empty array
      return [];
    }
  }

  /**
   * Save or update a task.
   *
   * For existing files: update only runtime frontmatter fields while preserving
   * unknown frontmatter keys and the full body.
   * For new files: generate the full canonical file layout.
   */
  async save(task: Task): Promise<void> {
    const taskFilePath = extractTaskFilePath(task.id, task.module, this.tasksDir);

    await this.fileSystem.ensureDir(path.dirname(taskFilePath));

    let content: string;
    const exists = await this.fileSystem.exists(taskFilePath);

    if (exists) {
      const existing = (await this.fileSystem.readFile(taskFilePath, 'utf-8')) as string;
      content = this.mergeTaskFile(existing, task);
    } else {
      content = this.generateTaskFile(task);
    }

    await this.fileSystem.writeFile(taskFilePath, content, { encoding: 'utf-8' });
    const fileName = task.id.replace(`${task.module}.`, '') + '.md';
    await this.updateIndex(task, path.join(task.module, fileName));
  }

  /**
   * Create a new task without overwriting an existing canonical file or index entry.
   */
  async create(task: Task): Promise<void> {
    const { canonicalPath, relativePath } = this.resolveCanonicalTaskPath(task.id, task.module);
    const content = this.generateTaskFile(task);

    await this.publishNewTaskFile(canonicalPath, content);

    try {
      await this.addIndexEntry(task, relativePath);
    } catch (error) {
      try {
        await this.fileSystem.remove(canonicalPath);
      } catch (rollbackError) {
        throw new Error(
          `Task file written but index update failed. ` +
          `Recoverable conflict at: ${canonicalPath}. ` +
          `Original error: ${(error as Error).message}. ` +
          `Rollback error: ${(rollbackError as Error).message}`
        );
      }
      throw new Error(
        `Index update failed, task file rolled back. ` +
        `Original error: ${(error as Error).message}`
      );
    }
  }

  /**
   * Delete a task by ID
   */
  async delete(taskId: string): Promise<void> {
    try {
      const index = await this.readIndex();
      const taskEntry = index.tasks[taskId];

      if (!taskEntry) {
        // Task doesn't exist in index, nothing to delete
        return;
      }

      // Delete task file
      const taskFilePath = this.getTaskFilePath(taskId, taskEntry.module, taskEntry.filePath);
      const exists = await this.fileSystem.exists(taskFilePath);
      if (exists) {
        await this.fileSystem.remove(taskFilePath);
      }

      // Remove from index
      delete index.tasks[taskId];
      await this.writeIndex(index);
    } catch (error) {
      // Silently handle errors (task might not exist)
    }
  }

  /**
   * Find the next task to work on (highest priority pending task)
   */
  async findNext(): Promise<Task | null> {
    try {
      const tasks = await this.findAll();
      const candidates = tasks
        .filter((t) => t.status === 'pending' || t.status === 'in_progress')
        .sort((a, b) => a.priority - b.priority);

      return candidates[0] ?? null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Read index.json file
   */
  private async readIndex(): Promise<TaskIndex> {
    const exists = await this.fileSystem.exists(this.indexPath);

    if (!exists) {
      return {
        version: '1.0.0',
        updatedAt: new Date().toISOString(),
        metadata: {
          projectGoal: '',
        },
        tasks: {},
      };
    }

    const content = (await this.fileSystem.readFile(this.indexPath, 'utf-8')) as string;
    return JSON.parse(content);
  }

  /**
   * Write index.json file
   */
  private async writeIndex(index: TaskIndex): Promise<void> {
    index.updatedAt = new Date().toISOString();
    await this.fileSystem.ensureDir(path.dirname(this.indexPath));
    await this.fileSystem.writeFile(this.indexPath, JSON.stringify(index, null, 2), {
      encoding: 'utf-8',
    });
  }

  /**
   * Update index with task information
   */
  private async updateIndex(task: Task, relativeFilePath: string): Promise<void> {
    const index = await this.readIndex();

    index.tasks[task.id] = {
      status: task.status,
      priority: task.priority,
      module: task.module,
      description: task.description,
      filePath: relativeFilePath,
      dependencies: task.dependencies,
      estimatedMinutes: task.estimatedMinutes,
    };

    await this.writeIndex(index);
  }

  /**
   * Add a task to index.json without replacing an existing entry.
   */
  private async addIndexEntry(task: Task, relativeFilePath: string): Promise<void> {
    const index = await this.readIndex();

    if (index.tasks[task.id]) {
      throw new Error(`Task already exists in index: ${task.id}`);
    }

    index.tasks[task.id] = {
      status: task.status,
      priority: task.priority,
      module: task.module,
      description: task.description,
      filePath: relativeFilePath,
      dependencies: task.dependencies,
      estimatedMinutes: task.estimatedMinutes,
    };

    await this.writeIndex(index);
  }

  /**
   * Relative path stored in index.json (e.g. auth/login.md)
   */
  private relativeFilePathForIndex(task: Task, entryFilePath?: string): string {
    if (entryFilePath) {
      return entryFilePath;
    }
    const fileName = task.id.replace(`${task.module}.`, '') + '.md';
    return path.join(task.module, fileName);
  }

  /**
   * True when index.json entry does not match the task loaded from markdown frontmatter.
   */
  private indexEntryDiffersFromTask(
    entry: TaskIndex['tasks'][string],
    task: Task
  ): boolean {
    if (entry.status !== task.status) {
      return true;
    }
    if (entry.priority !== task.priority) {
      return true;
    }
    if (entry.module !== task.module) {
      return true;
    }
    if (entry.description !== task.description) {
      return true;
    }
    if ((entry.estimatedMinutes ?? undefined) !== (task.estimatedMinutes ?? undefined)) {
      return true;
    }

    const fromIndex = entry.dependencies ?? [];
    const fromTask = task.dependencies ?? [];
    if (fromIndex.length !== fromTask.length) {
      return true;
    }
    return fromIndex.some((id, i) => id !== fromTask[i]);
  }

  /**
   * Get task file path from task ID and module
   */
  private getTaskFilePath(taskId: string, module: string, relativeFilePath?: string): string {
    if (relativeFilePath) {
      return path.join(this.tasksDir, relativeFilePath);
    }

    return extractTaskFilePath(taskId, module, this.tasksDir);
  }

  /**
   * Check if a canonical task file exists on disk.
   */
  async canonicalFileExists(id: string, module: string): Promise<boolean> {
    const { canonicalPath } = this.resolveCanonicalTaskPath(id, module);
    return this.fileSystem.exists(canonicalPath);
  }

  private deriveTaskFileStem(id: string, module: string): string {
    return id.replace(`${module}.`, '');
  }

  private resolveCanonicalTaskPath(id: string, module: string): {
    canonicalPath: string;
    relativePath: string;
  } {
    const name = this.deriveTaskFileStem(id, module);
    const fileName = name + '.md';

    if (!isPathSafeSegment(module)) {
      throw new Error(`Module "${module}" contains path-unsafe characters`);
    }
    if (!isPathSafeSegment(name)) {
      throw new Error(`Task name "${name}" contains path-unsafe characters`);
    }

    const canonicalPath = path.join(this.tasksDir, module, fileName);
    const resolvedPath = path.resolve(canonicalPath);
    const resolvedTasksDir = path.resolve(this.tasksDir);
    if (!resolvedPath.startsWith(resolvedTasksDir + path.sep)) {
      throw new Error('Resolved path escapes the tasks directory');
    }

    return {
      canonicalPath,
      relativePath: path.join(module, fileName),
    };
  }

  private async publishNewTaskFile(canonicalPath: string, content: string): Promise<void> {
    const tmpPath = `${canonicalPath}.${process.pid}.${randomUUID()}.tmp`;
    await this.fileSystem.ensureDir(path.dirname(canonicalPath));
    await this.fileSystem.writeFileNoClobber(tmpPath, content, { encoding: 'utf-8' });

    try {
      await this.fileSystem.renameNoClobber(tmpPath, canonicalPath);
    } catch (error) {
      try {
        await this.fileSystem.remove(tmpPath);
      } catch {
        // Best-effort temp cleanup only.
      }

      const err = error as NodeJS.ErrnoException;
      if (err.code === 'EEXIST') {
        throw new Error('Task file already exists at canonical path');
      }
      throw error;
    }
  }

  /**
   * Persist raw task markdown content to the canonical path and update
   * index.json. Uses a temp-file publish step that fails if the canonical
   * destination already exists, preserving create-only semantics.
   * Rolls back the task file if the index update fails.
   */
  async saveRawTaskDocument(rawContent: string, metadata: RawTaskMetadata): Promise<void> {
    const { id, module } = metadata;
    const { canonicalPath, relativePath } = this.resolveCanonicalTaskPath(id, module);

    try {
      await this.publishNewTaskFile(canonicalPath, rawContent);
    } catch (error) {
      if (error instanceof Error && error.message.includes('canonical path')) {
        throw new Error(`Task file already exists at canonical path for: ${id}`);
      }
      throw error;
    }

    // Update index.json with rollback on failure
    try {
      const index = await this.readIndex();
      if (index.tasks[id]) {
        throw new Error(`Task already exists in index: ${id}`);
      }

      index.tasks[id] = {
        status: metadata.status,
        priority: metadata.priority,
        module: metadata.module,
        description: metadata.description,
        filePath: relativePath,
        dependencies: metadata.dependencies,
        estimatedMinutes: metadata.estimatedMinutes,
      };
      await this.writeIndex(index);
    } catch (error) {
      // Rollback: remove the just-written canonical file
      try {
        await this.fileSystem.remove(canonicalPath);
      } catch (rollbackError) {
        throw new Error(
          `Task file written but index update failed. ` +
          `Recoverable conflict at: ${canonicalPath}. ` +
          `Original error: ${(error as Error).message}. ` +
          `Rollback error: ${(rollbackError as Error).message}`
        );
      }
      throw new Error(
        `Index update failed, task file rolled back. ` +
        `Original error: ${(error as Error).message}`
      );
    }
  }

  /**
   * Parse task file content using the centralized parser.
   */
  private parseTaskFile(content: string): Task {
    const taskConfig = parseTaskContent(content);

    // Normalize dependencies from raw YAML input
    const config: TaskConfig = {
      ...taskConfig,
      dependencies: normalizeDependencyInput(taskConfig.dependencies),
    };

    return new Task(config);
  }

  /**
   * Update runtime lifecycle fields in an existing task file's YAML frontmatter.
   * Body and author-managed frontmatter fields are left untouched.
   * Falls back to full rewrite if the existing file can't be parsed.
   */
  private mergeTaskFile(existingContent: string, task: Task): string {
    const lineEnding = existingContent.includes('\r\n') ? '\r\n' : '\n';
    const lines = existingContent.split(/\r?\n/);

    const firstDelimiter = lines.findIndex((l) => l.trim() === '---');
    const secondDelimiter = lines.findIndex(
      (l, i) => i > firstDelimiter && l.trim() === '---'
    );

    if (firstDelimiter === -1 || secondDelimiter === -1) {
      return this.generateTaskFile(task);
    }

    try {
      parseTaskContent(existingContent);
    } catch {
      return this.generateTaskFile(task);
    }

    const runtimeFieldReplacements: Record<string, string | undefined> = {
      status: task.status,
      startedAt: this.serializeRuntimeTimestamp(task.startedAt),
      completedAt: this.serializeRuntimeTimestamp(task.completedAt),
      failedAt: this.serializeRuntimeTimestamp(task.failedAt),
    };
    const seenFields = new Set<string>();

    for (let i = firstDelimiter + 1; i < secondDelimiter; i++) {
      for (const [field, value] of Object.entries(runtimeFieldReplacements)) {
        const fieldRegex = new RegExp(`^${field}\\s*:`);
        if (fieldRegex.test(lines[i])) {
          seenFields.add(field);
          if (value === undefined) {
            lines.splice(i, 1);
            i--;
          } else {
            lines[i] = `${field}: ${value}`;
          }
          break;
        }
      }
    }

    const fieldsToInsert = Object.entries(runtimeFieldReplacements)
      .filter(([field, value]) => value !== undefined && !seenFields.has(field))
      .map(([field, value]) => `${field}: ${value}`);

    if (fieldsToInsert.length > 0) {
      lines.splice(secondDelimiter, 0, ...fieldsToInsert);
    }

    return lines.join(lineEnding);
  }

  /**
   * Generate task file content (YAML frontmatter + Markdown body)
   */
  private generateTaskFile(task: Task): string {
    // Build frontmatter
    const frontmatter: any = {
      id: task.id,
      module: task.module,
      priority: task.priority,
      status: task.status,
    };

    if (task.estimatedMinutes !== undefined) {
      frontmatter.estimatedMinutes = task.estimatedMinutes;
    }

    if (task.dependencies && task.dependencies.length > 0) {
      frontmatter.dependencies = task.dependencies;
    }

    if (task.parallelGroup !== undefined) {
      frontmatter.parallelGroup = task.parallelGroup;
    }

    if (task.testRequirements) {
      frontmatter.testRequirements = task.testRequirements;
    }

    const startedAt = this.serializeRuntimeTimestamp(task.startedAt);
    if (startedAt) {
      frontmatter.startedAt = startedAt;
    }

    const completedAt = this.serializeRuntimeTimestamp(task.completedAt);
    if (completedAt) {
      frontmatter.completedAt = completedAt;
    }

    const failedAt = this.serializeRuntimeTimestamp(task.failedAt);
    if (failedAt) {
      frontmatter.failedAt = failedAt;
    }

    const frontmatterStr = yaml.stringify(frontmatter);

    // Build body
    let body = `# ${task.description}\n\n`;

    if (task.acceptanceCriteria && task.acceptanceCriteria.length > 0) {
      body += '## Acceptance Criteria\n';
      task.acceptanceCriteria.forEach((criterion, index) => {
        body += `${index + 1}. ${criterion}\n`;
      });
      body += '\n';
    }

    return `---\n${frontmatterStr}---\n\n${body}`;
  }

  private serializeRuntimeTimestamp(value: Date | string | undefined): string | undefined {
    if (!value) {
      return undefined;
    }

    return value instanceof Date ? value.toISOString() : value;
  }
}
