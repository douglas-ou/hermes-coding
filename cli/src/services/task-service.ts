/**
 * TaskService - Business logic for task management
 *
 * Extracts task operations from CLI commands into testable service layer.
 * Uses dependency injection for repositories and logger.
 */

import { Task } from '../domain/task-entity';
import { normalizeTaskDependencyIds, normalizeDependencyInput } from '../core/task-dependencies';
import {
  parseTaskContent,
  validateAuthoringFrontmatter,
  validateTaskForCreation,
  TaskAuthoringError,
} from '../core/task-parser';
import { appendSagaActivityLine } from './progress-txt.service';
import { ITaskRepository } from '../repositories/task-repository';
import { IStateRepository } from '../repositories/state-repository';
import { ILogger } from '../infrastructure/logger';
import { IFileSystem } from '../infrastructure/file-system';

export interface TaskFilter {
  status?: 'pending' | 'in_progress' | 'completed' | 'failed';
  module?: string;
  priority?: number;
  hasDependencies?: boolean;
  ready?: boolean;
}

export interface TaskListOptions {
  filter?: TaskFilter;
  limit?: number;
  offset?: number;
  sort?: 'priority' | 'status' | 'estimatedMinutes';
}

export interface TaskListResult {
  tasks: Task[];
  total: number;
  offset: number;
  limit: number;
  returned: number;
}

export interface CreateTaskInput {
  id: string;
  module: string;
  priority?: number;
  estimatedMinutes?: number;
  description: string;
  acceptanceCriteria?: string[];
  dependencies?: string[];
  testPattern?: string;
}

export interface CreateTaskFromDocumentInput {
  contentFilePath: string;
  /** Optional CLI --module flag; if provided, must match the document's module field. */
  expectedModule?: string;
}

/** Result of getNextTaskWithStatus: indicates whether a task is available, all are done, or remaining tasks are blocked */
export interface NextTaskResult {
  outcome: 'task_found' | 'all_done' | 'blocked';
  task?: Task;
}

/**
 * ITaskService interface for dependency injection
 */
export interface ITaskService {
  /**
   * Create a new task
   */
  createTask(input: CreateTaskInput): Promise<Task>;

  /**
   * Create a new task from a complete markdown document (document mode).
   * The document is validated with authoring-time rules before persistence.
   */
  createTaskFromDocument(input: CreateTaskFromDocumentInput): Promise<Task>;

  /**
   * Get task by ID
   */
  getTask(taskId: string): Promise<Task | null>;

  /**
   * List tasks with filtering and pagination
   */
  listTasks(options?: TaskListOptions): Promise<TaskListResult>;

  /**
   * Get next task to work on (highest priority, dependencies satisfied)
   */
  getNextTask(): Promise<Task | null>;

  /**
   * Start a task (mark as in_progress)
   */
  startTask(taskId: string): Promise<Task>;

  /**
   * Complete a task (mark as completed)
   */
  completeTask(taskId: string, duration?: string): Promise<Task>;

  /**
   * Fail a task (mark as failed)
   */
  failTask(taskId: string, reason: string): Promise<Task>;

  /**
   * Get next task with status information:
   * - 'all_done' if all tasks are terminal (completed/failed)
   * - 'blocked' if pending tasks exist but none have deps satisfied
   * - 'task_found' with the highest-priority ready task
   */
  getNextTaskWithStatus(): Promise<NextTaskResult>;
}

/**
 * TaskService implementation
 */
export class TaskService implements ITaskService {
  constructor(
    private taskRepository: ITaskRepository,
    private stateRepository: IStateRepository,
    private logger: ILogger,
    private fileSystem?: IFileSystem,
    private workspaceDir?: string
  ) {}

  /** Append one task lifecycle entry to .hermes-coding/saga.log. */
  private async logProgress(action: string, taskId: string, details?: string): Promise<void> {
    if (!this.fileSystem || !this.workspaceDir) {
      return;
    }

    try {
      await appendSagaActivityLine(this.fileSystem, this.workspaceDir, action, taskId, details);
    } catch (error) {
      this.logger.warn('Failed to write saga.log', { error });
    }
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    this.logger.info(`Creating task: ${input.id}`);

    // Check if task already exists (index lookup)
    const existing = await this.taskRepository.taskIdExists(input.id);
    if (existing) {
      this.logger.error(`Task already exists: ${input.id}`);
      throw new Error(`Task already exists: ${input.id}`);
    }

    // Check for canonical file conflict (stale index.json)
    const fileExists = await this.taskRepository.canonicalFileExists(input.id, input.module);
    if (fileExists) {
      throw new Error(`Task file already exists at canonical path for: ${input.id}`);
    }

    // Create task entity
    const task = new Task({
      id: input.id,
      module: input.module,
      priority: input.priority ?? 1,
      status: 'pending',
      estimatedMinutes: input.estimatedMinutes ?? 30,
      description: input.description,
      acceptanceCriteria: input.acceptanceCriteria ?? [],
      dependencies: normalizeTaskDependencyIds(input.dependencies ?? []),
      testRequirements: input.testPattern
        ? {
            unit: {
              required: true,
              pattern: input.testPattern,
            },
          }
        : undefined,
      notes: '',
    });

    // Create in repository with create-only semantics.
    await this.taskRepository.create(task);

    this.logger.info(`Task created: ${input.id}`);
    return task;
  }

  async createTaskFromDocument(input: CreateTaskFromDocumentInput): Promise<Task> {
    if (!this.fileSystem) {
      throw new Error('File system is required for document-mode task creation');
    }

    // 1. Read the content file
    let rawContent: string;
    try {
      const raw = await this.fileSystem.readFile(input.contentFilePath, 'utf-8');
      rawContent = typeof raw === 'string' ? raw : raw.toString('utf-8');
    } catch {
      throw new Error(`Content file not found or unreadable: ${input.contentFilePath}`);
    }

    // 2. Validate raw authoring metadata before legacy-compatible parsing coerces values
    const frontmatterViolations = validateAuthoringFrontmatter(rawContent, input.contentFilePath);
    if (frontmatterViolations.length > 0) {
      throw new TaskAuthoringError(
        frontmatterViolations,
        `Task document has ${frontmatterViolations.length} validation error(s)`,
        input.contentFilePath
      );
    }

    // 3. Parse with existing permissive parser
    const config = parseTaskContent(rawContent, input.contentFilePath);

    // 3b. If --module was provided on the CLI, verify it matches the document
    if (input.expectedModule && config.module !== input.expectedModule) {
      throw new TaskAuthoringError(
        [{ field: 'module', reason: `CLI --module is "${input.expectedModule}" but document specifies module "${config.module}"` }],
        `Module mismatch: CLI --module is "${input.expectedModule}" but document specifies module "${config.module}"`,
        input.contentFilePath
      );
    }

    // 4. Run authoring-time validation
    const violations = validateTaskForCreation(config);
    if (violations.length > 0) {
      throw new TaskAuthoringError(
        violations,
        `Task document has ${violations.length} validation error(s)`,
        input.contentFilePath
      );
    }

    // 5. Check for duplicate ID
    const existing = await this.taskRepository.taskIdExists(config.id);
    if (existing) {
      throw new Error(`Task already exists: ${config.id}`);
    }

    // 6. Check for canonical file conflict (stale index.json)
    const fileExists = await this.taskRepository.canonicalFileExists(config.id, config.module);
    if (fileExists) {
      throw new Error(`Task file already exists at canonical path for: ${config.id}`);
    }

    // 7. Normalize dependencies into canonical form
    const normalizedDeps = normalizeDependencyInput(config.dependencies);

    // 8. Persist raw content + update index (with rollback)
    await this.taskRepository.saveRawTaskDocument(rawContent, {
      id: config.id,
      module: config.module,
      status: config.status,
      priority: config.priority,
      description: config.description,
      dependencies: normalizedDeps,
      estimatedMinutes: config.estimatedMinutes,
    });

    this.logger.info(`Task created from document: ${config.id}`);

    // 9. Return a Task entity from the validated config
    return new Task({
      ...config,
      dependencies: normalizedDeps,
    });
  }

  async getTask(taskId: string): Promise<Task | null> {
    this.logger.debug(`Getting task: ${taskId}`);
    return await this.taskRepository.findById(taskId);
  }

  async listTasks(options: TaskListOptions = {}): Promise<TaskListResult> {
    this.logger.debug('Listing tasks', { options });

    const { filter, limit = 100, offset = 0, sort = 'priority' } = options;

    // Get tasks — if ready filter is active, we need ALL tasks to compute
    // completedIds for dependency checking, then filter to pending afterwards.
    // When status filter is also provided, the ready filter handles it.
    const needsAllTasksForReady = filter?.ready;
    const repoFilter = needsAllTasksForReady ? { ...filter, status: undefined } : filter;
    let tasks = await this.taskRepository.findAll(repoFilter);

    // Apply status pre-filter (unless ready handles it)
    if (filter?.status && !needsAllTasksForReady) {
      tasks = tasks.filter((t) => t.status === filter.status);
    }

    // Apply ready filter (requires dependency check)
    // Ready = pending tasks with satisfied dependencies
    if (filter?.ready) {
      const completedIds = new Set(
        tasks.filter((t) => t.status === 'completed').map((t) => t.id)
      );

      tasks = tasks.filter((task) => {
        // Only pending tasks can be ready
        if (task.status !== 'pending') {
          return false;
        }

        // Check if dependencies are satisfied
        if (!task.dependencies || task.dependencies.length === 0) {
          return true;
        }
        return !task.isBlocked(completedIds);
      });
    }

    // Sort tasks
    tasks.sort((a, b) => {
      switch (sort) {
        case 'priority':
          return a.priority - b.priority;
        case 'status':
          return a.status.localeCompare(b.status);
        case 'estimatedMinutes':
          return (a.estimatedMinutes || 0) - (b.estimatedMinutes || 0);
        default:
          return 0;
      }
    });

    // Pagination
    const total = tasks.length;
    const paginatedTasks = tasks.slice(offset, offset + limit);

    return {
      tasks: paginatedTasks,
      total,
      offset,
      limit,
      returned: paginatedTasks.length,
    };
  }

  async getNextTask(): Promise<Task | null> {
    this.logger.debug('Getting next task');

    // Get all pending tasks
    const tasks = await this.taskRepository.findAll({ status: 'pending' });

    if (tasks.length === 0) {
      this.logger.info('No pending tasks found');
      return null;
    }

    // Get completed task IDs for dependency checking
    const allTasks = await this.taskRepository.findAll();
    const completedIds = new Set(
      allTasks.filter((t) => t.status === 'completed').map((t) => t.id)
    );

    // Filter tasks with satisfied dependencies
    const readyTasks = tasks.filter((task) => {
      if (!task.dependencies || task.dependencies.length === 0) {
        return true;
      }
      return !task.isBlocked(completedIds);
    });

    if (readyTasks.length === 0) {
      this.logger.warn('No tasks with satisfied dependencies found');
      return null;
    }

    // Return highest priority task
    readyTasks.sort((a, b) => a.priority - b.priority);
    const nextTask = readyTasks[0];

    this.logger.info(`Next task: ${nextTask.id}`);
    return nextTask;
  }

  async startTask(taskId: string): Promise<Task> {
    this.logger.info(`Starting task: ${taskId}`);

    const task = await this.taskRepository.findById(taskId);
    if (!task) {
      this.logger.error(`Task not found: ${taskId}`);
      throw new Error(`Task not found: ${taskId}`);
    }

    // Idempotent: Already in progress is not an error
    if (task.status === 'in_progress') {
      this.logger.warn(`Task already in progress: ${taskId}`);
      return task;
    }

    // Enforce single-active-task invariant
    const activeTasks = await this.taskRepository.findAll({ status: 'in_progress' });
    if (activeTasks.length > 0) {
      throw new Error(
        `Cannot start task ${taskId}: another task is already in_progress (${activeTasks[0].id})`
      );
    }

    // Start task (validates state transition)
    task.start();

    // Save updated task
    await this.taskRepository.save(task);

    // Update state to track current task
    const state = await this.stateRepository.get();
    if (state) {
      await this.stateRepository.update({ currentTask: taskId });
    }

    // Log to progress log
    await this.logProgress('STARTED', taskId);

    this.logger.info(`Task started: ${taskId}`);
    return task;
  }

  async completeTask(taskId: string, duration?: string): Promise<Task> {
    this.logger.info(`Completing task: ${taskId}`, { duration });

    const task = await this.taskRepository.findById(taskId);
    if (!task) {
      this.logger.error(`Task not found: ${taskId}`);
      throw new Error(`Task not found: ${taskId}`);
    }

    // Idempotent: Already completed is not an error
    if (task.status === 'completed') {
      this.logger.warn(`Task already completed: ${taskId}`);
      return task;
    }

    // Complete task (validates state transition)
    task.complete();

    // Save updated task
    await this.taskRepository.save(task);

    // Update state to clear current task (task is no longer active)
    const state = await this.stateRepository.get();
    if (state && state.currentTask === taskId) {
      await this.stateRepository.update({ currentTask: undefined });
    }

    // Log to progress log
    await this.logProgress('COMPLETED', taskId, duration);

    this.logger.info(`Task completed: ${taskId}`);
    return task;
  }

  async failTask(taskId: string, reason: string): Promise<Task> {
    this.logger.info(`Failing task: ${taskId}`, { reason });

    const task = await this.taskRepository.findById(taskId);
    if (!task) {
      this.logger.error(`Task not found: ${taskId}`);
      throw new Error(`Task not found: ${taskId}`);
    }

    // Fail task (validates state transition)
    task.fail();

    // Save updated task
    await this.taskRepository.save(task);

    // Update state to clear current task (task is no longer active)
    const state = await this.stateRepository.get();
    if (state && state.currentTask === taskId) {
      await this.stateRepository.update({ currentTask: undefined });
    }

    // Log to progress log
    await this.logProgress('FAILED', taskId, reason);

    this.logger.error(`Task failed: ${taskId}`, { reason });
    return task;
  }

  async getNextTaskWithStatus(): Promise<NextTaskResult> {
    this.logger.debug('Getting next task with status');

    const allTasks = await this.taskRepository.findAll();

    // If no tasks at all, treat as all_done
    if (allTasks.length === 0) {
      return { outcome: 'all_done' };
    }

    // Check if all tasks are terminal (completed or failed)
    const allTerminal = allTasks.every((t) => t.isTerminal());
    if (allTerminal) {
      return { outcome: 'all_done' };
    }

    // Get pending tasks
    const pendingTasks = allTasks.filter((t) => t.status === 'pending');
    if (pendingTasks.length === 0) {
      // Non-terminal tasks exist but none are pending (e.g. a stale in_progress with no more pending).
      // Treat as blocked — the loop should not transition to deliver while work is unresolved.
      return { outcome: 'blocked' };
    }

    // Compute completed IDs for dependency checking
    const completedIds = new Set(
      allTasks.filter((t) => t.status === 'completed').map((t) => t.id)
    );

    // Filter to ready tasks (pending with all dependencies satisfied)
    const readyTasks = pendingTasks.filter((task) => {
      if (!task.dependencies || task.dependencies.length === 0) {
        return true;
      }
      return !task.isBlocked(completedIds);
    });

    if (readyTasks.length === 0) {
      return { outcome: 'blocked' };
    }

    // Return highest priority (lowest number) ready task
    readyTasks.sort((a, b) => a.priority - b.priority);
    return { outcome: 'task_found', task: readyTasks[0] };
  }
}
