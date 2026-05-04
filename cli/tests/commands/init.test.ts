import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { registerInitCommand } from '../../src/commands/init';
import * as serviceFactory from '../../src/commands/service-factory';
import * as configService from '../../src/services/config-service';

vi.mock('../../src/commands/service-factory');
vi.mock('@clack/prompts', () => ({
  select: vi.fn(),
  isCancel: vi.fn().mockReturnValue(false),
}));

describe('init command', () => {
  let program: Command;
  let tempDir: string;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;
  let cwdSpy: any;
  let mockHookService: any;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-test-'));
    program = new Command();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

    mockHookService = {
      createPreCommitHook: vi.fn(),
    };
    vi.mocked(serviceFactory.createHookService).mockReturnValue(mockHookService as any);
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
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

    it('should have --tool option', () => {
      registerInitCommand(program);
      const cmd = program.commands.find((c) => c.name() === 'init');
      expect(cmd?.options.find((o) => o.flags.includes('--tool'))).toBeDefined();
    });

    it('should have --no-hook option', () => {
      registerInitCommand(program);
      const cmd = program.commands.find((c) => c.name() === 'init');
      expect(cmd?.options.find((o) => o.flags === '--no-hook')).toBeDefined();
    });
  });

  describe('--tool flag (non-interactive)', () => {
    it('should write config.json with claude tool', async () => {
      mockHookService.createPreCommitHook.mockResolvedValue({
        created: false,
        reason: 'no git',
      });

      registerInitCommand(program);
      await program.parseAsync(['node', 'test', 'init', '--tool', 'claude']);

      const config = configService.readConfig(tempDir);
      expect(config).toEqual({
        tool: 'claude',
        toolCommand: 'claude --dangerously-skip-permissions --print --verbose',
      });
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should write config.json with codex tool', async () => {
      mockHookService.createPreCommitHook.mockResolvedValue({
        created: false,
        reason: 'no git',
      });

      registerInitCommand(program);
      await program.parseAsync(['node', 'test', 'init', '--tool', 'codex']);

      const config = configService.readConfig(tempDir);
      expect(config).toEqual({
        tool: 'codex',
        toolCommand: 'codex --yolo exec',
      });
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should write config.json with amp tool', async () => {
      mockHookService.createPreCommitHook.mockResolvedValue({
        created: false,
        reason: 'no git',
      });

      registerInitCommand(program);
      await program.parseAsync(['node', 'test', 'init', '--tool', 'amp']);

      const config = configService.readConfig(tempDir);
      expect(config?.tool).toBe('amp');
      expect(config?.toolCommand).toBe('amp --dangerously-allow-all');
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should exit with error for unknown tool', async () => {
      registerInitCommand(program);
      await program.parseAsync(['node', 'test', 'init', '--tool', 'unknown']);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown tool 'unknown'"));
      expect(processExitSpy).toHaveBeenCalledWith(2);
    });
  });

  describe('interactive selection', () => {
    it('should use clack select when no --tool is provided', async () => {
      const clack = await import('@clack/prompts');
      const mockSelect = vi.mocked(clack.select).mockResolvedValue('codex');
      mockHookService.createPreCommitHook.mockResolvedValue({
        created: false,
        reason: 'no git',
      });

      registerInitCommand(program);
      await program.parseAsync(['node', 'test', 'init']);

      expect(mockSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Select'),
        })
      );

      const config = configService.readConfig(tempDir);
      expect(config?.tool).toBe('codex');
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should handle cancel from clack select', async () => {
      const clack = await import('@clack/prompts');
      vi.mocked(clack.select).mockResolvedValue(Symbol('clack:cancel'));
      vi.mocked(clack.isCancel).mockReturnValue(true);

      registerInitCommand(program);
      await program.parseAsync(['node', 'test', 'init']);

      expect(processExitSpy).toHaveBeenCalledWith(0);
      // Config should NOT be written
      expect(configService.readConfig(tempDir)).toBeNull();
    });
  });

  describe('dual directory sync', () => {
    it('should sync skills to both .claude/skills/ and .agents/skills/', async () => {
      mockHookService.createPreCommitHook.mockResolvedValue({
        created: false,
        reason: 'no git',
      });

      registerInitCommand(program);
      await program.parseAsync(['node', 'test', 'init', '--tool', 'claude']);

      expect(fs.existsSync(path.join(tempDir, '.claude', 'skills'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.agents', 'skills'))).toBe(true);

      const output = consoleLogSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
      expect(output).toContain('.claude/skills/');
      expect(output).toContain('.agents/skills/');
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
      await program.parseAsync(['node', 'test', 'init', '--tool', 'claude']);

      expect(serviceFactory.createHookService).toHaveBeenCalledWith(tempDir);
      expect(mockHookService.createPreCommitHook).toHaveBeenCalledWith(tempDir);
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should skip hook creation with --no-hook', async () => {
      registerInitCommand(program);
      await program.parseAsync(['node', 'test', 'init', '--tool', 'claude', '--no-hook']);

      expect(serviceFactory.createHookService).not.toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should show hook created message', async () => {
      mockHookService.createPreCommitHook.mockResolvedValue({
        created: true,
        reason: 'created',
        hookPath: '/path/.git/hooks/pre-commit',
        testCommand: 'CI=true npm test',
      });

      registerInitCommand(program);
      await program.parseAsync(['node', 'test', 'init', '--tool', 'claude']);

      const output = consoleLogSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
      expect(output).toContain('Pre-commit hook installed');
    });

    it('should show skipped message when hook not created', async () => {
      mockHookService.createPreCommitHook.mockResolvedValue({
        created: false,
        reason: 'no test command detected',
      });

      registerInitCommand(program);
      await program.parseAsync(['node', 'test', 'init', '--tool', 'claude']);

      const output = consoleLogSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
      expect(output).toContain('skipped');
    });

    it('should not fail init when hook creation throws', async () => {
      mockHookService.createPreCommitHook.mockRejectedValue(new Error('disk full'));

      registerInitCommand(program);
      await program.parseAsync(['node', 'test', 'init', '--tool', 'claude']);

      expect(processExitSpy).toHaveBeenCalledWith(0);
      const output = consoleLogSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
      expect(output).toContain('skipped');
    });
  });

  describe('re-entry (idempotent init)', () => {
    it('should overwrite config.json but not delete existing files', async () => {
      // First init with claude
      mockHookService.createPreCommitHook.mockResolvedValue({ created: false, reason: 'no git' });
      registerInitCommand(program);
      await program.parseAsync(['node', 'test', 'init', '--tool', 'claude']);

      // Simulate state.json and tasks/ existing
      const stateFile = path.join(tempDir, '.hermes-coding', 'state.json');
      fs.writeJSONSync(stateFile, { phase: 'implement' });
      const tasksDir = path.join(tempDir, '.hermes-coding', 'tasks');
      fs.ensureDirSync(tasksDir);
      fs.writeFileSync(path.join(tasksDir, 'task1.md'), '# Task 1');

      // Re-init with codex
      program = new Command();
      registerInitCommand(program);
      await program.parseAsync(['node', 'test', 'init', '--tool', 'codex']);

      // Config should be updated
      const config = configService.readConfig(tempDir);
      expect(config?.tool).toBe('codex');

      // State and tasks should still exist
      expect(fs.existsSync(stateFile)).toBe(true);
      expect(fs.existsSync(path.join(tasksDir, 'task1.md'))).toBe(true);
    });
  });
});
