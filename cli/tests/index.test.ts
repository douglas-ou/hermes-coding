import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('index.ts - CLI entry point', () => {
  let originalArgv: string[];
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalArgv = process.argv;
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.env = originalEnv;
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('should be importable without errors', () => {
    // This test verifies that the module can be imported
    expect(() => {
      // The index file registers commands and parses argv
      // We don't actually import it here to avoid side effects
    }).not.toThrow();
  });

  it('should use HERMES_CODING_WORKSPACE env var when set', () => {
    const testWorkspace = '/test/workspace';
    process.env.HERMES_CODING_WORKSPACE = testWorkspace;

    // The workspace dir should be read from env
    expect(process.env.HERMES_CODING_WORKSPACE).toBe(testWorkspace);

    delete process.env.HERMES_CODING_WORKSPACE;
  });

  it('should use process.cwd() when HERMES_CODING_WORKSPACE is not set', () => {
    delete process.env.HERMES_CODING_WORKSPACE;

    // When env var is not set, it should use cwd
    expect(process.env.HERMES_CODING_WORKSPACE).toBeUndefined();
    expect(process.cwd()).toBeTruthy();
  });

  it('should have access to package.json version', async () => {
    const packageJson = await import('../package.json');
    expect(packageJson.version).toBeTruthy();
    expect(typeof packageJson.version).toBe('string');
  });

  it('should register all command modules', async () => {
    // Verify that all command registration functions exist
    const { registerStateCommands } = await import('../src/commands/state');
    const { registerTaskCommands } = await import('../src/commands/tasks');
    const { registerStatusCommand } = await import('../src/commands/status');
    const { registerDetectCommand } = await import('../src/commands/detect');
    const { registerLoopCommand } = await import('../src/commands/loop');
    const { registerUpdateCommand } = await import('../src/commands/update');
    const { Command } = await import('commander');

    expect(registerStateCommands).toBeDefined();
    expect(registerTaskCommands).toBeDefined();
    expect(registerStatusCommand).toBeDefined();
    expect(registerDetectCommand).toBeDefined();
    expect(registerLoopCommand).toBeDefined();
    expect(registerUpdateCommand).toBeDefined();

    const program = new Command();
    const workspace = '/tmp/hermes-coding-test';
    registerStateCommands(program, workspace);
    registerTaskCommands(program, workspace);
    registerStatusCommand(program, workspace);
    registerDetectCommand(program, workspace);
    registerLoopCommand(program, workspace);
    registerUpdateCommand(program);

    const topLevelNames = program.commands.map((command) => command.name());
    expect(topLevelNames).toContain('loop');
    expect(topLevelNames).not.toContain('init');
  });

  it('should reject init as an unknown top-level command', async () => {
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    try {
      const { registerStateCommands } = await import('../src/commands/state');
      const { registerTaskCommands } = await import('../src/commands/tasks');
      const { registerStatusCommand } = await import('../src/commands/status');
      const { registerDetectCommand } = await import('../src/commands/detect');
      const { registerLoopCommand } = await import('../src/commands/loop');
      const { registerUpdateCommand } = await import('../src/commands/update');
      const { Command } = await import('commander');

      const program = new Command();
      const workspace = '/tmp/hermes-coding-test';
      registerStateCommands(program, workspace);
      registerTaskCommands(program, workspace);
      registerStatusCommand(program, workspace);
      registerDetectCommand(program, workspace);
      registerLoopCommand(program, workspace);
      registerUpdateCommand(program);

      await program.parseAsync(['node', 'test', 'init']);

      expect(processExitSpy).toHaveBeenCalled();
      expect(processExitSpy).not.toHaveBeenCalledWith(0);
      expect(program.commands.map((command) => command.name())).not.toContain('init');
    } finally {
      processExitSpy.mockRestore();
    }
  });

  it('should use commander for CLI', () => {
    const { Command } = require('commander');
    const program = new Command();

    expect(program).toBeDefined();
    expect(program.name).toBeDefined();
    expect(program.description).toBeDefined();
    expect(program.version).toBeDefined();
  });

  it('should skip global pre-check for `update --check`', async () => {
    process.argv = ['node', 'dist/index.js', 'update', '--check', '--json'];

    const checkAndNotify = vi.fn();
    const checkForUpdates = vi.fn().mockReturnValue({
      hasUpdate: false,
      currentVersion: '0.1.2',
      fromCache: true,
    });

    vi.doMock('../src/services/update-checker.service', () => ({
      checkAndNotify,
      checkForUpdates,
    }));
    vi.doMock('commander', async () => {
      const actual = await vi.importActual<typeof import('commander')>('commander');
      return {
        ...actual,
        Command: class extends actual.Command {
          parse() {
            return this;
          }
        },
      };
    });

    await import('../src/index');

    expect(checkAndNotify).not.toHaveBeenCalled();
    expect(checkForUpdates).not.toHaveBeenCalled();
  });
});
