import { Task } from '../domain/task-entity';

/**
 * Task filter interface for querying tasks
 */
export interface TaskFilter {
  status?: 'pending' | 'in_progress' | 'completed' | 'failed';
  module?: string;
  priority?: number;
}

/**
 * Metadata for persisting a raw task document to index.json.
 */
export interface RawTaskMetadata {
  id: string;
  module: string;
  status: string;
  priority: number;
  description: string;
  dependencies: string[];
  estimatedMinutes?: number;
}

/**
 * Task repository interface for persistence operations
 *
 * This interface abstracts task storage and retrieval,
 * making it easy to swap implementations (file system, database, etc.)
 */
export interface ITaskRepository {
  /**
   * Find task by ID
   * @param taskId - Task identifier
   * @returns Task object or null if not found
   */
  findById(taskId: string): Promise<Task | null>;

  /**
   * Read the raw markdown document for a task.
   * @param taskId - Task identifier
   * @returns Raw task file content or null if the task/file is unavailable
   */
  getTaskFileContent(taskId: string): Promise<string | null>;

  /**
   * Check whether index.json currently contains an entry for a task id.
   * This lookup must not mutate repository state.
   */
  taskIdExists(taskId: string): Promise<boolean>;

  /**
   * Find all tasks matching the filter
   * @param filter - Optional filter criteria
   * @returns Array of tasks matching filter
   */
  findAll(filter?: TaskFilter): Promise<Task[]>;

  /**
   * Save or update a task
   * @param task - Task to save
   */
  save(task: Task): Promise<void>;

  /**
   * Create a new task without overwriting an existing canonical file or index entry.
   * @param task - Task to create
   */
  create(task: Task): Promise<void>;

  /**
   * Delete a task by ID
   * @param taskId - Task identifier to delete
   */
  delete(taskId: string): Promise<void>;

  /**
   * Find the next task to work on (highest priority pending task)
   * @returns Next task or null if no pending tasks
   */
  findNext(): Promise<Task | null>;

  /**
   * Check if a canonical task file exists on disk.
   * Used by document-mode creation to detect file conflicts
   * even when index.json has no matching entry.
   */
  canonicalFileExists(id: string, module: string): Promise<boolean>;

  /**
   * Persist raw task markdown content to the canonical path and
   * update index.json from the provided metadata.
   * Rolls back the task file if the index.json update fails.
   */
  saveRawTaskDocument(rawContent: string, metadata: RawTaskMetadata): Promise<void>;
}
