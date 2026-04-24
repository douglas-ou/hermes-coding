import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { registerInitCommand } from '../../src/commands/init';
import * as serviceFactory from '../../src/commands/service-factory';

vi.mock('../../src/commands/service-factory');

describe('init command', () => {
  let program: Command;
  let tempDir: string;
  let consoleLogSpy: any;
  let processExitSpy: any;
  let cwdSpy: any;
  let mockHookService: any;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-test-'));
    program = new Command();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

    mockHookService = {
      createPreCommitHook: vi.fn(),
    };
    vi.mocked(serviceFactory.createHookService).mockReturnValue(mockHookService as any);
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    processExitSpy.mockRestore();
    cwdSpy.mockRestore();
    await fs.remove(tempDir);
  });

  describe('command registration', () => {
    it('should register init command', () => {
      registerInitCommand(program);
      const cmd = program.commands.find((c) => c.name() === 'init');
      expect(cmd).toBeDefined();
    });

    it('should have --json option', () => {
      registerInitCommand(program);
      const cmd = program.commands.find((c) => c.name() === 'init');
      expect(cmd?.options.find((o) => o.flags === '--json')).toBeDefined();
    });

    it('should have --no-hook option', () => {
      registerInitCommand(program);
      const cmd = program.commands.find((c) => c.name() === 'init');
      expect(cmd?.options.find((o) => o.flags === '--no-hook')).toBeDefined();
    });
  });

  describe('hook creation', () => {
    it('should create hook by default', async () => {
      mockHookService.createPreCommitHook.mockResolvedValue({
        created: true,
        reason: 'created',
        hookPath: path.join(tempDir, '.git', 'hooks', 'pre-commit'),
        testCommand: 'CI=true npm test',
      });

      registerInitCommand(program);
      await program.parseAsync(['node', 'test', 'init']);

      expect(serviceFactory.createHookService).toHaveBeenCalledWith(tempDir);
      expect(mockHookService.createPreCommitHook).toHaveBeenCalledWith(tempDir);
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should skip hook creation with --no-hook', async () => {
      registerInitCommand(program);
      await program.parseAsync(['node', 'test', 'init', '--no-hook']);

      expect(serviceFactory.createHookService).not.toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should include hook result in JSON output', async () => {
      mockHookService.createPreCommitHook.mockResolvedValue({
        created: true,
        reason: 'created',
        hookPath: '/path/.git/hooks/pre-commit',
        testCommand: 'CI=true npm test',
      });

      registerInitCommand(program);
      await program.parseAsync(['node', 'test', 'init', '--json']);

      const jsonOutput = consoleLogSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
      const parsed = JSON.parse(jsonOutput);

      expect(parsed.success).toBe(true);
      expect(parsed.data.hook).toBeDefined();
      expect(parsed.data.hook.created).toBe(true);
      expect(parsed.data.hook.testCommand).toBe('CI=true npm test');
    });

    it('should show hook created message in human-readable output', async () => {
      mockHookService.createPreCommitHook.mockResolvedValue({
        created: true,
        reason: 'created',
        hookPath: '/path/.git/hooks/pre-commit',
        testCommand: 'CI=true npm test',
      });

      registerInitCommand(program);
      await program.parseAsync(['node', 'test', 'init']);

      const output = consoleLogSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
      expect(output).toContain('pre-commit created');
      expect(output).toContain('CI=true npm test');
    });

    it('should show skipped message when hook not created', async () => {
      mockHookService.createPreCommitHook.mockResolvedValue({
        created: false,
        reason: 'no test command detected',
        hookPath: '/path/.git/hooks/pre-commit',
        testCommand: null,
      });

      registerInitCommand(program);
      await program.parseAsync(['node', 'test', 'init']);

      const output = consoleLogSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
      expect(output).toContain('skipped');
      expect(output).toContain('no test command detected');
    });

    it('should show skipped message for idempotent rerun', async () => {
      mockHookService.createPreCommitHook.mockResolvedValue({
        created: false,
        reason: 'already exists',
        hookPath: '/path/.git/hooks/pre-commit',
        testCommand: 'CI=true npm test',
      });

      registerInitCommand(program);
      await program.parseAsync(['node', 'test', 'init']);

      const output = consoleLogSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
      expect(output).toContain('skipped');
      expect(output).toContain('already exists');
    });

    it('should not fail init when hook creation throws', async () => {
      mockHookService.createPreCommitHook.mockRejectedValue(new Error('disk full'));

      registerInitCommand(program);
      await program.parseAsync(['node', 'test', 'init']);

      // Init should still succeed
      expect(processExitSpy).toHaveBeenCalledWith(0);

      // JSON output should show the error as reason
      const output = consoleLogSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
      expect(output).toContain('Error: disk full');
    });

    it('should include hook error in JSON output when creation fails', async () => {
      mockHookService.createPreCommitHook.mockRejectedValue(new Error('permission denied'));

      registerInitCommand(program);
      await program.parseAsync(['node', 'test', 'init', '--json']);

      const jsonOutput = consoleLogSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
      const parsed = JSON.parse(jsonOutput);

      expect(parsed.success).toBe(true);
      expect(parsed.data.hook).toBeDefined();
      expect(parsed.data.hook.created).toBe(false);
      expect(parsed.data.hook.reason).toContain('permission denied');
    });
  });
});
