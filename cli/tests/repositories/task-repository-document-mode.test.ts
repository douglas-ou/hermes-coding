import { describe, it, expect, beforeEach } from 'vitest';
import { FileSystemTaskRepository } from '../../src/repositories/task-repository.service';
import { MockFileSystem } from '../../src/test-utils/mock-file-system';
import { RawTaskMetadata } from '../../src/repositories/task-repository';
import { Task } from '../../src/domain/task-entity';
import * as path from 'path';

describe('FileSystemTaskRepository — document-mode', () => {
  const tasksDir = '/test/workspace/.hermes-coding/tasks';
  let fs: MockFileSystem;
  let repo: FileSystemTaskRepository;

  beforeEach(() => {
    fs = new MockFileSystem();
    repo = new FileSystemTaskRepository(fs, tasksDir);
  });

  /** Build a minimal valid metadata object */
  function validMetadata(overrides: Partial<RawTaskMetadata> = {}): RawTaskMetadata {
    return {
      id: 'auth.login',
      module: 'auth',
      status: 'pending',
      priority: 2,
      description: 'Implement Login UI',
      dependencies: ['setup.scaffold'],
      estimatedMinutes: 25,
      ...overrides,
    };
  }

  const validRawContent = [
    '---',
    'id: auth.login',
    'module: auth',
    'priority: 2',
    'status: pending',
    'estimatedMinutes: 25',
    'dependencies:',
    '  - setup.scaffold',
    '---',
    '',
    '# Implement Login UI',
    '',
    '## Acceptance Criteria',
    '1. Login form renders correctly',
  ].join('\n');

  // -------------------------------------------------------------------
  // canonicalFileExists
  // -------------------------------------------------------------------

  describe('canonicalFileExists', () => {
    it('should return false when file does not exist', async () => {
      const exists = await repo.canonicalFileExists('auth.login', 'auth');
      expect(exists).toBe(false);
    });

    it('should return true when file exists at canonical path', async () => {
      const canonicalPath = path.join(tasksDir, 'auth', 'login.md');
      fs.setFile(canonicalPath, 'some content');

      const exists = await repo.canonicalFileExists('auth.login', 'auth');
      expect(exists).toBe(true);
    });
  });

  // -------------------------------------------------------------------
  // saveRawTaskDocument
  // -------------------------------------------------------------------

  describe('saveRawTaskDocument', () => {
    it('should write raw content to canonical path', async () => {
      await repo.saveRawTaskDocument(validRawContent, validMetadata());

      const canonicalPath = path.join(tasksDir, 'auth', 'login.md');
      expect(fs.hasFile(canonicalPath)).toBe(true);

      const persisted = fs.getFile(canonicalPath) as string;
      expect(persisted).toBe(validRawContent);
    });

    it('should update index.json correctly', async () => {
      await repo.saveRawTaskDocument(validRawContent, validMetadata());

      const indexPath = path.join(tasksDir, 'index.json');
      const indexContent = fs.getFile(indexPath) as string;
      const index = JSON.parse(indexContent);

      expect(index.tasks['auth.login']).toBeDefined();
      expect(index.tasks['auth.login'].status).toBe('pending');
      expect(index.tasks['auth.login'].priority).toBe(2);
      expect(index.tasks['auth.login'].module).toBe('auth');
      expect(index.tasks['auth.login'].description).toBe('Implement Login UI');
      expect(index.tasks['auth.login'].dependencies).toEqual(['setup.scaffold']);
      expect(index.tasks['auth.login'].estimatedMinutes).toBe(25);
      expect(index.tasks['auth.login'].filePath).toBe(path.join('auth', 'login.md'));
    });

    it('should persist content byte-for-byte', async () => {
      const raw = validRawContent + '\n\n## Notes\nSome custom notes here';
      await repo.saveRawTaskDocument(raw, validMetadata());

      const canonicalPath = path.join(tasksDir, 'auth', 'login.md');
      const persisted = fs.getFile(canonicalPath) as string;
      expect(persisted).toBe(raw);
    });

    it('should use a unique temp file for each raw document publish', async () => {
      const firstMetadata = validMetadata({ id: 'auth.login', module: 'auth' });
      const secondMetadata = validMetadata({ id: 'auth.signup', module: 'auth' });
      const firstRaw = validRawContent;
      const secondRaw = validRawContent.replace('id: auth.login', 'id: auth.signup');
      const tempPaths: string[] = [];

      fs.setRenameNoClobberHook((oldPath) => {
        tempPaths.push(oldPath);
      });

      await repo.saveRawTaskDocument(firstRaw, firstMetadata);
      await repo.saveRawTaskDocument(secondRaw, secondMetadata);

      expect(tempPaths).toHaveLength(2);
      expect(tempPaths[0]).not.toBe(tempPaths[1]);
    });

    it('should reject path-unsafe module', async () => {
      await expect(
        repo.saveRawTaskDocument('content', validMetadata({ module: '..' }))
      ).rejects.toThrow('path-unsafe');
    });

    it('should reject current-directory module segment', async () => {
      await expect(
        repo.saveRawTaskDocument('content', validMetadata({ module: '.', id: '.login' }))
      ).rejects.toThrow('path-unsafe');
    });

    it('should reject path-unsafe name', async () => {
      // id = "../evil" so name after module slice = "/evil"
      await expect(
        repo.saveRawTaskDocument('content', validMetadata({ id: 'x../evil', module: 'x' }))
      ).rejects.toThrow('path-unsafe');
    });

    it('should reject paths that escape tasksDir', async () => {
      // Even if the module passes isPathSafeSegment, the resolved path
      // must stay within tasksDir. We test with a very crafted case.
      // Since isPathSafeSegment blocks '..', '/', '\\' this is defense-in-depth.
      // Let's just confirm a normal safe path works and an obviously unsafe one fails.
      await expect(
        repo.saveRawTaskDocument('content', validMetadata({ module: '..' }))
      ).rejects.toThrow();
    });

    it('should handle dependencies normalized as array', async () => {
      await repo.saveRawTaskDocument(validRawContent, validMetadata({
        dependencies: ['a.b', 'c.d'],
      }));

      const indexPath = path.join(tasksDir, 'index.json');
      const index = JSON.parse(fs.getFile(indexPath) as string);
      expect(index.tasks['auth.login'].dependencies).toEqual(['a.b', 'c.d']);
    });

    it('should handle omitted estimatedMinutes', async () => {
      const { estimatedMinutes, ...meta } = validMetadata();
      await repo.saveRawTaskDocument(validRawContent, meta as RawTaskMetadata);

      const indexPath = path.join(tasksDir, 'index.json');
      const index = JSON.parse(fs.getFile(indexPath) as string);
      expect(index.tasks['auth.login'].estimatedMinutes).toBeUndefined();
    });

    it('should update existing index.json without losing other tasks', async () => {
      // Pre-seed index.json with an existing task
      const indexPath = path.join(tasksDir, 'index.json');
      const existingIndex = {
        version: '1.0.0',
        updatedAt: new Date().toISOString(),
        metadata: { projectGoal: '' },
        tasks: {
          'existing.task': {
            status: 'completed',
            priority: 1,
            module: 'existing',
            description: 'Existing task',
            filePath: 'existing/task.md',
          },
        },
      };
      fs.setFile(indexPath, JSON.stringify(existingIndex, null, 2));

      await repo.saveRawTaskDocument(validRawContent, validMetadata());

      const updated = JSON.parse(fs.getFile(indexPath) as string);
      // Existing task should still be there
      expect(updated.tasks['existing.task']).toBeDefined();
      expect(updated.tasks['existing.task'].status).toBe('completed');
      // New task added
      expect(updated.tasks['auth.login']).toBeDefined();
    });

    it('should rollback task file when index.json write fails', async () => {
      // Create a scenario where index.json write fails by making the
      // file system throw on a second write call.
      // We'll use a custom approach: pre-seed an index.json that will cause
      // a JSON.parse error, which triggers the catch block in writeIndex.
      const indexPath = path.join(tasksDir, 'index.json');
      fs.setFile(indexPath, 'not valid json {');

      // The repo's readIndex should parse the invalid JSON, causing an error
      // during saveRawTaskDocument's index update step
      const metadata = validMetadata({ id: 'rb.test', module: 'rb' });
      const rawContent = '---\nid: rb.test\nmodule: rb\npriority: 1\nstatus: pending\n---\n\n# Test\n\n## Acceptance Criteria\n1. Test';

      // This should throw but rollback the file
      await expect(
        repo.saveRawTaskDocument(rawContent, metadata)
      ).rejects.toThrow();

      // The canonical file should have been rolled back (removed)
      const canonicalPath = path.join(tasksDir, 'rb', 'test.md');
      expect(fs.hasFile(canonicalPath)).toBe(false);
    });

    it('should surface a recoverable conflict when rollback also fails', async () => {
      const indexPath = path.join(tasksDir, 'index.json');
      fs.setFile(indexPath, 'not valid json {');

      const metadata = validMetadata({ id: 'rb.test', module: 'rb' });
      const rawContent = '---\nid: rb.test\nmodule: rb\npriority: 1\nstatus: pending\n---\n\n# Test\n\n## Acceptance Criteria\n1. Test';
      const canonicalPath = path.join(tasksDir, 'rb', 'test.md');

      fs.setRemoveHook((filePath) => {
        if (filePath === canonicalPath) {
          throw new Error('simulated rollback failure');
        }
      });

      await expect(
        repo.saveRawTaskDocument(rawContent, metadata)
      ).rejects.toThrow('Recoverable conflict');

      expect(fs.hasFile(canonicalPath)).toBe(true);
    });

    it('should fail without overwriting if the canonical file appears during publish', async () => {
      const metadata = validMetadata();
      const canonicalPath = path.join(tasksDir, 'auth', 'login.md');

      fs.setRenameNoClobberHook((_oldPath, newPath) => {
        fs.setFile(newPath, 'raced-in content');
      });

      await expect(
        repo.saveRawTaskDocument(validRawContent, metadata)
      ).rejects.toThrow('Task file already exists at canonical path');

      expect(fs.getFile(canonicalPath)).toBe('raced-in content');
      expect(fs.hasFile(canonicalPath + '.tmp')).toBe(false);

      const indexPath = path.join(tasksDir, 'index.json');
      expect(fs.hasFile(indexPath)).toBe(false);
    });
  });

  describe('create', () => {
    it('should create field-mode task without overwriting an existing file that appears during publish', async () => {
      const canonicalPath = path.join(tasksDir, 'auth', 'login.md');
      const task = new Task({
        id: 'auth.login',
        module: 'auth',
        priority: 1,
        status: 'pending',
        description: 'Login',
        acceptanceCriteria: [],
        dependencies: [],
      });

      fs.setRenameNoClobberHook((_oldPath, newPath) => {
        fs.setFile(newPath, 'raced-in content');
      });

      await expect(repo.create(task)).rejects.toThrow('Task file already exists');

      expect(fs.getFile(canonicalPath)).toBe('raced-in content');
      expect(fs.hasFile(path.join(tasksDir, 'index.json'))).toBe(false);
    });
  });
});
