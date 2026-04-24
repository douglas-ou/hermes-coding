/**
 * progress.txt — simple append-only progress log.
 *
 * Two tiers:
 *   - Project-level: .hermes-coding/progress.txt
 *   - Task-level:    .hermes-coding/tasks/{module}/{id}.progress.txt
 *
 * Writing is enforced through CLI commands. Reading is done directly by skills via cat/Read.
 */

import * as path from 'path';
import type { IFileSystem } from '../infrastructure/file-system';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function getProgressTxtPath(workspaceDir: string): string {
  return path.join(workspaceDir, '.hermes-coding', 'progress.txt');
}

export function getTaskProgressPath(workspaceDir: string, taskId: string, module: string): string {
  return path.join(workspaceDir, '.hermes-coding', 'tasks', module, `${taskId}.progress.txt`);
}

export function getSagaLogPath(workspaceDir: string): string {
  return path.join(workspaceDir, '.hermes-coding', 'saga.log');
}

// ---------------------------------------------------------------------------
// Ensure helpers
// ---------------------------------------------------------------------------

async function ensureProgressTxt(fs: IFileSystem, workspaceDir: string): Promise<void> {
  const p = getProgressTxtPath(workspaceDir);
  await fs.ensureDir(path.dirname(p));
  if (!(await fs.exists(p))) {
    const template = [
      '# Project Progress',
      '',
      '## Falsified Paths',
      'Approaches that do not work — avoid repeating these mistakes.',
      '',
      '## Hidden Constraints',
      'Non-obvious dependencies and constraints discovered in the codebase.',
      '',
      '## Verified Approaches',
      'Non-obvious patterns that work — only record if not self-evident.',
      '',
      '## Active Risks',
      'Unresolved issues that may affect future tasks.',
      '',
    ].join('\n');
    await fs.writeFile(p, template, { encoding: 'utf-8' });
  }
}

async function ensureTaskProgress(
  fs: IFileSystem,
  workspaceDir: string,
  taskId: string,
  module: string
): Promise<string> {
  const p = getTaskProgressPath(workspaceDir, taskId, module);
  await fs.ensureDir(path.dirname(p));
  if (!(await fs.exists(p))) {
    await fs.writeFile(p, `# Task Progress: ${taskId}\n`, { encoding: 'utf-8' });
  }
  return p;
}

// ---------------------------------------------------------------------------
// Append functions
// ---------------------------------------------------------------------------

/**
 * Append a timestamped line to the project-level progress file.
 */
export async function appendToProjectProgress(
  fs: IFileSystem,
  workspaceDir: string,
  content: string
): Promise<void> {
  await ensureProgressTxt(fs, workspaceDir);
  const p = getProgressTxtPath(workspaceDir);
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${content}\n`;
  await fs.appendFile(p, line, { encoding: 'utf-8' });
}

/**
 * Append a timestamped line to a task-scoped progress file.
 */
export async function appendToTaskProgress(
  fs: IFileSystem,
  workspaceDir: string,
  taskId: string,
  module: string,
  content: string
): Promise<void> {
  const p = await ensureTaskProgress(fs, workspaceDir, taskId, module);
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${content}\n`;
  await fs.appendFile(p, line, { encoding: 'utf-8' });
}

// ---------------------------------------------------------------------------
// Saga audit log
// ---------------------------------------------------------------------------

/**
 * Append one lifecycle audit entry to .hermes-coding/saga.log.
 */
export async function appendSagaActivityLine(
  fs: IFileSystem,
  workspaceDir: string,
  action: string,
  taskId: string,
  details?: string
): Promise<void> {
  const logPath = getSagaLogPath(workspaceDir);
  const timestamp = new Date().toISOString();
  const line = details
    ? `[${timestamp}] ${action}: ${taskId} - ${details}\n`
    : `[${timestamp}] ${action}: ${taskId}\n`;

  await fs.ensureDir(path.dirname(logPath));
  await fs.appendFile(logPath, line, { encoding: 'utf-8' });
}
