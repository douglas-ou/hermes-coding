/**
 * Mock Task Repository for Testing
 *
 * Provides in-memory task storage for unit tests.
 * Implements ITaskRepository interface with synchronous operations.
 */

import { ITaskRepository, TaskFilter, RawTaskMetadata } from '../repositories/task-repository';
import { Task } from '../domain/task-entity';

/**
 * Mock implementation of ITaskRepository
 *
 * Stores tasks in memory using a Map for O(1) lookups.
 * Perfect for isolated unit testing without file system dependency.
 */
export class MockTaskRepository implements ITaskRepository {
  private tasks = new Map<string, Task>();
  private taskFileContents = new Map<string, string>();

  async findById(taskId: string): Promise<Task | null> {
    return this.tasks.get(taskId) || null;
  }

  async getTaskFileContent(taskId: string): Promise<string | null> {
    const explicitContent = this.taskFileContents.get(taskId);
    if (explicitContent !== undefined) {
      return explicitContent;
    }

    const task = this.tasks.get(taskId);
    return task ? this.renderTaskContent(task) : null;
  }

  async taskIdExists(taskId: string): Promise<boolean> {
    return this.tasks.has(taskId);
  }

  async findAll(filter?: TaskFilter): Promise<Task[]> {
    let tasks = Array.from(this.tasks.values());

    if (!filter) {
      return tasks;
    }

    // Apply filters
    if (filter.status) {
      tasks = tasks.filter((t) => t.status === filter.status);
    }

    if (filter.module) {
      tasks = tasks.filter((t) => t.module === filter.module);
    }

    if (filter.priority !== undefined) {
      tasks = tasks.filter((t) => t.priority === filter.priority);
    }

    return tasks;
  }

  async save(task: Task): Promise<void> {
    // Create a deep copy using JSON serialization to avoid mutations
    const taskCopy = Task.fromJSON(task.toJSON());
    this.tasks.set(task.id, taskCopy);
  }

  async create(task: Task): Promise<void> {
    if (this.tasks.has(task.id)) {
      throw new Error(`Task already exists: ${task.id}`);
    }
    await this.save(task);
  }

  async delete(taskId: string): Promise<void> {
    this.tasks.delete(taskId);
  }

  async findNext(): Promise<Task | null> {
    const pendingTasks = Array.from(this.tasks.values()).filter(
      (t) => t.status === 'pending'
    );

    if (pendingTasks.length === 0) {
      return null;
    }

    // Sort by priority (ascending) and return first
    pendingTasks.sort((a, b) => a.priority - b.priority);
    return pendingTasks[0];
  }

  async canonicalFileExists(_id: string, _module: string): Promise<boolean> {
    return false;
  }

  async saveRawTaskDocument(_rawContent: string, _metadata: RawTaskMetadata): Promise<void> {
    // No-op in mock — tests that need real persistence use FileSystemTaskRepository
  }

  // Test helper methods

  /**
   * Reset repository to empty state
   */
  reset(): void {
    this.tasks.clear();
    this.taskFileContents.clear();
  }

  /**
   * Get count of tasks in repository
   */
  count(): number {
    return this.tasks.size;
  }

  /**
   * Check if task exists
   */
  has(taskId: string): boolean {
    return this.tasks.has(taskId);
  }

  /**
   * Get all task IDs
   */
  getAllIds(): string[] {
    return Array.from(this.tasks.keys());
  }

  /**
   * Seed repository with test data
   */
  seed(tasks: Task[]): void {
    tasks.forEach((task) => {
      this.tasks.set(task.id, Task.fromJSON(task.toJSON()));
    });
  }

  /**
   * Seed raw markdown content for tests that need exact file contents.
   */
  setTaskFileContent(taskId: string, content: string): void {
    this.taskFileContents.set(taskId, content);
  }

  private renderTaskContent(task: Task): string {
    const lines = [
      '---',
      `id: ${task.id}`,
      `module: ${task.module}`,
      `priority: ${task.priority}`,
      `status: ${task.status}`,
    ];

    if (task.estimatedMinutes !== undefined) {
      lines.push(`estimatedMinutes: ${task.estimatedMinutes}`);
    }

    lines.push('---', '', `# ${task.description}`);

    if (task.acceptanceCriteria.length > 0) {
      lines.push('', '## Acceptance Criteria', '');
      task.acceptanceCriteria.forEach((criterion, index) => {
        lines.push(`${index + 1}. ${criterion}`);
      });
    }

    if (task.notes) {
      lines.push('', '## Notes', '', task.notes);
    }

    return `${lines.join('\n')}\n`;
  }
}
