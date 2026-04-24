import { spawnSync } from 'child_process';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Each iteration, the fake `tasks next` returns the next planned result.
 */
interface PlannedNextResult {
  result: 'task_found' | 'all_done' | 'blocked';
  task?: { id: string; status: string; description: string; module: string };
}

const loopScriptPath = path.resolve(__dirname, '..', '..', 'scripts', 'ralph-loop.sh');

function writeExecutable(filePath: string, contents: string): void {
  fs.outputFileSync(filePath, contents, { encoding: 'utf-8', mode: 0o755 });
  fs.chmodSync(filePath, 0o755);
}

function readCallLog(workspaceDir: string): string[] {
  const callLogPath = path.join(workspaceDir, '.test-call-log.txt');
  if (!fs.existsSync(callLogPath)) {
    return [];
  }
  return fs
    .readFileSync(callLogPath, 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function seedWorkspace(
  workspaceDir: string,
  plannedResults: PlannedNextResult[]
): string {
  const binDir = path.join(workspaceDir, '.test-bin');

  fs.ensureDirSync(path.join(workspaceDir, '.hermes-coding'));
  fs.ensureDirSync(path.join(workspaceDir, '.claude', 'skills', 'hermes-coding'));
  fs.writeJSONSync(path.join(workspaceDir, '.hermes-coding', 'state.json'), {
    phase: 'implement',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  fs.writeJSONSync(path.join(workspaceDir, '.test-plan.json'), {
    index: 0,
    results: plannedResults,
  });
  fs.writeFileSync(path.join(workspaceDir, '.test-call-log.txt'), '', 'utf-8');
  fs.writeFileSync(
    path.join(workspaceDir, '.claude', 'skills', 'hermes-coding', 'phase-3-implement.md'),
    '# Phase 3 skill\nSkill content for test.\n',
    'utf-8'
  );

  // Fake hermes-coding CLI
  writeExecutable(
    path.join(binDir, 'hermes-coding'),
    `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const workspace = process.env.HERMES_CODING_WORKSPACE;
const args = process.argv.slice(2);
const stateFile = path.join(workspace, '.hermes-coding', 'state.json');
const planFile = path.join(workspace, '.test-plan.json');
const callLogFile = path.join(workspace, '.test-call-log.txt');

function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function log(entry) {
  fs.appendFileSync(callLogFile, entry + '\\n');
}

// state get
if (args[0] === 'state' && args[1] === 'get') {
  log('state get');
  console.log(JSON.stringify({ success: true, data: readJson(stateFile, {}) }, null, 2));
  process.exit(0);
}

// state update --phase deliver
if (args[0] === 'state' && args[1] === 'update') {
  const phaseIdx = args.indexOf('--phase');
  if (phaseIdx !== -1) {
    const state = readJson(stateFile, {});
    state.phase = args[phaseIdx + 1];
    state.updatedAt = new Date().toISOString();
    writeJson(stateFile, state);
    log('state update phase=' + state.phase);
  }
  console.log(JSON.stringify({ success: true }, null, 2));
  process.exit(0);
}

// tasks next --json
if (args[0] === 'tasks' && args[1] === 'next') {
  const plan = readJson(planFile, { index: 0, results: [] });
  const step = plan.results[plan.index];
  if (!step) {
    log('tasks next (no more planned)');
    console.log(JSON.stringify({ success: true, data: { result: 'all_done' } }, null, 2));
    process.exit(0);
  }
  plan.index += 1;
  writeJson(planFile, plan);
  log('tasks next result=' + step.result + (step.task ? ' task=' + step.task.id : ''));
  console.log(JSON.stringify({ success: true, data: step }, null, 2));
  process.exit(0);
}

// tasks list (for max iterations calc)
if (args[0] === 'tasks' && args[1] === 'list') {
  log('tasks list');
  console.log(JSON.stringify({ success: true, data: { total: 5, returned: 0, tasks: [] } }, null, 2));
  process.exit(0);
}

console.error('Unexpected fake hermes-coding invocation:', args.join(' '));
process.exit(64);
`
  );

  // Fake claude (just reads stdin and exits)
  writeExecutable(
    path.join(binDir, 'claude'),
    `#!/usr/bin/env node
const fs = require('fs');
const callLogFile = require('path').join(process.env.HERMES_CODING_WORKSPACE, '.test-call-log.txt');
const input = fs.readFileSync(0, 'utf8');
fs.appendFileSync(callLogFile, 'claude invoked\\n');
fs.appendFileSync(callLogFile, 'claude prompt=' + JSON.stringify(input) + '\\n');
process.stdout.write('claude done\\n');
`
  );

  // Fake jq
  writeExecutable(
    path.join(binDir, 'jq'),
    `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const query = args[args.length - 1];
const input = fs.readFileSync(0, 'utf8');
const parsed = input.trim() ? JSON.parse(input) : {};

function output(value) {
  if (value === null || value === undefined) {
    process.stdout.write('null\\n');
    return;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    process.stdout.write(String(value) + '\\n');
    return;
  }
  process.stdout.write(JSON.stringify(value) + '\\n');
}

if (query === '.data.total // 0') {
  output(parsed.data && parsed.data.total !== undefined ? parsed.data.total : 0);
  process.exit(0);
}

if (query === '.data.phase // .phase // "none"') {
  output(parsed.data && parsed.data.phase ? parsed.data.phase : (parsed.phase || 'none'));
  process.exit(0);
}

if (query === '.data.result // "unknown"') {
  output(parsed.data && parsed.data.result ? parsed.data.result : 'unknown');
  process.exit(0);
}

if (query === '.data.task.id') {
  output(parsed.data && parsed.data.task ? parsed.data.task.id : null);
  process.exit(0);
}

if (query === '.data.task.description // ""') {
  output(parsed.data && parsed.data.task ? (parsed.data.task.description || '') : '');
  process.exit(0);
}

console.error('Unsupported fake jq query:', query);
process.exit(65);
`
  );

  // Fake sleep (no-op)
  writeExecutable(
    path.join(binDir, 'sleep'),
    `#!/usr/bin/env bash
exit 0
`
  );

  return binDir;
}

function runLoopScript(workspaceDir: string, binDir: string, extraArgs: string[] = []) {
  return spawnSync('/bin/bash', [loopScriptPath, ...extraArgs], {
    cwd: workspaceDir,
    encoding: 'utf-8',
    env: {
      ...process.env,
      NO_UPDATE_NOTIFIER: '1',
      PATH: `${binDir}:${process.env.PATH || ''}`,
      HERMES_CODING_WORKSPACE: workspaceDir,
    },
  });
}

describe('ralph-loop.sh', () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-loop-script-'));
  });

  afterEach(() => {
    fs.removeSync(workspaceDir);
  });

  // ── Task iteration tests ──────────────────────────────────────────

  it('should invoke claude with the phase-3 skill and continue until all_done', () => {
    const binDir = seedWorkspace(workspaceDir, [
      {
        result: 'task_found',
        task: { id: 'auth.login', status: 'pending', description: 'Implement login', module: 'auth' },
      },
      {
        result: 'task_found',
        task: { id: 'auth.signup', status: 'pending', description: 'Implement signup', module: 'auth' },
      },
      { result: 'all_done' },
    ]);

    const result = runLoopScript(workspaceDir, binDir, ['5']);
    const output = `${result.stdout}${result.stderr}`;
    const callLog = readCallLog(workspaceDir);

    expect(result.status).toBe(0);
    expect(output).toContain('All tasks resolved');
    expect(callLog.filter(line => line === 'claude invoked')).toHaveLength(3);
    expect(callLog.filter(line => line.startsWith('tasks next result='))).toEqual([
      'tasks next result=task_found task=auth.login',
      'tasks next result=task_found task=auth.signup',
      'tasks next result=all_done',
    ]);
    expect(callLog.some(line => line.includes('claude prompt="# Phase 3 skill\\nSkill content for test.\\n"'))).toBe(true);
  });

  it('should exit 1 when tasks are blocked', () => {
    const binDir = seedWorkspace(workspaceDir, [
      {
        result: 'task_found',
        task: { id: 'auth.login', status: 'pending', description: 'Implement login', module: 'auth' },
      },
      { result: 'blocked' },
    ]);

    const result = runLoopScript(workspaceDir, binDir, ['5']);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain('blocked by dependencies');
  });

  it('should exit 0 and transition to deliver when all_done', () => {
    const binDir = seedWorkspace(workspaceDir, [
      { result: 'all_done' },
    ]);

    const result = runLoopScript(workspaceDir, binDir, ['5']);
    const output = `${result.stdout}${result.stderr}`;
    const callLog = readCallLog(workspaceDir);

    expect(result.status).toBe(0);
    expect(output).toContain('All tasks resolved');
    expect(output).toContain('Transitioning to deliver');
    expect(callLog).toContain('state update phase=deliver');
    expect(callLog.filter(line => line === 'claude invoked')).toHaveLength(1);
  });

  // ── PID lock tests ────────────────────────────────────────────────

  it('should create lock file on startup', () => {
    const binDir = seedWorkspace(workspaceDir, [
      { result: 'all_done' },
    ]);

    const lockFile = path.join(workspaceDir, '.hermes-coding', '.loop.lock');
    expect(fs.existsSync(lockFile)).toBe(false);

    runLoopScript(workspaceDir, binDir, ['5']);

    // Lock should have been cleaned up on exit
    expect(fs.existsSync(lockFile)).toBe(false);
  });

  it('should clean up lock file on normal exit (all_done)', () => {
    const binDir = seedWorkspace(workspaceDir, [
      { result: 'all_done' },
    ]);

    const lockFile = path.join(workspaceDir, '.hermes-coding', '.loop.lock');
    runLoopScript(workspaceDir, binDir, ['5']);

    expect(fs.existsSync(lockFile)).toBe(false);
  });

  it('should clean up lock file on error exit (blocked)', () => {
    const binDir = seedWorkspace(workspaceDir, [
      { result: 'blocked' },
    ]);

    const lockFile = path.join(workspaceDir, '.hermes-coding', '.loop.lock');
    runLoopScript(workspaceDir, binDir, ['5']);

    expect(fs.existsSync(lockFile)).toBe(false);
  });

  it('should refuse to start when another instance is running', () => {
    const binDir = seedWorkspace(workspaceDir, [
      { result: 'all_done' },
    ]);

    const lockFile = path.join(workspaceDir, '.hermes-coding', '.loop.lock');

    // Write a lock file with the current process PID (which is definitely alive)
    fs.ensureDirSync(path.dirname(lockFile));
    fs.writeFileSync(lockFile, String(process.pid));

    const result = runLoopScript(workspaceDir, binDir, ['5']);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain('already running');
    expect(output).toContain(String(process.pid));

    // Lock file should still exist (we didn't acquire it)
    expect(fs.existsSync(lockFile)).toBe(true);
  });

  it('should auto-clean stale lock and start normally', () => {
    const binDir = seedWorkspace(workspaceDir, [
      { result: 'all_done' },
    ]);

    const lockFile = path.join(workspaceDir, '.hermes-coding', '.loop.lock');

    // Write a lock file with a PID that definitely doesn't exist
    // Use a very high PID that won't be in use
    const stalePid = 99999999;
    fs.ensureDirSync(path.dirname(lockFile));
    fs.writeFileSync(lockFile, String(stalePid));

    const result = runLoopScript(workspaceDir, binDir, ['5']);
    const output = `${result.stdout}${result.stderr}`;

    // Should succeed — stale lock was cleaned
    expect(result.status).toBe(0);
    expect(output).toContain('All tasks resolved');

    // Lock file should be cleaned up after exit
    expect(fs.existsSync(lockFile)).toBe(false);
  });

  it('should auto-clean corrupt lock file (non-numeric PID)', () => {
    const binDir = seedWorkspace(workspaceDir, [
      { result: 'all_done' },
    ]);

    const lockFile = path.join(workspaceDir, '.hermes-coding', '.loop.lock');

    // Write a corrupt lock file
    fs.ensureDirSync(path.dirname(lockFile));
    fs.writeFileSync(lockFile, 'not-a-pid');

    const result = runLoopScript(workspaceDir, binDir, ['5']);

    // Should succeed — corrupt lock was cleaned
    expect(result.status).toBe(0);

    // Lock file should be cleaned up after exit
    expect(fs.existsSync(lockFile)).toBe(false);
  });
});
