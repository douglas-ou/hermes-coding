import { describe, it, expect, beforeEach } from 'vitest';
import { TaskService } from '../../src/services/task-service';
import { TaskAuthoringError } from '../../src/core/task-parser';
import { FileSystemTaskRepository } from '../../src/repositories/task-repository.service';
import { MockFileSystem } from '../../src/test-utils/mock-file-system';
import { MockStateRepository, MockLogger } from '../../src/test-utils';
import * as path from 'path';

describe('TaskService — document-mode (createTaskFromDocument)', () => {
  const workspaceDir = '/test/workspace';
  const tasksDir = path.join(workspaceDir, '.hermes-coding', 'tasks');
  const contentDir = path.join(workspaceDir, 'content');

  let fs: MockFileSystem;
  let repo: FileSystemTaskRepository;
  let stateRepo: MockStateRepository;
  let logger: MockLogger;
  let service: TaskService;

  beforeEach(() => {
    fs = new MockFileSystem();
    repo = new FileSystemTaskRepository(fs, tasksDir);
    stateRepo = new MockStateRepository();
    logger = new MockLogger();
    service = new TaskService(repo, stateRepo, logger, fs, workspaceDir);
  });

  /** Helper: a valid task document string */
  function validDoc(overrides: Record<string, string> = {}): string {
    const frontmatter: Record<string, any> = {
      id: 'auth.login',
      module: 'auth',
      priority: 2,
      status: 'pending',
      estimatedMinutes: 25,
      dependencies: ['setup.scaffold'],
      ...overrides,
    };
    const fm = Object.entries(frontmatter)
      .map(([k, v]) => {
        if (Array.isArray(v)) {
          return `${k}:\n${v.map((i) => `  - ${i}`).join('\n')}`;
        }
        return `${k}: ${v}`;
      })
      .join('\n');
    return [
      '---',
      fm,
      '---',
      '',
      '# Implement Login UI',
      '',
      '## Acceptance Criteria',
      '1. Login form renders correctly',
      '2. Form validation works',
      '3. API integration completes',
      '',
      '## Environment Context',
      '- React 18 with TypeScript',
      '- Uses auth service from auth module',
      '',
    ].join('\n');
  }

  /** Helper: write content file and return its path */
  function writeContentFile(content: string, fileName = 'auth.login.md'): string {
    const filePath = path.join(contentDir, fileName);
    fs.setFile(filePath, content);
    return filePath;
  }

  // -------------------------------------------------------------------
  // Success path
  // -------------------------------------------------------------------

  describe('successful creation', () => {
    it('should persist task at the canonical path', async () => {
      const contentPath = writeContentFile(validDoc());

      const task = await service.createTaskFromDocument({ contentFilePath: contentPath });

      expect(task.id).toBe('auth.login');
      expect(task.module).toBe('auth');
      expect(task.priority).toBe(2);
      expect(task.status).toBe('pending');
      expect(task.description).toBe('Implement Login UI');
      expect(task.acceptanceCriteria).toEqual([
        'Login form renders correctly',
        'Form validation works',
        'API integration completes',
      ]);

      // Verify the file exists at the canonical path
      const canonicalPath = path.join(tasksDir, 'auth', 'login.md');
      expect(fs.hasFile(canonicalPath)).toBe(true);
    });

    it('should persist raw content byte-for-byte', async () => {
      const raw = validDoc();
      const contentPath = writeContentFile(raw);

      await service.createTaskFromDocument({ contentFilePath: contentPath });

      const canonicalPath = path.join(tasksDir, 'auth', 'login.md');
      const persisted = fs.getFile(canonicalPath) as string;
      expect(persisted).toBe(raw);
    });

    it('should update index.json with task metadata', async () => {
      const contentPath = writeContentFile(validDoc());

      await service.createTaskFromDocument({ contentFilePath: contentPath });

      const indexContent = fs.getFile(path.join(tasksDir, 'index.json')) as string;
      const index = JSON.parse(indexContent);
      expect(index.tasks['auth.login']).toBeDefined();
      expect(index.tasks['auth.login'].status).toBe('pending');
      expect(index.tasks['auth.login'].priority).toBe(2);
      expect(index.tasks['auth.login'].module).toBe('auth');
      expect(index.tasks['auth.login'].description).toBe('Implement Login UI');
      expect(index.tasks['auth.login'].dependencies).toEqual(['setup.scaffold']);
      expect(index.tasks['auth.login'].estimatedMinutes).toBe(25);
    });

    it('should preserve custom sections in persisted content', async () => {
      const contentPath = writeContentFile(validDoc());

      await service.createTaskFromDocument({ contentFilePath: contentPath });

      const canonicalPath = path.join(tasksDir, 'auth', 'login.md');
      const persisted = fs.getFile(canonicalPath) as string;
      expect(persisted).toContain('## Environment Context');
      expect(persisted).toContain('React 18 with TypeScript');
    });

    it('should normalize comma-separated dependencies in index.json', async () => {
      const doc = [
        '---',
        'id: auth.login',
        'module: auth',
        'priority: 2',
        'status: pending',
        'estimatedMinutes: 25',
        'dependencies: setup.a, setup.b',
        '---',
        '',
        '# Implement Login',
        '',
        '## Acceptance Criteria',
        '1. Works',
      ].join('\n');
      const contentPath = writeContentFile(doc);

      await service.createTaskFromDocument({ contentFilePath: contentPath });

      const indexContent = fs.getFile(path.join(tasksDir, 'index.json')) as string;
      const index = JSON.parse(indexContent);
      expect(index.tasks['auth.login'].dependencies).toEqual(['setup.a', 'setup.b']);
    });

    it('should handle omitted optional fields (no estimatedMinutes)', async () => {
      const raw = validDoc({ priority: 1 });
      // Remove the estimatedMinutes line
      const noEst = raw.replace('estimatedMinutes: 25\n', '');
      const contentPath = writeContentFile(noEst);

      const task = await service.createTaskFromDocument({ contentFilePath: contentPath });

      // estimatedMinutes should be undefined
      expect(task.estimatedMinutes).toBeUndefined();

      // index.json should not have estimatedMinutes or it should be undefined
      const indexContent = fs.getFile(path.join(tasksDir, 'index.json')) as string;
      const index = JSON.parse(indexContent);
      const entry = index.tasks['auth.login'];
      // The repo stores it only when defined
      expect(entry.estimatedMinutes).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------
  // Duplicate rejection
  // -------------------------------------------------------------------

  describe('duplicate task ID', () => {
    it('should reject creating a task with an existing ID', async () => {
      const contentPath = writeContentFile(validDoc());
      await service.createTaskFromDocument({ contentFilePath: contentPath });

      // Try to create the same task again
      const contentPath2 = writeContentFile(validDoc(), 'dup.md');
      await expect(
        service.createTaskFromDocument({ contentFilePath: contentPath2 })
      ).rejects.toThrow('Task already exists: auth.login');
    });

    it('should reject a stale index entry without deleting it', async () => {
      const staleIndexPath = path.join(tasksDir, 'index.json');
      fs.setFile(
        staleIndexPath,
        JSON.stringify({
          version: '1.0.0',
          updatedAt: new Date().toISOString(),
          metadata: { projectGoal: '' },
          tasks: {
            'auth.login': {
              status: 'pending',
              priority: 2,
              module: 'auth',
              description: 'Stale entry',
              filePath: 'auth/login.md',
            },
          },
        })
      );

      const contentPath = writeContentFile(validDoc(), 'stale-index.md');

      await expect(
        service.createTaskFromDocument({ contentFilePath: contentPath })
      ).rejects.toThrow('Task already exists: auth.login');

      const indexAfter = JSON.parse(fs.getFile(staleIndexPath) as string);
      expect(indexAfter.tasks['auth.login']).toBeDefined();
      expect(fs.hasFile(path.join(tasksDir, 'auth', 'login.md'))).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // Validation errors
  // -------------------------------------------------------------------

  describe('invalid document rejection', () => {
    it('should reject document with missing title', async () => {
      const raw = validDoc().replace('# Implement Login UI', '');
      const contentPath = writeContentFile(raw);

      await expect(
        service.createTaskFromDocument({ contentFilePath: contentPath })
      ).rejects.toThrow(TaskAuthoringError);
    });

    it('should reject document with empty acceptance criteria', async () => {
      const raw = validDoc()
        .replace('1. Login form renders correctly', '')
        .replace('2. Form validation works', '')
        .replace('3. API integration completes', '');
      const contentPath = writeContentFile(raw);

      try {
        await service.createTaskFromDocument({ contentFilePath: contentPath });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TaskAuthoringError);
        const authoringErr = err as TaskAuthoringError;
        expect(authoringErr.violations.some((v) => v.field === 'acceptanceCriteria')).toBe(true);
      }
    });

    it('should reject document with invalid priority', async () => {
      const raw = validDoc({ priority: 0 });
      const contentPath = writeContentFile(raw);

      try {
        await service.createTaskFromDocument({ contentFilePath: contentPath });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TaskAuthoringError);
        const authoringErr = err as TaskAuthoringError;
        expect(authoringErr.violations.some((v) => v.field === 'priority')).toBe(true);
      }
    });

    it('should reject boolean priority before parser coercion', async () => {
      const raw = validDoc({ priority: true as any });
      const contentPath = writeContentFile(raw);

      try {
        await service.createTaskFromDocument({ contentFilePath: contentPath });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TaskAuthoringError);
        const authoringErr = err as TaskAuthoringError;
        expect(authoringErr.violations.some((v) => v.field === 'priority')).toBe(true);
      }
    });

    it('should reject array-shaped priority before parser coercion', async () => {
      const raw = [
        '---',
        'id: auth.login',
        'module: auth',
        'priority:',
        '  - 1',
        'status: pending',
        '---',
        '',
        '# Implement Login',
        '',
        '## Acceptance Criteria',
        '1. Works',
      ].join('\n');
      const contentPath = writeContentFile(raw);

      try {
        await service.createTaskFromDocument({ contentFilePath: contentPath });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TaskAuthoringError);
        const authoringErr = err as TaskAuthoringError;
        expect(authoringErr.violations.some((v) => v.field === 'priority')).toBe(true);
      }
    });

    it('should reject document with non-pending status', async () => {
      const raw = validDoc({ status: 'in_progress' });
      const contentPath = writeContentFile(raw);

      try {
        await service.createTaskFromDocument({ contentFilePath: contentPath });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TaskAuthoringError);
        const authoringErr = err as TaskAuthoringError;
        expect(authoringErr.violations.some((v) => v.field === 'status')).toBe(true);
      }
    });

    it('should reject document with runtime lifecycle fields', async () => {
      const raw = validDoc({ startedAt: '2026-04-17T10:00:00Z' });
      const contentPath = writeContentFile(raw);

      try {
        await service.createTaskFromDocument({ contentFilePath: contentPath });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TaskAuthoringError);
        const authoringErr = err as TaskAuthoringError;
        expect(authoringErr.violations.some((v) => v.field === 'startedAt')).toBe(true);
      }
    });

    it('should reject document with id/module mismatch', async () => {
      const raw = validDoc({ id: 'wrong.task', module: 'auth' });
      const contentPath = writeContentFile(raw);

      try {
        await service.createTaskFromDocument({ contentFilePath: contentPath });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TaskAuthoringError);
        const authoringErr = err as TaskAuthoringError;
        expect(authoringErr.violations.some((v) => v.field === 'id')).toBe(true);
      }
    });

    it('should reject invalid dependency shape (number)', async () => {
      // Craft YAML with dependencies as a number
      const raw = [
        '---',
        'id: auth.login',
        'module: auth',
        'priority: 2',
        'status: pending',
        'dependencies: 42',
        '---',
        '',
        '# Implement Login',
        '',
        '## Acceptance Criteria',
        '1. Works',
      ].join('\n');
      const contentPath = writeContentFile(raw);

      try {
        await service.createTaskFromDocument({ contentFilePath: contentPath });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TaskAuthoringError);
        const authoringErr = err as TaskAuthoringError;
        expect(authoringErr.violations.some((v) => v.field === 'dependencies')).toBe(true);
      }
    });

    it('should reject blank dependency entries in an array', async () => {
      const raw = validDoc({ dependencies: ['setup.scaffold', ''] });
      const contentPath = writeContentFile(raw);

      await expect(
        service.createTaskFromDocument({ contentFilePath: contentPath })
      ).rejects.toThrow(TaskAuthoringError);
    });

    it('should reject blank dependency entries in a comma-separated string', async () => {
      const raw = [
        '---',
        'id: auth.login',
        'module: auth',
        'priority: 2',
        'status: pending',
        'dependencies: ","',
        '---',
        '',
        '# Implement Login',
        '',
        '## Acceptance Criteria',
        '1. Works',
      ].join('\n');
      const contentPath = writeContentFile(raw);

      await expect(
        service.createTaskFromDocument({ contentFilePath: contentPath })
      ).rejects.toThrow(TaskAuthoringError);
    });
  });

  // -------------------------------------------------------------------
  // Path-unsafe input
  // -------------------------------------------------------------------

  describe('path-unsafe input', () => {
    it('should reject module with .. traversal', async () => {
      const malicious = [
        '---',
        'id: "..login"',
        'module: ".."',
        'priority: 2',
        'status: pending',
        '---',
        '',
        '# Bad module',
        '',
        '## Acceptance Criteria',
        '1. Test',
      ].join('\n');
      const cp = writeContentFile(malicious);

      // Rejected — either by authoring validation (id mismatch since ".." prefix
      // produces empty name) or by path-safety in the repository layer.
      await expect(
        service.createTaskFromDocument({ contentFilePath: cp })
      ).rejects.toThrow();
    });

    it('should reject module with forward slash', async () => {
      const raw = [
        '---',
        'id: "evil/task.login"',
        'module: "evil/task"',
        'priority: 2',
        'status: pending',
        '---',
        '',
        '# Evil Module',
        '',
        '## Acceptance Criteria',
        '1. Test',
      ].join('\n');
      const contentPath = writeContentFile(raw);

      await expect(
        service.createTaskFromDocument({ contentFilePath: contentPath })
      ).rejects.toThrow();
    });

    it('should reject current-directory module segment', async () => {
      const raw = [
        '---',
        'id: "..foo"',
        'module: "."',
        'priority: 2',
        'status: pending',
        '---',
        '',
        '# Dot Module',
        '',
        '## Acceptance Criteria',
        '1. Test',
      ].join('\n');
      const contentPath = writeContentFile(raw);

      await expect(
        service.createTaskFromDocument({ contentFilePath: contentPath })
      ).rejects.toThrow();
    });

    it('should reject path-unsafe module before checking for external file conflicts', async () => {
      const raw = [
        '---',
        'id: "../outside.login"',
        'module: "../outside"',
        'priority: 2',
        'status: pending',
        '---',
        '',
        '# Unsafe Module',
        '',
        '## Acceptance Criteria',
        '1. Test',
      ].join('\n');
      const contentPath = writeContentFile(raw, 'unsafe-outside.md');

      fs.setFile(path.join(workspaceDir, 'outside', 'login.md'), 'stale');

      await expect(
        service.createTaskFromDocument({ contentFilePath: contentPath })
      ).rejects.toThrow('path-unsafe');
    });
  });

  // -------------------------------------------------------------------
  // Canonical-file-conflict detection
  // -------------------------------------------------------------------

  describe('canonical file conflict', () => {
    it('should detect conflict when file exists but index.json has no entry', async () => {
      // Pre-seed a file at the canonical path without adding it to index.json
      const canonicalPath = path.join(tasksDir, 'auth', 'login.md');
      fs.setFile(canonicalPath, 'stale content');

      const contentPath = writeContentFile(validDoc());

      await expect(
        service.createTaskFromDocument({ contentFilePath: contentPath })
      ).rejects.toThrow('already exists');
    });

    it('should fail without overwriting if the canonical file appears during publish', async () => {
      fs.setRenameNoClobberHook((_oldPath, newPath) => {
        fs.setFile(newPath, 'raced-in content');
      });

      const contentPath = writeContentFile(validDoc());

      await expect(
        service.createTaskFromDocument({ contentFilePath: contentPath })
      ).rejects.toThrow('already exists');

      const canonicalPath = path.join(tasksDir, 'auth', 'login.md');
      expect(fs.getFile(canonicalPath)).toBe('raced-in content');
      expect(fs.hasFile(path.join(tasksDir, 'index.json'))).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // Content file errors
  // -------------------------------------------------------------------

  describe('content file errors', () => {
    it('should reject when content file does not exist', async () => {
      await expect(
        service.createTaskFromDocument({ contentFilePath: '/nonexistent/file.md' })
      ).rejects.toThrow('not found or unreadable');
    });

    it('should reject when file system is not provided', async () => {
      const noFsService = new TaskService(repo, stateRepo, logger);

      await expect(
        noFsService.createTaskFromDocument({ contentFilePath: '/any/file.md' })
      ).rejects.toThrow('File system is required');
    });
  });

  // -------------------------------------------------------------------
  // Module validation guard (--module flag)
  // -------------------------------------------------------------------

  describe('field-mode canonical-file conflict', () => {
    it('should reject field-mode createTask when canonical file exists without index entry', async () => {
      // Pre-seed a file at the canonical path without adding it to index.json
      const canonicalPath = path.join(tasksDir, 'auth', 'login.md');
      fs.setFile(canonicalPath, 'stale content');

      await expect(
        service.createTask({
          id: 'auth.login',
          module: 'auth',
          description: 'New task',
        })
      ).rejects.toThrow('canonical path');
    });
  });

  // -------------------------------------------------------------------
  // Module validation guard (--module flag)
  // -------------------------------------------------------------------

  describe('module validation guard', () => {
    it('should reject when --module does not match document module', async () => {
      const contentPath = writeContentFile(validDoc());

      await expect(
        service.createTaskFromDocument({ contentFilePath: contentPath, expectedModule: 'wrong' })
      ).rejects.toThrow('Module mismatch');
    });

    it('should succeed when --module matches document module', async () => {
      const contentPath = writeContentFile(validDoc());

      const task = await service.createTaskFromDocument({
        contentFilePath: contentPath,
        expectedModule: 'auth',
      });

      expect(task.id).toBe('auth.login');
    });

    it('should succeed when --module is not provided', async () => {
      const contentPath = writeContentFile(validDoc());

      const task = await service.createTaskFromDocument({
        contentFilePath: contentPath,
      });

      expect(task.id).toBe('auth.login');
    });
  });
});
