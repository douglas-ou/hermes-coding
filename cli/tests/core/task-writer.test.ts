import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as yaml from 'yaml';
import { TaskWriter } from '../../src/core/task-writer';
import { TaskConfig } from '../../src/domain/task-entity';

type Task = TaskConfig;

describe('TaskWriter', () => {
  const testDir = path.join(__dirname, '__test-task-writer__');
  const tasksDir = path.join(testDir, 'tasks');

  beforeEach(() => {
    fs.ensureDirSync(testDir);
    fs.ensureDirSync(tasksDir);
  });

  afterEach(() => {
    fs.removeSync(testDir);
  });

  describe('writeTaskFile', () => {
    it('should write a basic task file with all required fields', () => {
      const task: Task = {
        id: 'auth.login',
        module: 'auth',
        priority: 1,
        status: 'pending',
        description: 'Implement user login',
        acceptanceCriteria: [
          'User can login with email and password',
          'Invalid credentials show error message',
        ],
      };

      const filePath = TaskWriter.writeTaskFile(tasksDir, task);

      expect(filePath).toBe(path.join(tasksDir, 'auth', 'login.md'));
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('---');
      expect(content).toContain('id: auth.login');
      expect(content).toContain('module: auth');
      expect(content).toContain('priority: 1');
      expect(content).toContain('status: pending');
      expect(content).toContain('# Implement user login');
      expect(content).toContain('## Acceptance Criteria');
      expect(content).toContain('1. User can login with email and password');
      expect(content).toContain('2. Invalid credentials show error message');
    });

    it('should write a task file with notes', () => {
      const task: Task = {
        id: 'auth.login',
        module: 'auth',
        priority: 1,
        status: 'pending',
        description: 'Implement user login',
        acceptanceCriteria: ['User can login'],
        notes: 'Use bcrypt for password hashing',
      };

      const filePath = TaskWriter.writeTaskFile(tasksDir, task);
      const content = fs.readFileSync(filePath, 'utf-8');

      expect(content).toContain('## Notes');
      expect(content).toContain('Use bcrypt for password hashing');
    });

    it('should write a task file without notes section when notes is undefined', () => {
      const task: Task = {
        id: 'auth.login',
        module: 'auth',
        priority: 1,
        status: 'pending',
        description: 'Implement user login',
        acceptanceCriteria: ['User can login'],
      };

      const filePath = TaskWriter.writeTaskFile(tasksDir, task);
      const content = fs.readFileSync(filePath, 'utf-8');

      expect(content).not.toContain('## Notes');
    });

    it('should write a task file with optional fields', () => {
      const task: Task = {
        id: 'auth.login',
        module: 'auth',
        priority: 2,
        status: 'in_progress',
        estimatedMinutes: 120,
        dependencies: ['auth.setup'],
        parallelGroup: 2,
        testRequirements: {
          unit: {
            required: true,
            pattern: '**/*.test.ts',
          },
        },
        description: 'Implement user login',
        acceptanceCriteria: ['User can login'],
      };

      const filePath = TaskWriter.writeTaskFile(tasksDir, task);
      const content = fs.readFileSync(filePath, 'utf-8');

      expect(content).toContain('estimatedMinutes: 120');
      expect(content).toContain('dependencies:');
      expect(content).toContain('- auth.setup');
      expect(content).toContain('parallelGroup: 2');
      expect(content).toContain('testRequirements:');
    });

    it('should create module directory if it does not exist', () => {
      const task: Task = {
        id: 'database.migration',
        module: 'database',
        priority: 1,
        status: 'pending',
        description: 'Database migration',
        acceptanceCriteria: ['Migration runs successfully'],
      };

      const moduleDir = path.join(tasksDir, 'database');
      expect(fs.existsSync(moduleDir)).toBe(false);

      TaskWriter.writeTaskFile(tasksDir, task);

      expect(fs.existsSync(moduleDir)).toBe(true);
    });

    it('should handle task with empty acceptance criteria', () => {
      const task: Task = {
        id: 'auth.login',
        module: 'auth',
        priority: 1,
        status: 'pending',
        description: 'Implement user login',
        acceptanceCriteria: [],
      };

      const filePath = TaskWriter.writeTaskFile(tasksDir, task);
      const content = fs.readFileSync(filePath, 'utf-8');

      expect(content).not.toContain('## Acceptance Criteria');
    });

    it('should handle complex module paths', () => {
      const task: Task = {
        id: 'api.v2.users.create',
        module: 'api.v2.users',
        priority: 1,
        status: 'pending',
        description: 'Create user endpoint',
        acceptanceCriteria: ['Endpoint works'],
      };

      const filePath = TaskWriter.writeTaskFile(tasksDir, task);

      expect(filePath).toBe(path.join(tasksDir, 'api.v2.users', 'create.md'));
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('should return the correct file path', () => {
      const task: Task = {
        id: 'test.example',
        module: 'test',
        priority: 1,
        status: 'pending',
        description: 'Test task',
        acceptanceCriteria: [],
      };

      const filePath = TaskWriter.writeTaskFile(tasksDir, task);

      expect(filePath).toBe(path.join(tasksDir, 'test', 'example.md'));
    });
  });

  describe('updateTaskStatus', () => {
    let testFilePath: string;

    beforeEach(() => {
      const task: Task = {
        id: 'auth.login',
        module: 'auth',
        priority: 1,
        status: 'pending',
        description: 'Implement user login',
        acceptanceCriteria: ['User can login'],
      };
      testFilePath = TaskWriter.writeTaskFile(tasksDir, task);
    });

    it('should update task status from pending to in_progress', () => {
      TaskWriter.updateTaskStatus(testFilePath, 'in_progress');

      const content = fs.readFileSync(testFilePath, 'utf-8');
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
      expect(frontmatterMatch).toBeTruthy();

      const frontmatter = yaml.parse(frontmatterMatch![1]);
      expect(frontmatter.status).toBe('in_progress');
    });

    it('should update task status from in_progress to completed', () => {
      TaskWriter.updateTaskStatus(testFilePath, 'in_progress');
      TaskWriter.updateTaskStatus(testFilePath, 'completed');

      const content = fs.readFileSync(testFilePath, 'utf-8');
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
      const frontmatter = yaml.parse(frontmatterMatch![1]);

      expect(frontmatter.status).toBe('completed');
    });

    it('should preserve all other frontmatter fields', () => {
      const originalContent = fs.readFileSync(testFilePath, 'utf-8');
      const originalFrontmatterMatch = originalContent.match(/^---\n([\s\S]*?)\n---\n/);
      const originalFrontmatter = yaml.parse(originalFrontmatterMatch![1]);

      TaskWriter.updateTaskStatus(testFilePath, 'completed');

      const newContent = fs.readFileSync(testFilePath, 'utf-8');
      const newFrontmatterMatch = newContent.match(/^---\n([\s\S]*?)\n---\n/);
      const newFrontmatter = yaml.parse(newFrontmatterMatch![1]);

      expect(newFrontmatter.id).toBe(originalFrontmatter.id);
      expect(newFrontmatter.module).toBe(originalFrontmatter.module);
      expect(newFrontmatter.priority).toBe(originalFrontmatter.priority);
    });

    it('should preserve body content when updating status', () => {
      const originalContent = fs.readFileSync(testFilePath, 'utf-8');
      const originalBody = originalContent.split('---\n')[2];

      TaskWriter.updateTaskStatus(testFilePath, 'completed');

      const newContent = fs.readFileSync(testFilePath, 'utf-8');
      const newBody = newContent.split('---\n')[2];

      expect(newBody).toBe(originalBody);
    });

    it('should throw error for invalid file format', () => {
      const invalidFilePath = path.join(testDir, 'invalid.md');
      fs.writeFileSync(invalidFilePath, 'Invalid content without frontmatter', 'utf-8');

      expect(() => {
        TaskWriter.updateTaskStatus(invalidFilePath, 'completed');
      }).toThrow('Invalid task file format');
    });

    it('should handle all valid status values', () => {
      const statuses: Task['status'][] = ['pending', 'in_progress', 'completed', 'blocked', 'failed'];

      statuses.forEach(status => {
        TaskWriter.updateTaskStatus(testFilePath, status);

        const content = fs.readFileSync(testFilePath, 'utf-8');
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
        const frontmatter = yaml.parse(frontmatterMatch![1]);

        expect(frontmatter.status).toBe(status);
      });
    });
  });

  describe('appendNotes', () => {
    let testFilePath: string;

    beforeEach(() => {
      const task: Task = {
        id: 'auth.login',
        module: 'auth',
        priority: 1,
        status: 'pending',
        description: 'Implement user login',
        acceptanceCriteria: ['User can login'],
      };
      testFilePath = TaskWriter.writeTaskFile(tasksDir, task);
    });

    it('should add notes section to task without existing notes', () => {
      TaskWriter.appendNotes(testFilePath, 'This is a new note');

      const content = fs.readFileSync(testFilePath, 'utf-8');
      expect(content).toContain('## Notes');
      expect(content).toContain('This is a new note');
    });

    it('should append to existing notes', () => {
      // First add initial notes
      TaskWriter.appendNotes(testFilePath, 'Initial note');

      // Then append more notes
      TaskWriter.appendNotes(testFilePath, 'Additional note');

      const content = fs.readFileSync(testFilePath, 'utf-8');
      expect(content).toContain('Initial note');
      expect(content).toContain('Additional note');
    });

    it('should handle multiple append operations', () => {
      // Append multiple notes in sequence
      TaskWriter.appendNotes(testFilePath, 'First note added');
      TaskWriter.appendNotes(testFilePath, 'Second note added');
      TaskWriter.appendNotes(testFilePath, 'Third note added');

      const content = fs.readFileSync(testFilePath, 'utf-8');

      // All three notes should be present in the file
      expect(content).toContain('First note added');
      expect(content).toContain('Second note added');
      expect(content).toContain('Third note added');

      // Verify notes section exists
      expect(content).toContain('## Notes');
    });

    it('should preserve frontmatter when appending notes', () => {
      const originalContent = fs.readFileSync(testFilePath, 'utf-8');
      const originalFrontmatterMatch = originalContent.match(/^---\n([\s\S]*?)\n---\n/);
      const originalFrontmatter = yaml.parse(originalFrontmatterMatch![1]);

      TaskWriter.appendNotes(testFilePath, 'New note');

      const newContent = fs.readFileSync(testFilePath, 'utf-8');
      const newFrontmatterMatch = newContent.match(/^---\n([\s\S]*?)\n---\n/);
      const newFrontmatter = yaml.parse(newFrontmatterMatch![1]);

      expect(newFrontmatter).toEqual(originalFrontmatter);
    });

    it('should preserve other body sections when appending notes', () => {
      TaskWriter.appendNotes(testFilePath, 'New note');

      const content = fs.readFileSync(testFilePath, 'utf-8');
      expect(content).toContain('# Implement user login');
      expect(content).toContain('## Acceptance Criteria');
    });

    it('should throw error for invalid file format', () => {
      const invalidFilePath = path.join(testDir, 'invalid.md');
      fs.writeFileSync(invalidFilePath, 'Invalid content without frontmatter', 'utf-8');

      expect(() => {
        TaskWriter.appendNotes(invalidFilePath, 'New note');
      }).toThrow('Invalid task file format');
    });

    it('should handle multiline notes', () => {
      const multilineNote = 'Line 1\nLine 2\nLine 3';
      TaskWriter.appendNotes(testFilePath, multilineNote);

      const content = fs.readFileSync(testFilePath, 'utf-8');
      expect(content).toContain('Line 1');
      expect(content).toContain('Line 2');
      expect(content).toContain('Line 3');
    });

    it('should append notes to task file that already has notes from creation', () => {
      // Create a task with initial notes
      const taskWithNotes: Task = {
        id: 'auth.signup',
        module: 'auth',
        priority: 1,
        status: 'pending',
        description: 'Implement user signup',
        acceptanceCriteria: ['User can signup'],
        notes: 'Initial notes from task creation',
      };
      const filePathWithNotes = TaskWriter.writeTaskFile(tasksDir, taskWithNotes);

      // Append additional notes
      TaskWriter.appendNotes(filePathWithNotes, 'Additional notes appended later');

      const content = fs.readFileSync(filePathWithNotes, 'utf-8');
      expect(content).toContain('Initial notes from task creation');
      expect(content).toContain('Additional notes appended later');
    });

    it('should handle notes with special characters', () => {
      const notesWithSpecialChars = 'Note with "quotes" and \'apostrophes\' and $symbols';
      TaskWriter.appendNotes(testFilePath, notesWithSpecialChars);

      const content = fs.readFileSync(testFilePath, 'utf-8');
      expect(content).toContain(notesWithSpecialChars);
    });
  });

  describe('immutable body + format preservation', () => {
    it('should preserve body byte-for-byte when updating status with complex markdown', () => {
      const complexBody = `# Complex Task

## Acceptance Criteria

1. First criterion
2. Second criterion

\`\`\`typescript
const x = 1;
const obj = { a: 1, b: 2 };
// This code block should NOT be modified
\`\`\`

| Column A | Column B |
|----------|----------|
| Cell 1   | Cell 2   |

> Blockquote with **bold** and *italic*

---

Horizontal rule above

### Sub-heading

- [ ] Unchecked item
- [x] Checked item
`;

      const content = `---
id: complex.task
module: test
priority: 1
status: pending
---
${complexBody}`;

      const complexFile = path.join(testDir, 'complex.md');
      fs.writeFileSync(complexFile, content, 'utf-8');

      const originalBody = content.split('---\n').slice(2).join('---\n');

      TaskWriter.updateTaskStatus(complexFile, 'in_progress');

      const newContent = fs.readFileSync(complexFile, 'utf-8');
      const newBody = newContent.split('---\n').slice(2).join('---\n');

      expect(newBody).toBe(originalBody);
    });

    it('should preserve frontmatter comments when updating status', () => {
      const content = `---
# This is an important comment
id: comment.task
module: test
priority: 1
status: pending
---
# Task
`;

      const commentFile = path.join(testDir, 'comment.md');
      fs.writeFileSync(commentFile, content, 'utf-8');

      TaskWriter.updateTaskStatus(commentFile, 'completed');

      const newContent = fs.readFileSync(commentFile, 'utf-8');
      expect(newContent).toContain('# This is an important comment');
      expect(newContent).toContain('status: completed');
    });

    it('should preserve frontmatter field order when updating status', () => {
      const content = `---
id: order.task
module: test
priority: 3
status: pending
estimatedMinutes: 30
---
# Task
`;

      const orderFile = path.join(testDir, 'order.md');
      fs.writeFileSync(orderFile, content, 'utf-8');

      TaskWriter.updateTaskStatus(orderFile, 'in_progress');

      const newContent = fs.readFileSync(orderFile, 'utf-8');
      const lines = newContent.split('\n');

      // Check order: id comes before module, module before priority, etc.
      const idIdx = lines.findIndex(l => l.startsWith('id:'));
      const moduleIdx = lines.findIndex(l => l.startsWith('module:'));
      const priorityIdx = lines.findIndex(l => l.startsWith('priority:'));
      const statusIdx = lines.findIndex(l => l.startsWith('status:'));

      expect(idIdx).toBeLessThan(moduleIdx);
      expect(moduleIdx).toBeLessThan(priorityIdx);
      expect(priorityIdx).toBeLessThan(statusIdx);
    });

    it('should preserve existing body when appending notes', () => {
      const body = `# Task Title

## Acceptance Criteria

1. Do something

## Extra Section

Some custom content here with \`code\` and **formatting**.
`;

      const content = `---
id: body.task
module: test
priority: 1
status: pending
---
${body}`;

      const bodyFile = path.join(testDir, 'body.md');
      fs.writeFileSync(bodyFile, content, 'utf-8');

      TaskWriter.appendNotes(bodyFile, 'New note added');

      const newContent = fs.readFileSync(bodyFile, 'utf-8');
      expect(newContent).toContain('## Extra Section');
      expect(newContent).toContain('Some custom content here');
      expect(newContent).toContain('New note added');
    });
  });
});
