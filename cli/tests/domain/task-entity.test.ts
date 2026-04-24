import { describe, it, expect, beforeEach } from 'vitest';
import { Task, TaskConfig } from '../../src/domain/task-entity';

describe('Task Domain Entity', () => {
  let baseConfig: TaskConfig;

  beforeEach(() => {
    baseConfig = {
      id: 'test.task',
      module: 'test',
      priority: 1,
      status: 'pending',
      description: 'Test task',
      acceptanceCriteria: ['Criterion 1', 'Criterion 2'],
      estimatedMinutes: 30,
      dependencies: [],
    };
  });

  describe('constructor', () => {
    it('should create task with all fields', () => {
      const config: TaskConfig = {
        ...baseConfig,
        estimatedMinutes: 25,
        dependencies: ['dep1', 'dep2'],
        parallelGroup: 2,
        testRequirements: {
          unit: { required: true, pattern: '**/*.test.ts' },
        },
        notes: 'Test notes',
      };

      const task = new Task(config);

      expect(task.id).toBe('test.task');
      expect(task.module).toBe('test');
      expect(task.priority).toBe(1);
      expect(task.status).toBe('pending');
      expect(task.description).toBe('Test task');
      expect(task.acceptanceCriteria).toEqual(['Criterion 1', 'Criterion 2']);
      expect(task.estimatedMinutes).toBe(25);
      expect(task.dependencies).toEqual(['dep1', 'dep2']);
      expect(task.parallelGroup).toBe(2);
      expect(task.testRequirements).toEqual({
        unit: { required: true, pattern: '**/*.test.ts' },
      });
      expect(task.notes).toBe('Test notes');
    });

    it('should parse startedAt timestamp', () => {
      const config: TaskConfig = {
        ...baseConfig,
        startedAt: '2026-01-20T10:00:00.000Z',
      };

      const task = new Task(config);

      expect(task.startedAt).toBeInstanceOf(Date);
      expect(task.startedAt?.toISOString()).toBe('2026-01-20T10:00:00.000Z');
    });

    it('should parse completedAt timestamp', () => {
      const config: TaskConfig = {
        ...baseConfig,
        completedAt: '2026-01-20T10:30:00.000Z',
      };

      const task = new Task(config);

      expect(task.completedAt).toBeInstanceOf(Date);
      expect(task.completedAt?.toISOString()).toBe('2026-01-20T10:30:00.000Z');
    });

    it('should handle undefined optional fields', () => {
      const config: TaskConfig = {
        id: 'test.task',
        module: 'test',
        priority: 1,
        status: 'pending',
        description: 'Test task',
        acceptanceCriteria: ['Criterion 1'],
      };

      const task = new Task(config);

      expect(task.estimatedMinutes).toBeUndefined();
      expect(task.dependencies).toEqual([]);
      expect(task.testRequirements).toBeUndefined();
      expect(task.notes).toBeUndefined();
      expect(task.startedAt).toBeUndefined();
      expect(task.completedAt).toBeUndefined();
      expect(task.failedAt).toBeUndefined();
    });
  });

  describe('canStart', () => {
    it('should return true when status is pending', () => {
      const task = new Task({ ...baseConfig, status: 'pending' });
      expect(task.canStart()).toBe(true);
    });

    it('should return false when status is in_progress', () => {
      const task = new Task({ ...baseConfig, status: 'in_progress' });
      expect(task.canStart()).toBe(false);
    });

    it('should return false when status is completed', () => {
      const task = new Task({ ...baseConfig, status: 'completed' });
      expect(task.canStart()).toBe(false);
    });

    it('should return false when status is failed', () => {
      const task = new Task({ ...baseConfig, status: 'failed' });
      expect(task.canStart()).toBe(false);
    });
  });

  describe('start', () => {
    it('should transition from pending to in_progress', () => {
      const task = new Task({ ...baseConfig, status: 'pending' });
      task.start();
      expect(task.status).toBe('in_progress');
      expect(task.startedAt).toBeInstanceOf(Date);
    });

    it('should set startedAt timestamp', () => {
      const task = new Task({ ...baseConfig, status: 'pending' });
      const beforeStart = new Date();
      task.start();
      const afterStart = new Date();
      expect(task.startedAt).toBeDefined();
      expect(task.startedAt!.getTime()).toBeGreaterThanOrEqual(beforeStart.getTime());
      expect(task.startedAt!.getTime()).toBeLessThanOrEqual(afterStart.getTime());
    });

    it('should throw error when starting in_progress task', () => {
      const task = new Task({ ...baseConfig, status: 'in_progress' });
      expect(() => task.start()).toThrow(
        'Cannot start task test.task: current status is in_progress. Only pending tasks can be started.'
      );
    });

    it('should throw error when starting completed task', () => {
      const task = new Task({ ...baseConfig, status: 'completed' });
      expect(() => task.start()).toThrow(
        'Cannot start task test.task: current status is completed. Only pending tasks can be started.'
      );
    });

    it('should throw error when starting failed task', () => {
      const task = new Task({ ...baseConfig, status: 'failed' });
      expect(() => task.start()).toThrow(
        'Cannot start task test.task: current status is failed. Only pending tasks can be started.'
      );
    });
  });

  describe('complete', () => {
    it('should transition from in_progress to completed', () => {
      const task = new Task({ ...baseConfig, status: 'in_progress' });
      task.complete();
      expect(task.status).toBe('completed');
      expect(task.completedAt).toBeInstanceOf(Date);
    });

    it('should set completedAt timestamp', () => {
      const task = new Task({ ...baseConfig, status: 'in_progress' });
      const beforeComplete = new Date();
      task.complete();
      const afterComplete = new Date();
      expect(task.completedAt).toBeDefined();
      expect(task.completedAt!.getTime()).toBeGreaterThanOrEqual(beforeComplete.getTime());
      expect(task.completedAt!.getTime()).toBeLessThanOrEqual(afterComplete.getTime());
    });

    it('should throw error when completing pending task', () => {
      const task = new Task({ ...baseConfig, status: 'pending' });
      expect(() => task.complete()).toThrow(
        'Cannot complete task test.task: current status is pending. Only in_progress tasks can be completed.'
      );
    });

    it('should throw error when completing already completed task', () => {
      const task = new Task({ ...baseConfig, status: 'completed' });
      expect(() => task.complete()).toThrow(
        'Cannot complete task test.task: current status is completed. Only in_progress tasks can be completed.'
      );
    });
  });

  describe('fail', () => {
    it('should transition from in_progress to failed', () => {
      const task = new Task({ ...baseConfig, status: 'in_progress' });
      task.fail();
      expect(task.status).toBe('failed');
      expect(task.failedAt).toBeInstanceOf(Date);
    });

    it('should set failedAt timestamp', () => {
      const task = new Task({ ...baseConfig, status: 'in_progress' });
      const beforeFail = new Date();
      task.fail();
      const afterFail = new Date();
      expect(task.failedAt).toBeDefined();
      expect(task.failedAt!.getTime()).toBeGreaterThanOrEqual(beforeFail.getTime());
      expect(task.failedAt!.getTime()).toBeLessThanOrEqual(afterFail.getTime());
    });

    it('should throw error when failing pending task', () => {
      const task = new Task({ ...baseConfig, status: 'pending' });
      expect(() => task.fail()).toThrow(
        'Cannot fail task test.task: current status is pending. Only in_progress tasks can be failed.'
      );
    });

    it('should throw error when failing completed task', () => {
      const task = new Task({ ...baseConfig, status: 'completed' });
      expect(() => task.fail()).toThrow(
        'Cannot fail task test.task: current status is completed. Only in_progress tasks can be failed.'
      );
    });
  });

  describe('isBlocked', () => {
    it('should return false when task has no dependencies', () => {
      const task = new Task({ ...baseConfig, dependencies: [] });
      expect(task.isBlocked(new Set<string>([]))).toBe(false);
    });

    it('should return false when all dependencies are completed', () => {
      const task = new Task({ ...baseConfig, dependencies: ['dep1', 'dep2'] });
      expect(task.isBlocked(new Set<string>(['dep1', 'dep2']))).toBe(false);
    });

    it('should return true when some dependencies are not completed', () => {
      const task = new Task({ ...baseConfig, dependencies: ['dep1', 'dep2', 'dep3'] });
      expect(task.isBlocked(new Set<string>(['dep1']))).toBe(true);
    });

    it('should return true when no dependencies are completed', () => {
      const task = new Task({ ...baseConfig, dependencies: ['dep1', 'dep2'] });
      expect(task.isBlocked(new Set<string>([]))).toBe(true);
    });
  });

  describe('getActualDuration', () => {
    it('should return undefined when task has not started', () => {
      const task = new Task({ ...baseConfig, status: 'pending' });
      expect(task.getActualDuration()).toBeUndefined();
    });

    it('should return undefined when task is in progress', () => {
      const task = new Task({
        ...baseConfig,
        status: 'in_progress',
        startedAt: '2026-01-20T10:00:00.000Z',
      });
      expect(task.getActualDuration()).toBeUndefined();
    });

    it('should return duration in minutes when task is completed', () => {
      const task = new Task({
        ...baseConfig,
        status: 'completed',
        startedAt: '2026-01-20T10:00:00.000Z',
        completedAt: '2026-01-20T10:25:00.000Z',
      });
      expect(task.getActualDuration()).toBe(25);
    });

    it('should return duration in minutes when task is failed', () => {
      const task = new Task({
        ...baseConfig,
        status: 'failed',
        startedAt: '2026-01-20T10:00:00.000Z',
        failedAt: '2026-01-20T10:45:00.000Z',
      });
      expect(task.getActualDuration()).toBe(45);
    });

    it('should round duration to nearest minute', () => {
      const task = new Task({
        ...baseConfig,
        status: 'completed',
        startedAt: '2026-01-20T10:00:00.000Z',
        completedAt: '2026-01-20T10:25:30.000Z',
      });
      expect(task.getActualDuration()).toBe(26);
    });
  });

  describe('isTerminal', () => {
    it('should return false for pending task', () => {
      expect(new Task({ ...baseConfig, status: 'pending' }).isTerminal()).toBe(false);
    });

    it('should return false for in_progress task', () => {
      expect(new Task({ ...baseConfig, status: 'in_progress' }).isTerminal()).toBe(false);
    });

    it('should return true for completed task', () => {
      expect(new Task({ ...baseConfig, status: 'completed' }).isTerminal()).toBe(true);
    });

    it('should return true for failed task', () => {
      expect(new Task({ ...baseConfig, status: 'failed' }).isTerminal()).toBe(true);
    });
  });

  describe('isActive', () => {
    it('should return true for in_progress tasks', () => {
      const task = new Task({ ...baseConfig, status: 'pending' });
      task.start();
      expect(task.isActive()).toBe(true);
    });

    it('should return false for non-active tasks', () => {
      const task = new Task(baseConfig);
      expect(task.isActive()).toBe(false);
    });
  });

  describe('toJSON', () => {
    it('should serialize all fields to plain object', () => {
      const config: TaskConfig = {
        id: 'test.task',
        module: 'test',
        priority: 1,
        status: 'completed',
        description: 'Test task',
        acceptanceCriteria: ['Criterion 1'],
        estimatedMinutes: 30,
        dependencies: ['dep1'],
        parallelGroup: 2,
        testRequirements: {
          unit: { required: true, pattern: '**/*.test.ts' },
        },
        notes: 'Test notes',
        startedAt: '2026-01-20T10:00:00.000Z',
        completedAt: '2026-01-20T10:30:00.000Z',
      };
      const task = new Task(config);
      const result = task.toJSON();
      expect(result).toEqual(config);
    });

    it('should convert Date objects to ISO strings', () => {
      const task = new Task({ ...baseConfig, status: 'pending' });
      task.start();
      task.complete();
      const result = task.toJSON();
      expect(typeof result.startedAt).toBe('string');
      expect(typeof result.completedAt).toBe('string');
      expect(result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(result.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('fromJSON', () => {
    it('should create Task from plain object', () => {
      const config: TaskConfig = {
        id: 'test.task',
        module: 'test',
        priority: 1,
        status: 'pending',
        description: 'Test task',
        acceptanceCriteria: ['Criterion 1'],
        estimatedMinutes: 30,
      };
      const task = Task.fromJSON(config);
      expect(task).toBeInstanceOf(Task);
      expect(task.id).toBe('test.task');
      expect(task.status).toBe('pending');
    });

    it('should round-trip through toJSON and fromJSON', () => {
      const task1 = new Task({ ...baseConfig });
      task1.start();
      task1.complete();
      const json = task1.toJSON();
      const task2 = Task.fromJSON(json);
      expect(task2.status).toBe('completed');
      expect(task2.startedAt?.getTime()).toBe(task1.startedAt?.getTime());
      expect(task2.completedAt?.getTime()).toBe(task1.completedAt?.getTime());
    });
  });

  describe('workflow integration', () => {
    it('should support full lifecycle: pending → in_progress → completed', () => {
      const task = new Task({ ...baseConfig, status: 'pending' });
      expect(task.canStart()).toBe(true);
      expect(task.status).toBe('pending');

      task.start();
      expect(task.status).toBe('in_progress');
      expect(task.startedAt).toBeDefined();

      task.complete();
      expect(task.status).toBe('completed');
      expect(task.completedAt).toBeDefined();
      expect(task.isTerminal()).toBe(true);
    });

    it('should support failure workflow: pending → in_progress → failed', () => {
      const task = new Task({ ...baseConfig, status: 'pending' });
      task.start();
      expect(task.status).toBe('in_progress');

      task.fail();
      expect(task.status).toBe('failed');
      expect(task.failedAt).toBeDefined();
      expect(task.isTerminal()).toBe(true);
    });
  });

  describe('parallelGroup backward compatibility', () => {
    it('should parse parallelGroup from legacy task config', () => {
      const task = new Task({ ...baseConfig, parallelGroup: 3 });
      expect(task.parallelGroup).toBe(3);
    });

    it('should serialize parallelGroup in toJSON', () => {
      const task = new Task({ ...baseConfig, parallelGroup: 1 });
      expect(task.toJSON().parallelGroup).toBe(1);
    });

    it('should round-trip parallelGroup through fromJSON', () => {
      const task1 = new Task({ ...baseConfig, parallelGroup: 2 });
      const task2 = Task.fromJSON(task1.toJSON());
      expect(task2.parallelGroup).toBe(2);
    });

    it('should handle missing parallelGroup gracefully', () => {
      const task = new Task({ ...baseConfig });
      expect(task.parallelGroup).toBeUndefined();
      expect(task.toJSON().parallelGroup).toBeUndefined();
    });
  });
});
