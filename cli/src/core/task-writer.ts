import * as fs from 'fs-extra';
import * as path from 'path';
import * as yaml from 'yaml';
import { TaskConfig } from '../domain/task-entity';

/**
 * Derive task file path from task ID, module, and tasks directory.
 * Convention: {tasksDir}/{module}/{name}.md where id = "module.name"
 *
 * Module is passed explicitly because IDs like "api.v2.users.create" have
 * module "api.v2.users" — the first dot alone can't determine the module.
 */
export function extractTaskFilePath(id: string, module: string, tasksDir: string): string {
  const fileName = id.replace(`${module}.`, '') + '.md';
  return path.join(tasksDir, module, fileName);
}

export class TaskWriter {
  /**
   * Write a NEW task to a markdown file with YAML frontmatter.
   * Only used for initial creation — never for updates.
   */
  static writeTaskFile(tasksDir: string, task: TaskConfig): string {
    const filePath = extractTaskFilePath(task.id, task.module, tasksDir);

    fs.ensureDirSync(path.dirname(filePath));

    const { description, acceptanceCriteria, notes, ...frontmatter } = task;

    let content = '---\n';
    content += yaml.stringify(frontmatter);
    content += '---\n\n';
    content += `# ${description}\n\n`;

    if (acceptanceCriteria && acceptanceCriteria.length > 0) {
      content += '## Acceptance Criteria\n\n';
      acceptanceCriteria.forEach((criterion, index) => {
        content += `${index + 1}. ${criterion}\n`;
      });
      content += '\n';
    }

    if (notes) {
      content += '## Notes\n\n';
      content += `${notes}\n`;
    }

    fs.writeFileSync(filePath, content, 'utf-8');

    return filePath;
  }

  /**
   * Update a single frontmatter field using line-level replacement.
   * Body content is preserved byte-for-byte.
   */
  static updateFrontmatterField(
    filePath: string,
    field: string,
    value: string | number
  ): void {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
    const lines = content.split(/\r?\n/);

    // Find frontmatter boundaries
    const firstDelimiter = lines.findIndex((l) => l.trim() === '---');
    if (firstDelimiter === -1) {
      throw new Error(`Invalid task file format: ${filePath}`);
    }

    const secondDelimiter = lines.findIndex(
      (l, i) => i > firstDelimiter && l.trim() === '---'
    );
    if (secondDelimiter === -1) {
      throw new Error(`Invalid task file format: ${filePath}`);
    }

    // Search for the target field in frontmatter
    const fieldRegex = new RegExp(`^${field}\\s*:`);
    let found = false;

    for (let i = firstDelimiter + 1; i < secondDelimiter; i++) {
      if (fieldRegex.test(lines[i])) {
        lines[i] = `${field}: ${value}`;
        found = true;
        break;
      }
    }

    // If field not found, insert before closing ---
    if (!found) {
      lines.splice(secondDelimiter, 0, `${field}: ${value}`);
    }

    fs.writeFileSync(filePath, lines.join(lineEnding), 'utf-8');
  }

  /**
   * Update task status in the markdown file.
   * Uses line-level replacement — body content is byte-for-byte preserved.
   */
  static updateTaskStatus(
    filePath: string,
    status: TaskConfig['status']
  ): void {
    TaskWriter.updateFrontmatterField(filePath, 'status', status);
  }

  /**
   * Append notes to a task file without rewriting existing body content.
   * Finds the ## Notes section and appends; or adds a new section at the end.
   */
  static appendNotes(filePath: string, newNotes: string): void {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';

    const lines = content.split(/\r?\n/);

    // Find frontmatter boundaries to separate frontmatter from body
    const firstDelimiter = lines.findIndex((l) => l.trim() === '---');
    const secondDelimiter = lines.findIndex(
      (l, i) => i > firstDelimiter && l.trim() === '---'
    );

    if (firstDelimiter === -1 || secondDelimiter === -1) {
      throw new Error(`Invalid task file format: ${filePath}`);
    }

    const bodyStart = secondDelimiter + 1;
    const bodyLines = lines.slice(bodyStart);
    const bodyContent = bodyLines.join(lineEnding);

    // Check if ## Notes section exists in the body
    const notesRegex = /^##\s+Notes\s*$/m;
    const notesMatch = bodyContent.match(notesRegex);

    if (notesMatch) {
      // Find the index of ## Notes in the body lines and append after it
      const notesLineIndex = bodyLines.findIndex((l) => /^##\s+Notes\s*$/.test(l));

      // Insert the new note after the ## Notes line
      bodyLines.splice(notesLineIndex + 1, 0, '', newNotes);
    } else {
      // Append new ## Notes section at the end
      bodyLines.push('', '## Notes', '', newNotes);
    }

    // Reconstruct: frontmatter lines + body lines
    const frontmatterLines = lines.slice(0, bodyStart);
    const result = [...frontmatterLines, ...bodyLines].join(lineEnding);

    fs.writeFileSync(filePath, result, 'utf-8');
  }
}
