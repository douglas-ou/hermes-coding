import { describe, it, expect, beforeEach } from 'vitest';
import { TaskService, CreateTaskInput } from '../../src/services/task-service';
import { Task } from '../../src/domain/task-entity';
import { State } from '../../src/domain/state-entity';
import { MockTaskRepository, MockStateRepository, MockLogger } from '../../src/test-utils';

describe('TaskService', () => {
  let taskRepo: MockTaskRepository;
  let stateRepo: MockStateRepository;
  let logger: MockLogger;
  let service: TaskService;

  beforeEach(() => {
    taskRepo = new MockTaskRepository();
    stateRepo = new MockStateRepository();
    logger = new MockLogger();
    service = new TaskService(taskRepo, stateRepo, logger);
  });

  describe('createTask', () => {
    it('should create task with all fields', async () => {
      // Arrange
      const input: CreateTaskInput = {
        id: 'auth.login',
        module: 'auth',
        priority: 2,
        estimatedMinutes: 25,
        description: 'Implement login feature',
        acceptanceCriteria: ['Criterion 1', 'Criterion 2'],
        dependencies: ['setup.scaffold'],
        testPattern: '**/*.test.ts',
      };

      // Act
      const task = await service.createTask(input);

      // Assert
      expect(task.id).toBe('auth.login');
      expect(task.module).toBe('auth');
      expect(task.priority).toBe(2);
      expect(task.status).toBe('pending');
      expect(task.estimatedMinutes).toBe(25);
      expect(task.description).toBe('Implement login feature');
      expect(task.acceptanceCriteria).toEqual(['Criterion 1', 'Criterion 2']);
      expect(task.dependencies).toEqual(['setup.scaffold']);
      expect(task.testRequirements).toBeDefined();
    });

    it('should normalize comma-separated and repeated dependency tokens', async () => {
      const input: CreateTaskInput = {
        id: 'auth.login',
        module: 'auth',
        description: 'Login',
        dependencies: ['setup.a, setup.b', 'setup.b', '  '],
      };

      const task = await service.createTask(input);

      expect(task.dependencies).toEqual(['setup.a', 'setup.b']);
    });

    it('should create task with default values', async () => {
      // Arrange
      const input: CreateTaskInput = {
        id: 'simple.task',
        module: 'simple',
        description: 'Simple task',
      };

      // Act
      const task = await service.createTask(input);

      // Assert
      expect(task.priority).toBe(1); // Default
      expect(task.estimatedMinutes).toBe(30); // Default
      expect(task.acceptanceCriteria).toEqual([]);
      expect(task.dependencies).toEqual([]);
      expect(task.testRequirements).toBeUndefined();
    });

    it('should throw error when task already exists', async () => {
      // Arrange
      const existing = new Task({
        id: 'duplicate.task',
        module: 'test',
        priority: 1,
        status: 'pending',
        estimatedMinutes: 30,
        description: 'Existing task',
        acceptanceCriteria: [],
        dependencies: [],
        notes: '',
      });
      await taskRepo.save(existing);

      const input: CreateTaskInput = {
        id: 'duplicate.task',
        module: 'test',
        description: 'Duplicate task',
      };

      // Act & Assert
      await expect(service.createTask(input)).rejects.toThrow('Task already exists: duplicate.task');
    });

    it('should log task creation', async () => {
      // Arrange
      const input: CreateTaskInput = {
        id: 'test.task',
        module: 'test',
        description: 'Test task',
      };

      // Act
      await service.createTask(input);

      // Assert
      expect(logger.wasInfoCalledWith('Creating task: test.task')).toBe(true);
      expect(logger.wasInfoCalledWith('Task created: test.task')).toBe(true);
    });
  });

  describe('getTask', () => {
    it('should return task when found', async () => {
      // Arrange
      const task = new Task({
        id: 'existing.task',
        module: 'test',
        priority: 1,
        status: 'pending',
        estimatedMinutes: 30,
        description: 'Existing task',
        acceptanceCriteria: [],
        dependencies: [],
        notes: '',
      });
      await taskRepo.save(task);

      // Act
      const result = await service.getTask('existing.task');

      // Assert
      expect(result).toBeDefined();
      expect(result?.id).toBe('existing.task');
    });

    it('should return null when task not found', async () => {
      // Act
      const result = await service.getTask('nonexistent.task');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('listTasks', () => {
    beforeEach(async () => {
      // Add sample tasks
      await taskRepo.save(
        new Task({
          id: 'task1',
          module: 'auth',
          priority: 1,
          status: 'pending',
          estimatedMinutes: 30,
          description: 'Task 1',
          acceptanceCriteria: [],
          dependencies: [],
          notes: '',
        })
      );
      await taskRepo.save(
        new Task({
          id: 'task2',
          module: 'auth',
          priority: 2,
          status: 'completed',
          estimatedMinutes: 20,
          description: 'Task 2',
          acceptanceCriteria: [],
          dependencies: [],
          notes: '',
        })
      );
      await taskRepo.save(
        new Task({
          id: 'task3',
          module: 'api',
          priority: 3,
          status: 'pending',
          estimatedMinutes: 40,
          description: 'Task 3',
          acceptanceCriteria: [],
          dependencies: ['task2'],
          notes: '',
        })
      );
    });

    it('should list all tasks with default options', async () => {
      // Act
      const result = await service.listTasks();

      // Assert
      expect(result.total).toBe(3);
      expect(result.returned).toBe(3);
      expect(result.offset).toBe(0);
      expect(result.limit).toBe(100);
      expect(result.tasks).toHaveLength(3);
    });

    it('should filter tasks by status', async () => {
      // Act
      const result = await service.listTasks({
        filter: { status: 'pending' },
      });

      // Assert
      expect(result.total).toBe(2);
      expect(result.tasks.every((t) => t.status === 'pending')).toBe(true);
    });

    it('should filter tasks by module', async () => {
      // Act
      const result = await service.listTasks({
        filter: { module: 'auth' },
      });

      // Assert
      expect(result.total).toBe(2);
      expect(result.tasks.every((t) => t.module === 'auth')).toBe(true);
    });

    it('should filter tasks by priority', async () => {
      // Act
      const result = await service.listTasks({
        filter: { priority: 1 },
      });

      // Assert
      expect(result.total).toBe(1);
      expect(result.tasks[0].priority).toBe(1);
    });

    it('should filter ready tasks (dependencies satisfied)', async () => {
      // Act
      const result = await service.listTasks({
        filter: { ready: true },
      });

      // Assert
      // task1 has no dependencies → ready
      // task2 is completed → not ready
      // task3 depends on task2 (completed) → ready
      expect(result.total).toBe(2);
      const ids = result.tasks.map((t) => t.id);
      expect(ids).toContain('task1');
      expect(ids).toContain('task3');
    });

    it('should sort tasks by priority', async () => {
      // Act
      const result = await service.listTasks({
        sort: 'priority',
      });

      // Assert
      expect(result.tasks[0].priority).toBe(1);
      expect(result.tasks[1].priority).toBe(2);
      expect(result.tasks[2].priority).toBe(3);
    });

    it('should sort tasks by status', async () => {
      // Act
      const result = await service.listTasks({
        sort: 'status',
      });

      // Assert
      expect(result.tasks[0].status).toBe('completed');
      expect(result.tasks[1].status).toBe('pending');
      expect(result.tasks[2].status).toBe('pending');
    });

    it('should sort tasks by estimatedMinutes', async () => {
      // Act
      const result = await service.listTasks({
        sort: 'estimatedMinutes',
      });

      // Assert
      expect(result.tasks[0].estimatedMinutes).toBe(20);
      expect(result.tasks[1].estimatedMinutes).toBe(30);
      expect(result.tasks[2].estimatedMinutes).toBe(40);
    });

    it('should paginate tasks', async () => {
      // Act
      const result = await service.listTasks({
        offset: 1,
        limit: 1,
      });

      // Assert
      expect(result.total).toBe(3);
      expect(result.returned).toBe(1);
      expect(result.offset).toBe(1);
      expect(result.limit).toBe(1);
      expect(result.tasks).toHaveLength(1);
    });
  });

  describe('getNextTask', () => {
    it('should return highest priority task with no dependencies', async () => {
      // Arrange
      await taskRepo.save(
        new Task({
          id: 'task1',
          module: 'test',
          priority: 2,
          status: 'pending',
          estimatedMinutes: 30,
          description: 'Task 1',
          acceptanceCriteria: [],
          dependencies: [],
          notes: '',
        })
      );
      await taskRepo.save(
        new Task({
          id: 'task2',
          module: 'test',
          priority: 1,
          status: 'pending',
          estimatedMinutes: 30,
          description: 'Task 2',
          acceptanceCriteria: [],
          dependencies: [],
          notes: '',
        })
      );

      // Act
      const nextTask = await service.getNextTask();

      // Assert
      expect(nextTask).toBeDefined();
      expect(nextTask?.id).toBe('task2'); // Lower priority number = higher priority
    });

    it('should skip tasks with unsatisfied dependencies', async () => {
      // Arrange
      await taskRepo.save(
        new Task({
          id: 'task1',
          module: 'test',
          priority: 1,
          status: 'pending',
          estimatedMinutes: 30,
          description: 'Task 1',
          acceptanceCriteria: [],
          dependencies: ['task2'], // Blocked
          notes: '',
        })
      );
      await taskRepo.save(
        new Task({
          id: 'task2',
          module: 'test',
          priority: 2,
          status: 'pending', // Not completed
          estimatedMinutes: 30,
          description: 'Task 2',
          acceptanceCriteria: [],
          dependencies: [],
          notes: '',
        })
      );

      // Act
      const nextTask = await service.getNextTask();

      // Assert
      expect(nextTask).toBeDefined();
      expect(nextTask?.id).toBe('task2'); // task1 is blocked
    });

    it('should return task with satisfied dependencies', async () => {
      // Arrange
      await taskRepo.save(
        new Task({
          id: 'task1',
          module: 'test',
          priority: 1,
          status: 'pending',
          estimatedMinutes: 30,
          description: 'Task 1',
          acceptanceCriteria: [],
          dependencies: ['task2'], // Dependency satisfied
          notes: '',
        })
      );
      await taskRepo.save(
        new Task({
          id: 'task2',
          module: 'test',
          priority: 2,
          status: 'completed', // Completed
          estimatedMinutes: 30,
          description: 'Task 2',
          acceptanceCriteria: [],
          dependencies: [],
          notes: '',
        })
      );

      // Act
      const nextTask = await service.getNextTask();

      // Assert
      expect(nextTask).toBeDefined();
      expect(nextTask?.id).toBe('task1');
    });

    it('should return null when no pending tasks', async () => {
      // Arrange
      await taskRepo.save(
        new Task({
          id: 'task1',
          module: 'test',
          priority: 1,
          status: 'completed',
          estimatedMinutes: 30,
          description: 'Task 1',
          acceptanceCriteria: [],
          dependencies: [],
          notes: '',
        })
      );

      // Act
      const nextTask = await service.getNextTask();

      // Assert
      expect(nextTask).toBeNull();
    });

    it('should return null when all tasks are blocked', async () => {
      // Arrange
      await taskRepo.save(
        new Task({
          id: 'task1',
          module: 'test',
          priority: 1,
          status: 'pending',
          estimatedMinutes: 30,
          description: 'Task 1',
          acceptanceCriteria: [],
          dependencies: ['task2'], // Blocked
          notes: '',
        })
      );
      await taskRepo.save(
        new Task({
          id: 'task2',
          module: 'test',
          priority: 2,
          status: 'pending', // Not completed
          estimatedMinutes: 30,
          description: 'Task 2',
          acceptanceCriteria: [],
          dependencies: ['task1'], // Circular dependency
          notes: '',
        })
      );

      // Act
      const nextTask = await service.getNextTask();

      // Assert
      expect(nextTask).toBeNull();
    });
  });

  describe('startTask', () => {
    it('should start pending task', async () => {
      // Arrange
      const task = new Task({
        id: 'test.task',
        module: 'test',
        priority: 1,
        status: 'pending',
        estimatedMinutes: 30,
        description: 'Test task',
        acceptanceCriteria: [],
        dependencies: [],
        notes: '',
      });
      await taskRepo.save(task);

      const state = State.createNew();
      stateRepo.setState(state);

      // Act
      const result = await service.startTask('test.task');

      // Assert
      expect(result.status).toBe('in_progress');
      expect(result.startedAt).toBeDefined();
    });

    it('should be idempotent when task already in progress', async () => {
      // Arrange
      const task = new Task({
        id: 'test.task',
        module: 'test',
        priority: 1,
        status: 'in_progress',
        estimatedMinutes: 30,
        description: 'Test task',
        acceptanceCriteria: [],
        dependencies: [],
        notes: '',
      });
      await taskRepo.save(task);

      // Act
      const result = await service.startTask('test.task');

      // Assert
      expect(result.status).toBe('in_progress');
      expect(logger.warnCalls.some((l) => l.message.includes('already in progress'))).toBe(true);
    });

    it('should throw error when task not found', async () => {
      // Act & Assert
      await expect(service.startTask('nonexistent.task')).rejects.toThrow(
        'Task not found: nonexistent.task'
      );
    });

    it('should update state with current task', async () => {
      // Arrange
      const task = new Task({
        id: 'test.task',
        module: 'test',
        priority: 1,
        status: 'pending',
        estimatedMinutes: 30,
        description: 'Test task',
        acceptanceCriteria: [],
        dependencies: [],
        notes: '',
      });
      await taskRepo.save(task);

      const state = State.createNew();
      stateRepo.setState(state);

      // Act
      await service.startTask('test.task');

      // Assert
      const updatedState = await stateRepo.get();
      expect(updatedState?.currentTask).toBe('test.task');
    });
  });

  describe('completeTask', () => {
    it('should complete in_progress task', async () => {
      // Arrange
      const task = new Task({
        id: 'test.task',
        module: 'test',
        priority: 1,
        status: 'in_progress',
        estimatedMinutes: 30,
        description: 'Test task',
        acceptanceCriteria: [],
        dependencies: [],
        notes: '',
      });
      await taskRepo.save(task);

      // Act
      const result = await service.completeTask('test.task');

      // Assert
      expect(result.status).toBe('completed');
      expect(result.completedAt).toBeDefined();
    });

    it('should complete task with duration note', async () => {
      // Arrange
      const task = new Task({
        id: 'test.task',
        module: 'test',
        priority: 1,
        status: 'in_progress',
        estimatedMinutes: 30,
        description: 'Test task',
        acceptanceCriteria: [],
        dependencies: [],
        notes: '',
      });
      await taskRepo.save(task);

      // Act
      const result = await service.completeTask('test.task', '5m30s');

      // Assert
      expect(result.status).toBe('completed');
    });

    it('should be idempotent when task already completed', async () => {
      // Arrange
      const task = new Task({
        id: 'test.task',
        module: 'test',
        priority: 1,
        status: 'completed',
        estimatedMinutes: 30,
        description: 'Test task',
        acceptanceCriteria: [],
        dependencies: [],
        notes: '',
      });
      await taskRepo.save(task);

      // Act
      const result = await service.completeTask('test.task');

      // Assert
      expect(result.status).toBe('completed');
      expect(logger.warnCalls.some((l) => l.message.includes('already completed'))).toBe(true);
    });

    it('should throw error when task not found', async () => {
      // Act & Assert
      await expect(service.completeTask('nonexistent.task')).rejects.toThrow(
        'Task not found: nonexistent.task'
      );
    });
  });

  describe('failTask', () => {
    it('should fail in_progress task with reason', async () => {
      // Arrange
      const task = new Task({
        id: 'test.task',
        module: 'test',
        priority: 1,
        status: 'in_progress',
        estimatedMinutes: 30,
        description: 'Test task',
        acceptanceCriteria: [],
        dependencies: [],
        notes: '',
      });
      await taskRepo.save(task);

      // Act
      const result = await service.failTask('test.task', 'Build error');

      // Assert
      expect(result.status).toBe('failed');
    });

    it('should throw error when task not found', async () => {
      // Act & Assert
      await expect(service.failTask('nonexistent.task', 'Some reason')).rejects.toThrow(
        'Task not found: nonexistent.task'
      );
    });

    it('should log error when task fails', async () => {
      // Arrange
      const task = new Task({
        id: 'test.task',
        module: 'test',
        priority: 1,
        status: 'in_progress',
        estimatedMinutes: 30,
        description: 'Test task',
        acceptanceCriteria: [],
        dependencies: [],
        notes: '',
      });
      await taskRepo.save(task);

      // Act
      await service.failTask('test.task', 'Build error');

      // Assert
      expect(
        logger.errorCalls.some(
          (l) => l.message.includes('Task failed') && (l.error as Record<string, unknown>)?.reason === 'Build error'
        )
      ).toBe(true);
    });
  });

  describe('progress logging', () => {
    let mockFileSystem: {
      exists: ReturnType<typeof import('vitest').vi.fn>;
      ensureDir: ReturnType<typeof import('vitest').vi.fn>;
      appendFile: ReturnType<typeof import('vitest').vi.fn>;
      readFile: ReturnType<typeof import('vitest').vi.fn>;
      writeFile: ReturnType<typeof import('vitest').vi.fn>;
      remove: ReturnType<typeof import('vitest').vi.fn>;
      readdir: ReturnType<typeof import('vitest').vi.fn>;
      copy: ReturnType<typeof import('vitest').vi.fn>;
    };
    let serviceWithLogging: TaskService;
    const workspaceDir = '/test/workspace';
    let sagaLog: string;

    beforeEach(async () => {
      taskRepo = new MockTaskRepository();
      stateRepo = new MockStateRepository();
      logger = new MockLogger();
      sagaLog = '';

      // Create mock file system
      const { vi } = await import('vitest');
      mockFileSystem = {
        exists: vi.fn().mockImplementation(async (p: string) => {
          if (String(p).includes('saga.log')) {
            return sagaLog.length > 0;
          }
          return true;
        }),
        ensureDir: vi.fn().mockResolvedValue(undefined),
        appendFile: vi.fn().mockImplementation(async (p: string, data: string | Buffer) => {
          if (String(p).includes('saga.log')) {
            sagaLog += typeof data === 'string' ? data : data.toString();
          }
        }),
        readFile: vi.fn().mockImplementation(async (p: string) => {
          if (String(p).includes('saga.log')) {
            if (!sagaLog) {
              const err: any = new Error('ENOENT');
              err.code = 'ENOENT';
              throw err;
            }
            return sagaLog;
          }
          return '';
        }),
        writeFile: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        readdir: vi.fn().mockResolvedValue([]),
        copy: vi.fn().mockResolvedValue(undefined),
      };

      serviceWithLogging = new TaskService(
        taskRepo,
        stateRepo,
        logger,
        mockFileSystem,
        workspaceDir
      );

      // Seed a pending task for tests
      await taskRepo.save(
        new Task({
          id: 'test.task',
          module: 'test',
          priority: 1,
          status: 'pending',
          estimatedMinutes: 30,
          description: 'Test task',
          acceptanceCriteria: [],
          dependencies: [],
          notes: '',
        })
      );
    });

    it('should append STARTED to saga.log when starting a task', async () => {
      // Act
      await serviceWithLogging.startTask('test.task');

      // Assert
      expect(mockFileSystem.ensureDir).toHaveBeenCalledWith('/test/workspace/.hermes-coding');
      expect(mockFileSystem.appendFile).toHaveBeenCalled();
      expect(sagaLog).toContain('STARTED: test.task');
    });

    it('should append COMPLETED to saga.log when completing a task', async () => {
      // Arrange - start the task first
      const task = await taskRepo.findById('test.task');
      task!.start();
      await taskRepo.save(task!);

      // Act
      await serviceWithLogging.completeTask('test.task', '5 minutes');

      // Assert
      expect(sagaLog).toContain('COMPLETED: test.task - 5 minutes');
    });

    it('should append FAILED to saga.log when failing a task', async () => {
      // Arrange - start the task first
      const task = await taskRepo.findById('test.task');
      task!.start();
      await taskRepo.save(task!);

      // Act
      await serviceWithLogging.failTask('test.task', 'Build error');

      // Assert
      expect(sagaLog).toContain('FAILED: test.task - Build error');
    });

    it('should not fail task operation if saga logging fails', async () => {
      // Arrange - make appendFile throw an error
      mockFileSystem.appendFile.mockRejectedValue(new Error('File system error'));

      // Act
      const result = await serviceWithLogging.startTask('test.task');

      // Assert - task should still be started successfully
      expect(result.status).toBe('in_progress');
      expect(logger.warnCalls.some((l) => l.message.includes('Failed to write saga.log'))).toBe(
        true
      );
    });

    it('should skip logging when fileSystem is not provided', async () => {
      // Arrange - create service without file system
      const serviceWithoutLogging = new TaskService(taskRepo, stateRepo, logger);

      // Act
      const result = await serviceWithoutLogging.startTask('test.task');

      // Assert - task should be started and no file system calls made
      expect(result.status).toBe('in_progress');
      expect(mockFileSystem.appendFile).not.toHaveBeenCalled();
    });
  });

  describe('getNextTaskWithStatus', () => {
    it("should return 'all_done' when all tasks are completed or failed", async () => {
      // Arrange
      await taskRepo.save(
        new Task({
          id: 'task1',
          module: 'test',
          priority: 1,
          status: 'completed',
          estimatedMinutes: 30,
          description: 'Task 1',
          acceptanceCriteria: [],
          dependencies: [],
          notes: '',
        })
      );
      await taskRepo.save(
        new Task({
          id: 'task2',
          module: 'test',
          priority: 2,
          status: 'failed',
          estimatedMinutes: 20,
          description: 'Task 2',
          acceptanceCriteria: [],
          dependencies: [],
          notes: '',
        })
      );

      // Act
      const result = await service.getNextTaskWithStatus();

      // Assert
      expect(result.outcome).toBe('all_done');
      expect(result.task).toBeUndefined();
    });

    it("should return 'blocked' when pending tasks exist but all have unsatisfied dependencies", async () => {
      // Arrange
      await taskRepo.save(
        new Task({
          id: 'task1',
          module: 'test',
          priority: 1,
          status: 'pending',
          estimatedMinutes: 30,
          description: 'Task 1',
          acceptanceCriteria: [],
          dependencies: ['task2'], // task2 is not completed
          notes: '',
        })
      );
      await taskRepo.save(
        new Task({
          id: 'task2',
          module: 'test',
          priority: 2,
          status: 'pending',
          estimatedMinutes: 20,
          description: 'Task 2',
          acceptanceCriteria: [],
          dependencies: ['task1'], // circular dependency
          notes: '',
        })
      );

      // Act
      const result = await service.getNextTaskWithStatus();

      // Assert
      expect(result.outcome).toBe('blocked');
      expect(result.task).toBeUndefined();
    });

    it("should return 'task_found' with the highest-priority ready task", async () => {
      // Arrange
      await taskRepo.save(
        new Task({
          id: 'task1',
          module: 'test',
          priority: 3,
          status: 'pending',
          estimatedMinutes: 30,
          description: 'Low priority task',
          acceptanceCriteria: [],
          dependencies: [],
          notes: '',
        })
      );
      await taskRepo.save(
        new Task({
          id: 'task2',
          module: 'test',
          priority: 1,
          status: 'pending',
          estimatedMinutes: 20,
          description: 'High priority task',
          acceptanceCriteria: [],
          dependencies: [],
          notes: '',
        })
      );

      // Act
      const result = await service.getNextTaskWithStatus();

      // Assert
      expect(result.outcome).toBe('task_found');
      expect(result.task).toBeDefined();
      expect(result.task?.id).toBe('task2'); // Lower priority number = higher priority
    });

    it("should return 'task_found' when there is a mix of completed and ready pending tasks", async () => {
      // Arrange
      await taskRepo.save(
        new Task({
          id: 'task1',
          module: 'test',
          priority: 1,
          status: 'completed',
          estimatedMinutes: 30,
          description: 'Completed task',
          acceptanceCriteria: [],
          dependencies: [],
          notes: '',
        })
      );
      await taskRepo.save(
        new Task({
          id: 'task2',
          module: 'test',
          priority: 2,
          status: 'pending',
          estimatedMinutes: 20,
          description: 'Ready task with satisfied dep',
          acceptanceCriteria: [],
          dependencies: ['task1'], // task1 is completed, so this is ready
          notes: '',
        })
      );
      await taskRepo.save(
        new Task({
          id: 'task3',
          module: 'test',
          priority: 3,
          status: 'pending',
          estimatedMinutes: 40,
          description: 'Blocked task',
          acceptanceCriteria: [],
          dependencies: ['task2'], // task2 is not completed, so this is blocked
          notes: '',
        })
      );

      // Act
      const result = await service.getNextTaskWithStatus();

      // Assert
      expect(result.outcome).toBe('task_found');
      expect(result.task).toBeDefined();
      expect(result.task?.id).toBe('task2');
    });

    it("should return 'blocked' when only in_progress tasks remain (no pending)", async () => {
      // Arrange — one task started but not finished, nothing else pending
      await service.createTask({ id: 'task1', module: 'test', description: 'Task 1', acceptanceCriteria: [] });
      await service.startTask('task1');

      // Act
      const result = await service.getNextTaskWithStatus();

      // Assert — must NOT return all_done; the task is still active
      expect(result.outcome).toBe('blocked');
    });
  });

  describe('single-active-task invariant', () => {
    it('should prevent starting a task when another is in_progress', async () => {
      await service.createTask({ id: 'task1', module: 'test', description: 'Task 1', acceptanceCriteria: [] });
      await service.createTask({ id: 'task2', module: 'test', description: 'Task 2', acceptanceCriteria: [] });

      await service.startTask('task1');

      await expect(service.startTask('task2')).rejects.toThrow('another task is already in_progress');
    });

    it('should allow starting after completing the active task', async () => {
      await service.createTask({ id: 'task1', module: 'test', description: 'Task 1', acceptanceCriteria: [] });
      await service.createTask({ id: 'task2', module: 'test', description: 'Task 2', acceptanceCriteria: [] });

      await service.startTask('task1');
      await service.completeTask('task1');

      const task2 = await service.startTask('task2');
      expect(task2.status).toBe('in_progress');
    });
  });

});
