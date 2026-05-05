import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as childProcess from 'child_process';
import { registerLoopCommand } from '../../src/commands/loop';
import * as configService from '../../src/services/config-service';

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

  function seedImplementState(): void {
    fs.writeJSONSync(stateFile, {
      phase: 'implement',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  function mockSpawnSuccess(): void {
    spawnSyncMock.mockReturnValue({
      pid: 123,
      output: [],
      stdout: null,
      stderr: null,
      status: 0,
      signal: null,
    } as any);
  }

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

  it('reads from config.json and passes tool-command to script', async () => {
    seedImplementState();
    configService.writeConfig(testDir, {
      tool: 'codex',
      toolCommand: 'codex --yolo exec',
    });
    mockSpawnSuccess();

    registerLoopCommand(program, testDir);
    await program.parseAsync(['node', 'test', 'loop']);

    expect(spawnSyncMock).toHaveBeenCalledWith(
      '/bin/bash',
      expect.arrayContaining([
        expect.stringContaining('ralph-loop.sh'),
        '--tool', 'codex',
        '--tool-command', 'codex --yolo exec',
      ]),
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

  it('--tool claude overrides config.json', async () => {
    seedImplementState();
    configService.writeConfig(testDir, {
      tool: 'codex',
      toolCommand: 'codex --yolo exec',
    });
    mockSpawnSuccess();

    registerLoopCommand(program, testDir);
    await program.parseAsync(['node', 'test', 'loop', '--tool', 'claude']);

    expect(spawnSyncMock).toHaveBeenCalledWith(
      '/bin/bash',
      expect.arrayContaining([
        '--tool', 'claude',
        '--tool-command', 'claude --dangerously-skip-permissions --print --verbose',
      ]),
      expect.any(Object)
    );
  });

  it('--custom overrides everything', async () => {
    seedImplementState();
    configService.writeConfig(testDir, {
      tool: 'claude',
      toolCommand: 'claude --dangerously-skip-permissions --print --verbose',
    });
    mockSpawnSuccess();

    registerLoopCommand(program, testDir);
    await program.parseAsync(['node', 'test', 'loop', '--custom', 'my-custom-tool --flag']);

    expect(spawnSyncMock).toHaveBeenCalledWith(
      '/bin/bash',
      expect.arrayContaining([
        '--tool', 'custom',
        '--tool-command', 'my-custom-tool --flag',
        '--custom', 'my-custom-tool --flag',
      ]),
      expect.any(Object)
    );
  });

  it('reports error when no config.json and no --tool/--custom', async () => {
    seedImplementState();
    // No config.json written
    mockSpawnSuccess();

    registerLoopCommand(program, testDir);
    await program.parseAsync(['node', 'test', 'loop']);

    expect(spawnSyncMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('No tool configuration'));
    expect(processExitSpy).toHaveBeenCalledWith(2);
  });

  it('reports error for unknown --tool', async () => {
    seedImplementState();
    mockSpawnSuccess();

    registerLoopCommand(program, testDir);
    await program.parseAsync(['node', 'test', 'loop', '--tool', 'chatgpt']);

    expect(spawnSyncMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown tool 'chatgpt'"));
    expect(processExitSpy).toHaveBeenCalledWith(2);
  });

  it('returns the child exit code when the loop script stops with an error', async () => {
    seedImplementState();
    configService.writeConfig(testDir, {
      tool: 'claude',
      toolCommand: 'claude --dangerously-skip-permissions --print --verbose',
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
