import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskParser, parseTaskContent, TaskParseError, splitFrontmatter, validateTaskForCreation, validateDependencyShape, isPathSafeSegment, AuthoringViolation } from '../../src/core/task-parser';
import * as fs from 'fs-extra';
import * as path from 'path';

describe('TaskParser', () => {
  const testDir = path.join(__dirname, '../../test-fixtures-task-parser');
  const validTaskFile = path.join(testDir, 'valid-task.md');
  const invalidTaskFile = path.join(testDir, 'invalid-task.md');
  const indexFile = path.join(testDir, 'index.json');

  beforeEach(() => {
    fs.ensureDirSync(testDir);
  });

  afterEach(() => {
    fs.removeSync(testDir);
  });

  describe('parseTaskFile', () => {
    it('should parse a valid task file with all fields', () => {
      const taskContent = `---
id: auth.login.api
module: auth
priority: 1
status: pending
estimatedMinutes: 30
dependencies:
  - setup.database
testRequirements:
  unit:
    required: true
    pattern: "**/*.test.ts"
  e2e:
    required: false
    pattern: "**/*.e2e.ts"
---

# Implement Login API Endpoint

## Acceptance Criteria

1. POST /api/login endpoint accepts email and password
2. Returns JWT token on successful authentication
3. Returns 401 on invalid credentials
4. Rate limiting implemented (5 attempts per minute)

## Notes

Use bcrypt for password hashing. JWT should expire in 24 hours.
`;

      fs.writeFileSync(validTaskFile, taskContent);

      const task = TaskParser.parseTaskFile(validTaskFile);

      expect(task.id).toBe('auth.login.api');
      expect(task.module).toBe('auth');
      expect(task.priority).toBe(1);
      expect(task.status).toBe('pending');
      expect(task.estimatedMinutes).toBe(30);
      expect(task.dependencies).toEqual(['setup.database']);
      expect(task.testRequirements).toEqual({
        unit: {
          required: true,
          pattern: '**/*.test.ts',
        },
        e2e: {
          required: false,
          pattern: '**/*.e2e.ts',
        },
      });
      expect(task.description).toBe('Implement Login API Endpoint');
      expect(task.acceptanceCriteria).toHaveLength(4);
      expect(task.acceptanceCriteria[0]).toBe('POST /api/login endpoint accepts email and password');
      expect(task.notes).toContain('Use bcrypt');
    });

    it('should parse a minimal task file', () => {
      const taskContent = `---
id: simple.task
module: simple
priority: 5
status: pending
---

# Simple Task

## Acceptance Criteria

1. Task is completed
`;

      fs.writeFileSync(validTaskFile, taskContent);

      const task = TaskParser.parseTaskFile(validTaskFile);

      expect(task.id).toBe('simple.task');
      expect(task.module).toBe('simple');
      expect(task.priority).toBe(5);
      expect(task.status).toBe('pending');
      expect(task.description).toBe('Simple Task');
      expect(task.acceptanceCriteria).toEqual(['Task is completed']);
      expect(task.estimatedMinutes).toBeUndefined();
      expect(task.dependencies).toBeUndefined();
      expect(task.notes).toBeUndefined();
    });

    it('should throw error for invalid format (missing frontmatter)', () => {
      const taskContent = `# Task without frontmatter

## Acceptance Criteria

1. This should fail
`;

      fs.writeFileSync(invalidTaskFile, taskContent);

      expect(() => TaskParser.parseTaskFile(invalidTaskFile)).toThrow('frontmatter');
    });

    it('should handle task with no acceptance criteria', () => {
      const taskContent = `---
id: no.criteria
module: test
priority: 1
status: pending
---

# Task Without Criteria
`;

      fs.writeFileSync(validTaskFile, taskContent);

      const task = TaskParser.parseTaskFile(validTaskFile);

      expect(task.acceptanceCriteria).toEqual([]);
    });
  });

  describe('robust parsing', () => {
    it('should parse file without trailing newline', () => {
      const content = '---\nid: test.task\nmodule: test\npriority: 1\nstatus: pending\n---\n# Title\n## Acceptance Criteria\n\n1. Criterion';
      // No trailing newline — the string above does NOT end with \n

      const task = parseTaskContent(content);
      expect(task.id).toBe('test.task');
      expect(task.acceptanceCriteria).toEqual(['Criterion']);
    });

    it('should parse file with CRLF line endings', () => {
      const content = '---\r\nid: test.crlf\r\nmodule: test\r\npriority: 1\r\nstatus: pending\r\n---\r\n# Title\r\n## Acceptance Criteria\r\n\r\n1. First\r\n2. Second';

      const task = parseTaskContent(content);
      expect(task.id).toBe('test.crlf');
      expect(task.acceptanceCriteria).toEqual(['First', 'Second']);
    });

    it('should parse bullet-format acceptance criteria', () => {
      const content = `---
id: bullet.task
module: test
priority: 1
status: pending
---

# Bullet Task

## Acceptance Criteria

- First criterion
- Second criterion
- Third criterion
`;

      const task = parseTaskContent(content);
      expect(task.acceptanceCriteria).toEqual(['First criterion', 'Second criterion', 'Third criterion']);
    });

    it('should parse indented continuation lines in acceptance criteria', () => {
      const content = `---
id: multiline.criteria
module: test
priority: 1
status: pending
---

# Multiline Criteria

## Acceptance Criteria

1. First criterion line
   more detail on the first criterion
- Second criterion
  with extra detail
`;

      const task = parseTaskContent(content);
      expect(task.acceptanceCriteria).toEqual([
        'First criterion line\nmore detail on the first criterion',
        'Second criterion\nwith extra detail',
      ]);
    });

    it('should parse empty acceptance criteria section', () => {
      const content = `---
id: empty.criteria
module: test
priority: 1
status: pending
---

# Empty Criteria

## Acceptance Criteria

## Notes
Some notes here
`;

      const task = parseTaskContent(content);
      expect(task.acceptanceCriteria).toEqual([]);
    });

    it('should parse parallelGroup field', () => {
      const content = `---
id: parallel.task
module: test
priority: 1
status: pending
parallelGroup: 2
---

# Parallel Task
`;

      const task = parseTaskContent(content);
      expect(task.parallelGroup).toBe(2);
    });

    it('should return undefined for empty notes', () => {
      const content = `---
id: notes.task
module: test
priority: 1
status: pending
---

# Notes Task

## Notes

## Other
`;

      const task = parseTaskContent(content);
      expect(task.notes).toBeUndefined();
    });

    it('should default priority to 0 when missing', () => {
      const content = `---
id: no.priority
module: test
status: pending
---

# No Priority
`;

      const task = parseTaskContent(content);
      expect(task.priority).toBe(0);
    });
  });

  describe('TaskParseError', () => {
    it('should throw TaskParseError for missing frontmatter', () => {
      expect(() => parseTaskContent('# No frontmatter')).toThrow(TaskParseError);
    });

    it('should throw TaskParseError with reason for missing required field', () => {
      const content = `---
module: test
priority: 1
status: pending
---

# No ID
`;

      try {
        parseTaskContent(content, '/test/no-id.md');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TaskParseError);
        const parsed = err as TaskParseError;
        expect(parsed.reason).toBe('missing_required_field');
        expect(parsed.filePath).toBe('/test/no-id.md');
        expect(parsed.message).toContain('id');
        expect(parsed.suggestion).toBeTruthy();
      }
    });

    it('should throw TaskParseError for invalid status', () => {
      const content = `---
id: test.bad
module: test
priority: 1
status: unknown_status
---

# Bad Status
`;

      try {
        parseTaskContent(content);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TaskParseError);
        expect((err as TaskParseError).reason).toBe('invalid_field_value');
        expect((err as TaskParseError).message).toContain('unknown_status');
      }
    });

    it('should throw TaskParseError for invalid YAML', () => {
      const content = '---\nid: [broken yaml\n---\n# Title';

      try {
        parseTaskContent(content);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TaskParseError);
        expect((err as TaskParseError).reason).toBe('invalid_yaml');
      }
    });

    it('should include suggestion in missing_frontmatter error', () => {
      try {
        splitFrontmatter('no frontmatter here');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TaskParseError);
        expect((err as TaskParseError).reason).toBe('missing_frontmatter');
        expect((err as TaskParseError).suggestion).toContain('---');
      }
    });
  });

  describe('parseIndex', () => {
    it('should parse existing index.json file', () => {
      const indexContent = {
        version: '1.0.0',
        updatedAt: '2024-01-18T10:00:00Z',
        metadata: {
          projectGoal: 'Build authentication system',
          languageConfig: {
            language: 'typescript',
            framework: 'express',
          },
        },
        tasks: {
          'auth.login': {
            status: 'completed',
            priority: 1,
            module: 'auth',
            description: 'Login endpoint',
            filePath: 'auth/login.md',
          },
          'auth.logout': {
            status: 'pending',
            priority: 2,
            module: 'auth',
            description: 'Logout endpoint',
          },
        },
      };

      fs.writeJSONSync(indexFile, indexContent);

      const index = TaskParser.parseIndex(indexFile);

      expect(index.version).toBe('1.0.0');
      expect(index.metadata.projectGoal).toBe('Build authentication system');
      expect(index.metadata.languageConfig.language).toBe('typescript');
      expect(index.tasks['auth.login'].status).toBe('completed');
      expect(index.tasks['auth.logout'].status).toBe('pending');
    });

    it('should return default structure for non-existent file', () => {
      const nonExistentPath = path.join(testDir, 'non-existent.json');

      const index = TaskParser.parseIndex(nonExistentPath);

      expect(index.version).toBe('1.0.0');
      expect(index.metadata.projectGoal).toBe('');
      expect(index.tasks).toEqual({});
      expect(index.updatedAt).toBeDefined();
    });

    it('should handle empty tasks object', () => {
      const indexContent = {
        version: '1.0.0',
        updatedAt: '2024-01-18T10:00:00Z',
        metadata: {
          projectGoal: 'Empty project',
        },
        tasks: {},
      };

      fs.writeJSONSync(indexFile, indexContent);

      const index = TaskParser.parseIndex(indexFile);

      expect(index.tasks).toEqual({});
    });
  });

  // -----------------------------------------------------------------------
  // Document-mode authoring validation
  // -----------------------------------------------------------------------

  describe('validateTaskForCreation', () => {
    /** Helper: build a valid config with sensible defaults */
    function validConfig(overrides: Record<string, any> = {}) {
      return {
        id: 'auth.login',
        module: 'auth',
        priority: 2,
        status: 'pending' as const,
        description: 'Implement Login UI',
        acceptanceCriteria: ['Login form renders', 'Validation works'],
        estimatedMinutes: 25,
        dependencies: ['setup.scaffold'],
        ...overrides,
      };
    }

    it('should return empty violations for a valid task', () => {
      const violations = validateTaskForCreation(validConfig());
      expect(violations).toEqual([]);
    });

    it('should report violation when title is missing', () => {
      const violations = validateTaskForCreation(validConfig({ description: '' }));
      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'description', reason: expect.stringContaining('title') }),
        ])
      );
    });

    it('should report violation when acceptance criteria are empty', () => {
      const violations = validateTaskForCreation(validConfig({ acceptanceCriteria: [] }));
      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'acceptanceCriteria' }),
        ])
      );
    });

    it('should report violation when priority is missing (0)', () => {
      const violations = validateTaskForCreation(validConfig({ priority: 0 }));
      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'priority' }),
        ])
      );
    });

    it('should report violation when priority is negative', () => {
      const violations = validateTaskForCreation(validConfig({ priority: -1 }));
      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'priority' }),
        ])
      );
    });

    it('should report violation when estimatedMinutes is negative', () => {
      const violations = validateTaskForCreation(validConfig({ estimatedMinutes: -5 }));
      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'estimatedMinutes' }),
        ])
      );
    });

    it('should report violation when estimatedMinutes is Infinity', () => {
      const violations = validateTaskForCreation(validConfig({ estimatedMinutes: Infinity }));
      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'estimatedMinutes' }),
        ])
      );
    });

    it('should report violation when estimatedMinutes is zero', () => {
      const violations = validateTaskForCreation(validConfig({ estimatedMinutes: 0 }));
      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'estimatedMinutes', reason: expect.stringContaining('positive integer') }),
        ])
      );
    });

    it('should report violation when estimatedMinutes is fractional', () => {
      const violations = validateTaskForCreation(validConfig({ estimatedMinutes: 1.5 }));
      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'estimatedMinutes', reason: expect.stringContaining('positive integer') }),
        ])
      );
    });

    it('should accept valid estimatedMinutes', () => {
      const violations = validateTaskForCreation(validConfig({ estimatedMinutes: 30 }));
      expect(violations).toEqual([]);
    });

    it('should not report violation when estimatedMinutes is omitted', () => {
      const { estimatedMinutes, ...config } = validConfig();
      const violations = validateTaskForCreation(config as any);
      const emViolations = violations.filter((v) => v.field === 'estimatedMinutes');
      expect(emViolations).toEqual([]);
    });

    it('should report violation when status is not pending', () => {
      const violations = validateTaskForCreation(validConfig({ status: 'in_progress' }));
      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'status', reason: expect.stringContaining('pending') }),
        ])
      );
    });

    it('should report violation for startedAt runtime field', () => {
      const violations = validateTaskForCreation(validConfig({ startedAt: '2026-04-17T10:00:00Z' }));
      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'startedAt' }),
        ])
      );
    });

    it('should report violation for completedAt runtime field', () => {
      const violations = validateTaskForCreation(validConfig({ completedAt: '2026-04-17T12:00:00Z' }));
      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'completedAt' }),
        ])
      );
    });

    it('should report violation for failedAt runtime field', () => {
      const violations = validateTaskForCreation(validConfig({ failedAt: '2026-04-17T14:00:00Z' }));
      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'failedAt' }),
        ])
      );
    });

    it('should report violation when id does not start with module prefix', () => {
      const violations = validateTaskForCreation(validConfig({ id: 'wrong.task', module: 'auth' }));
      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'id', reason: expect.stringContaining('module prefix') }),
        ])
      );
    });

    it('should report violation when name is empty after module prefix', () => {
      const violations = validateTaskForCreation(validConfig({ id: 'auth.', module: 'auth' }));
      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'id', reason: expect.stringContaining('empty') }),
        ])
      );
    });

    it('should accumulate multiple violations', () => {
      const violations = validateTaskForCreation({
        id: 'wrong.',
        module: 'auth',
        priority: 0,
        status: 'in_progress' as const,
        description: '',
        acceptanceCriteria: [],
      });
      // At least: description, acceptanceCriteria, priority, status, id (mismatch + empty)
      expect(violations.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('validateDependencyShape', () => {
    it('should accept null', () => {
      expect(validateDependencyShape(null)).toBeNull();
    });

    it('should accept undefined', () => {
      expect(validateDependencyShape(undefined)).toBeNull();
    });

    it('should accept an array of strings', () => {
      expect(validateDependencyShape(['a.b', 'c.d'])).toBeNull();
    });

    it('should accept a comma-separated string', () => {
      expect(validateDependencyShape('a.b, c.d')).toBeNull();
    });

    it('should reject an empty string', () => {
      const result = validateDependencyShape('');
      expect(result).toEqual(
        expect.objectContaining({ field: 'dependencies', reason: expect.stringContaining('blank') })
      );
    });

    it('should reject blank comma-separated entries', () => {
      const result = validateDependencyShape('a.b,');
      expect(result).toEqual(
        expect.objectContaining({ field: 'dependencies', reason: expect.stringContaining('blank') })
      );
    });

    it('should reject blank array entries', () => {
      const result = validateDependencyShape(['a.b', '   ']);
      expect(result).toEqual(
        expect.objectContaining({ field: 'dependencies', reason: expect.stringContaining('blank') })
      );
    });

    it('should reject comma-only dependencies', () => {
      const result = validateDependencyShape(',');
      expect(result).toEqual(
        expect.objectContaining({ field: 'dependencies', reason: expect.stringContaining('blank') })
      );
    });

    it('should reject a number', () => {
      const result = validateDependencyShape(42);
      expect(result).toEqual(
        expect.objectContaining({ field: 'dependencies', reason: expect.stringContaining('number') })
      );
    });

    it('should reject an object', () => {
      const result = validateDependencyShape({ key: 'val' });
      expect(result).toEqual(
        expect.objectContaining({ field: 'dependencies', reason: expect.stringContaining('object') })
      );
    });

    it('should reject an array containing a number', () => {
      const result = validateDependencyShape(['a.b', 42] as any);
      expect(result).toEqual(
        expect.objectContaining({ field: 'dependencies', reason: expect.stringContaining('strings') })
      );
    });

    it('should reject an array containing an object', () => {
      const result = validateDependencyShape([{ key: 'val' }] as any);
      expect(result).toEqual(
        expect.objectContaining({ field: 'dependencies', reason: expect.stringContaining('strings') })
      );
    });

    it('should accept an empty array', () => {
      expect(validateDependencyShape([])).toBeNull();
    });
  });

  describe('isPathSafeSegment', () => {
    it('should accept valid segments', () => {
      expect(isPathSafeSegment('auth')).toBe(true);
      expect(isPathSafeSegment('login')).toBe(true);
      expect(isPathSafeSegment('my-module')).toBe(true);
      expect(isPathSafeSegment('module_name')).toBe(true);
    });

    it('should reject empty string', () => {
      expect(isPathSafeSegment('')).toBe(false);
    });

    it('should reject parent traversal ..', () => {
      expect(isPathSafeSegment('..')).toBe(false);
    });

    it('should reject current-directory traversal .', () => {
      expect(isPathSafeSegment('.')).toBe(false);
    });

    it('should reject forward slash', () => {
      expect(isPathSafeSegment('path/to')).toBe(false);
    });

    it('should reject backslash', () => {
      expect(isPathSafeSegment('path\\to')).toBe(false);
    });

    it('should reject Windows drive letter prefix', () => {
      expect(isPathSafeSegment('C:')).toBe(false);
      expect(isPathSafeSegment('c:file')).toBe(false);
      expect(isPathSafeSegment('D:')).toBe(false);
    });

    it('should accept segments that look like drive letters but are not', () => {
      // Single char without colon is fine
      expect(isPathSafeSegment('C')).toBe(true);
    });
  });
});
