import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as childProcess from 'child_process';
import { registerLoopCommand } from '../../src/commands/loop';

vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));

describe('loop command', () => {
  let program: Command;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;
  const testDir = path.join(__dirname, '__test-loop__');
  const stateFile = path.join(testDir, '.hermes-coding', 'state.json');
  const spawnSyncMock = vi.mocked(childProcess.spawnSync);

  beforeEach(() => {
    program = new Command();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    fs.removeSync(testDir);
    fs.ensureDirSync(path.dirname(stateFile));
    spawnSyncMock.mockReset();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
    vi.clearAllMocks();
    fs.removeSync(testDir);
  });

  it('registers the loop command', () => {
    registerLoopCommand(program, testDir);

    const loopCommand = program.commands.find((cmd) => cmd.name() === 'loop');
    expect(loopCommand).toBeDefined();
    expect(loopCommand?.description()).toBe('Run the Phase 3 implement loop from the current terminal');
  });

  it('fails when no state exists', async () => {
    registerLoopCommand(program, testDir);

    await program.parseAsync(['node', 'test', 'loop']);

    expect(spawnSyncMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('No active hermes-coding session'));
    expect(processExitSpy).toHaveBeenCalledWith(3);
  });

  it('fails when phase is not implement', async () => {
    fs.writeJSONSync(stateFile, {
      phase: 'breakdown',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    registerLoopCommand(program, testDir);
    await program.parseAsync(['node', 'test', 'loop']);

    expect(spawnSyncMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('only supports the implement phase'));
    expect(processExitSpy).toHaveBeenCalledWith(7);
  });

  it('launches the bundled loop script during implement', async () => {
    fs.writeJSONSync(stateFile, {
      phase: 'implement',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    spawnSyncMock.mockReturnValue({
      pid: 123,
      output: [],
      stdout: null,
      stderr: null,
      status: 0,
      signal: null,
    } as any);

    registerLoopCommand(program, testDir);
    await program.parseAsync(['node', 'test', 'loop']);

    expect(spawnSyncMock).toHaveBeenCalledWith(
      '/bin/bash',
      [expect.stringContaining(path.join('cli', 'scripts', 'ralph-loop.sh')), '--tool', 'claude'],
      expect.objectContaining({
        cwd: testDir,
        stdio: 'inherit',
        env: expect.objectContaining({
          HERMES_CODING_WORKSPACE: testDir,
          NO_UPDATE_NOTIFIER: '1',
        }),
      })
    );
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it('passes --visible and max-iterations to the loop script', async () => {
    fs.writeJSONSync(stateFile, {
      phase: 'implement',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    spawnSyncMock.mockReturnValue({
      pid: 123,
      output: [],
      stdout: null,
      stderr: null,
      status: 0,
      signal: null,
    } as any);

    registerLoopCommand(program, testDir);
    await program.parseAsync(['node', 'test', 'loop', '--visible', '--tool', 'amp', '10']);

    expect(spawnSyncMock).toHaveBeenCalledWith(
      '/bin/bash',
      [expect.stringContaining('ralph-loop.sh'), '--tool', 'amp', '--visible', '10'],
      expect.any(Object)
    );
  });

  it('returns the child exit code when the loop script stops with an error', async () => {
    fs.writeJSONSync(stateFile, {
      phase: 'implement',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    spawnSyncMock.mockReturnValue({
      pid: 123,
      output: [],
      stdout: null,
      stderr: null,
      status: 1,
      signal: null,
    } as any);

    registerLoopCommand(program, testDir);
    await program.parseAsync(['node', 'test', 'loop']);

    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});
