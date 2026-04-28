import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerUpdateCommand } from '../../src/commands/update';

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../../src/services/update-checker.service', () => ({
  checkForUpdates: vi.fn(),
  writeInstalledVersion: vi.fn(),
}));

vi.mock('../../src/services/skill-sync.service', () => ({
  syncSkills: vi.fn(),
}));

// Mock readline for askConfirmation
vi.mock('readline', () => ({
  createInterface: vi.fn().mockReturnValue({
    question: vi.fn((_query: string, callback: (answer: string) => void) => {
      callback('y');
    }),
    close: vi.fn(),
  }),
}));

describe('Update Command', () => {
  let program: Command;
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    process.env = { ...originalEnv };

    program = new Command();
    program.exitOverride();
    registerUpdateCommand(program);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  describe('registerUpdateCommand', () => {
    it('should register update command', () => {
      const updateCmd = program.commands.find((cmd) => cmd.name() === 'update');
      expect(updateCmd).toBeDefined();
    });

    it('should have correct description', () => {
      const updateCmd = program.commands.find((cmd) => cmd.name() === 'update');
      expect(updateCmd?.description()).toContain('update');
    });

    it('should have --check option', () => {
      const updateCmd = program.commands.find((cmd) => cmd.name() === 'update');
      const options = updateCmd?.options || [];
      const checkOption = options.find((opt) => opt.long === '--check');
      expect(checkOption).toBeDefined();
    });

    it('should have --json option', () => {
      const updateCmd = program.commands.find((cmd) => cmd.name() === 'update');
      const options = updateCmd?.options || [];
      const jsonOption = options.find((opt) => opt.long === '--json');
      expect(jsonOption).toBeDefined();
    });

    it('should not have --cli-only or --plugin-only options', () => {
      const updateCmd = program.commands.find((cmd) => cmd.name() === 'update');
      const options = updateCmd?.options || [];
      expect(options.find((opt) => opt.long === '--cli-only')).toBeUndefined();
      expect(options.find((opt) => opt.long === '--plugin-only')).toBeUndefined();
    });
  });
});

describe('Update Command Integration', () => {
  let program: Command;
  const originalEnv = process.env;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let consoleLogSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let processExitSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    process.env = { ...originalEnv };

    program = new Command();
    program.exitOverride();
    registerUpdateCommand(program);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  it('should handle --check option without throwing', async () => {
    const { execSync } = await import('child_process');
    const execSyncMock = vi.mocked(execSync);
    execSyncMock.mockReturnValue('0.4.1\n');

    expect(() => {
      try {
        program.parse(['node', 'test', 'update', '--check', '--json']);
      } catch {
        // Expected to fail in test environment
      }
    }).not.toThrow();
  });

  it('should display help without errors', () => {
    expect(() => {
      try {
        program.parse(['node', 'test', 'update', '--help']);
      } catch {
        // Help throws in commander
      }
    }).not.toThrow();
  });

  describe('--check mode', () => {
    it('should use shared update checker service for --check', async () => {
      const { checkForUpdates } = await import('../../src/services/update-checker.service');

      vi.mocked(checkForUpdates).mockReturnValue({
        hasUpdate: true,
        currentVersion: '0.1.2',
        latestVersion: '99.0.0',
        fromCache: false,
      });

      await program.parseAsync(['node', 'test', 'update', '--check', '--json']);

      expect(checkForUpdates).toHaveBeenCalledWith({
        packageName: 'hermes-coding',
        currentVersion: '0.1.2',
        suppressNotificationOnly: true,
      });
      const allLogs = consoleLogSpy.mock.calls.flat().join('\n');
      expect(allLogs).toContain('latestVersion');
      expect(allLogs).toContain('99.0.0');
    });

    it('should show update available when new version exists', async () => {
      const { checkForUpdates } = await import('../../src/services/update-checker.service');
      vi.mocked(checkForUpdates).mockReturnValue({
        hasUpdate: true,
        currentVersion: '0.1.2',
        latestVersion: '99.0.0',
        fromCache: false,
      });

      await program.parseAsync(['node', 'test', 'update', '--check']);

      const allLogs = consoleLogSpy.mock.calls.flat().join('\n');
      expect(allLogs).toContain('Update available');
    });

    it('should show up to date when on latest version', async () => {
      const { version } = await import('../../package.json');
      const { checkForUpdates } = await import('../../src/services/update-checker.service');
      vi.mocked(checkForUpdates).mockReturnValue({
        hasUpdate: false,
        currentVersion: version,
        latestVersion: version,
        fromCache: false,
      });

      await program.parseAsync(['node', 'test', 'update', '--check']);

      const allLogs = consoleLogSpy.mock.calls.flat().join('\n');
      expect(allLogs).toContain('latest version');
    });

    it('should handle npm view failure', async () => {
      const { checkForUpdates } = await import('../../src/services/update-checker.service');
      vi.mocked(checkForUpdates).mockReturnValue({
        hasUpdate: false,
        currentVersion: '0.1.2',
        fromCache: false,
      });

      await program.parseAsync(['node', 'test', 'update', '--check']);

      const allLogs = consoleLogSpy.mock.calls.flat().join('\n');
      expect(allLogs).toContain('Failed to check');
    });

    it('should output JSON when --json flag is used with --check', async () => {
      const { checkForUpdates } = await import('../../src/services/update-checker.service');
      vi.mocked(checkForUpdates).mockReturnValue({
        hasUpdate: true,
        currentVersion: '0.1.2',
        latestVersion: '99.0.0',
        fromCache: false,
      });

      await program.parseAsync(['node', 'test', 'update', '--check', '--json']);

      const allLogs = consoleLogSpy.mock.calls.flat().join('\n');
      expect(allLogs).toContain('latestVersion');
      expect(allLogs).toContain('updateAvailable');
    });
  });

  describe('CLI update', () => {
    it('should update CLI successfully', async () => {
      const { execSync } = await import('child_process');
      const { syncSkills } = await import('../../src/services/skill-sync.service');
      process.env.CI = 'true';
      vi.mocked(execSync).mockReturnValue('99.0.0\n');
      vi.mocked(syncSkills).mockReturnValue({
        target: '/tmp/ws/.claude/skills',
        skills: { 'hermes-coding': ['SKILL.md'] },
        totalFiles: 1,
      });

      await program.parseAsync(['node', 'test', 'update']);

      expect(vi.mocked(execSync)).toHaveBeenCalledWith(
        expect.stringContaining('npm install -g hermes-coding@latest'),
        expect.any(Object)
      );
      expect(syncSkills).toHaveBeenCalled();
    });

    it('should try npx when npm fails', async () => {
      const { execSync } = await import('child_process');
      process.env.CI = 'true';

      let callCount = 0;
      vi.mocked(execSync).mockImplementation((cmd: any) => {
        const cmdStr = String(cmd);
        callCount++;
        if (cmdStr.includes('npm view')) return '99.0.0\n';
        if (callCount === 2) throw new Error('npm failed');
        return '99.0.0\n';
      });

      await program.parseAsync(['node', 'test', 'update']);

      expect(vi.mocked(execSync)).toHaveBeenCalledWith(
        expect.stringContaining('npx npm install -g'),
        expect.any(Object)
      );
    });

    it('should handle update failure', async () => {
      const { execSync } = await import('child_process');
      process.env.CI = 'true';

      vi.mocked(execSync).mockImplementation((cmd: any) => {
        const cmdStr = String(cmd);
        if (cmdStr.includes('npm view')) return '99.0.0\n';
        throw new Error('update failed');
      });

      await program.parseAsync(['node', 'test', 'update']);

      const allLogs = consoleLogSpy.mock.calls.flat().join('\n');
      expect(allLogs).toContain('update failed');
    });
  });

  describe('JSON output', () => {
    it('should output JSON when --json flag is used', async () => {
      const { execSync } = await import('child_process');
      vi.mocked(execSync).mockReturnValue('0.5.0\n');

      await program.parseAsync(['node', 'test', 'update', '--json']);

      const allLogs = consoleLogSpy.mock.calls.flat().join('');
      expect(allLogs).toContain('"cli"');
    });

    it('should return success JSON for --auto when update and skills sync succeed', async () => {
      const { execSync } = await import('child_process');
      const { syncSkills } = await import('../../src/services/skill-sync.service');
      const { writeInstalledVersion } = await import('../../src/services/update-checker.service');

      vi.mocked(execSync).mockImplementation((cmd: any) => {
        const cmdStr = String(cmd);
        if (cmdStr.includes('npm install -g hermes-coding@latest')) {
          return '';
        }
        if (cmdStr.includes('npm list -g')) {
          return JSON.stringify({
            dependencies: {
              'hermes-coding': { version: '99.0.0' },
            },
          });
        }
        return '';
      });
      vi.mocked(syncSkills).mockReturnValue({
        target: '/tmp/ws/.claude/skills',
        skills: { 'hermes-coding': ['SKILL.md'] },
        totalFiles: 1,
      });

      await program.parseAsync(['node', 'test', 'update', '--auto', '--json']);

      const allLogs = consoleLogSpy.mock.calls.flat().join('');
      expect(allLogs).toContain('"success": true');
      expect(allLogs).toContain('"synced": true');
      expect(vi.mocked(execSync)).toHaveBeenCalledWith(
        expect.stringContaining('npm install -g hermes-coding@latest'),
        expect.any(Object)
      );
      expect(writeInstalledVersion).toHaveBeenCalledWith('99.0.0');
      expect(processExitSpy).toHaveBeenLastCalledWith(0);
    });

    it('should skip install only when target version is already installed', async () => {
      const { execSync } = await import('child_process');
      const { syncSkills } = await import('../../src/services/skill-sync.service');
      const { writeInstalledVersion } = await import('../../src/services/update-checker.service');

      vi.mocked(execSync).mockImplementation((cmd: any) => {
        const cmdStr = String(cmd);
        if (cmdStr.includes('npm list -g')) {
          return JSON.stringify({
            dependencies: {
              'hermes-coding': { version: '0.1.2' },
            },
          });
        }
        return '';
      });
      vi.mocked(syncSkills).mockReturnValue({
        target: '/tmp/ws/.claude/skills',
        skills: { 'hermes-coding': ['SKILL.md'] },
        totalFiles: 1,
      });

      await program.parseAsync([
        'node',
        'test',
        'update',
        '--auto',
        '--target-version',
        '0.1.2',
        '--json',
      ]);

      const installCalls = vi.mocked(execSync).mock.calls.filter(
        call => String(call[0]).includes('npm install -g hermes-coding@latest')
      );
      expect(installCalls).toHaveLength(0);
      expect(syncSkills).toHaveBeenCalled();
      expect(writeInstalledVersion).toHaveBeenCalledWith('0.1.2');
      const allLogs = consoleLogSpy.mock.calls.flat().join('');
      expect(allLogs).toContain('"synced": true');
    });

    it('should not skip install just because running CLI version matches installed version', async () => {
      const { execSync } = await import('child_process');
      const { syncSkills } = await import('../../src/services/skill-sync.service');

      vi.mocked(execSync).mockImplementation((cmd: any) => {
        const cmdStr = String(cmd);
        if (cmdStr.includes('npm install -g hermes-coding@latest')) {
          return '';
        }
        if (cmdStr.includes('npm list -g')) {
          return JSON.stringify({
            dependencies: {
              'hermes-coding': { version: '0.1.2' },
            },
          });
        }
        return '';
      });
      vi.mocked(syncSkills).mockReturnValue({
        target: '/tmp/ws/.claude/skills',
        skills: { 'hermes-coding': ['SKILL.md'] },
        totalFiles: 1,
      });

      await program.parseAsync([
        'node',
        'test',
        'update',
        '--auto',
        '--target-version',
        '99.0.0',
        '--json',
      ]);

      expect(vi.mocked(execSync)).toHaveBeenCalledWith(
        expect.stringContaining('npm install -g hermes-coding@latest'),
        expect.any(Object)
      );
    });

    it('should return error JSON for --auto when CLI update fails', async () => {
      const { execSync } = await import('child_process');

      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('install failed');
      });

      await program.parseAsync(['node', 'test', 'update', '--auto', '--json']);

      const allLogs = consoleLogSpy.mock.calls.flat().join('');
      expect(allLogs).toContain('"success": false');
      expect(allLogs).toContain('AUTO_UPDATE_FAILED');
      expect(processExitSpy).toHaveBeenLastCalledWith(1);
    });

    it('should return error JSON for --auto when skills sync fails', async () => {
      const { execSync } = await import('child_process');
      const { syncSkills } = await import('../../src/services/skill-sync.service');
      const { writeInstalledVersion } = await import('../../src/services/update-checker.service');

      vi.mocked(execSync).mockImplementation((cmd: any) => {
        const cmdStr = String(cmd);
        if (cmdStr.includes('npm list -g')) {
          return JSON.stringify({
            dependencies: {
              'hermes-coding': { version: '99.0.0' },
            },
          });
        }
        return '';
      });
      vi.mocked(syncSkills).mockImplementation(() => {
        throw new Error('sync failed');
      });

      await program.parseAsync(['node', 'test', 'update', '--auto', '--json']);

      const allLogs = consoleLogSpy.mock.calls.flat().join('');
      expect(allLogs).toContain('"success": false');
      expect(allLogs).toContain('SKILL_SYNC_FAILED');
      expect(writeInstalledVersion).not.toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenLastCalledWith(1);
    });
  });

  describe('Error handling in action', () => {
    it('should handle unexpected errors in action handler', async () => {
      const { execSync } = await import('child_process');

      vi.mocked(execSync).mockImplementation(() => {
        throw { code: 'UNEXPECTED', toString: () => 'Unexpected system error' };
      });

      await program.parseAsync(['node', 'test', 'update', '--check', '--json']);

      expect(processExitSpy).toHaveBeenCalled();
    });

    it('should handle errors in non-JSON mode during --check', async () => {
      const { checkForUpdates } = await import('../../src/services/update-checker.service');
      vi.mocked(checkForUpdates).mockReturnValue({
        hasUpdate: false,
        currentVersion: '0.1.2',
        fromCache: false,
      });

      await program.parseAsync(['node', 'test', 'update', '--check']);

      const allLogs = consoleLogSpy.mock.calls.flat().join('\n');
      expect(allLogs).toContain('Failed to check');
    });
  });

  describe('CLI already at latest version', () => {
    it('should skip update when already at latest version', async () => {
      const { execSync } = await import('child_process');
      const { version } = await import('../../package.json');

      vi.mocked(execSync).mockReturnValue(`${version}\n`);

      await program.parseAsync(['node', 'test', 'update']);

      const allLogs = consoleLogSpy.mock.calls.flat().join('\n');
      expect(allLogs).toContain('already at the latest version');

      const installCalls = vi.mocked(execSync).mock.calls.filter(
        call => String(call[0]).includes('npm install -g')
      );
      expect(installCalls).toHaveLength(0);
    });
  });

  describe('Non-JSON output messages', () => {
    it('should display restart message in non-JSON mode', async () => {
      const { execSync } = await import('child_process');
      const { syncSkills } = await import('../../src/services/skill-sync.service');
      process.env.CI = 'true';

      vi.mocked(execSync).mockReturnValue('0.5.0\n');
      vi.mocked(syncSkills).mockReturnValue({
        target: '/tmp/ws/.claude/skills',
        skills: { 'hermes-coding': ['SKILL.md'] },
        totalFiles: 1,
      });

      await program.parseAsync(['node', 'test', 'update']);

      const allLogs = consoleLogSpy.mock.calls.flat().join('\n');
      expect(allLogs).toContain('restart the CLI');
    });

    it('should show skills sync failure in manual update mode but still succeed', async () => {
      const { execSync } = await import('child_process');
      const { syncSkills } = await import('../../src/services/skill-sync.service');
      const { writeInstalledVersion } = await import('../../src/services/update-checker.service');
      process.env.CI = 'true';

      vi.mocked(execSync).mockReturnValue('0.5.0\n');
      vi.mocked(syncSkills).mockImplementation(() => {
        throw new Error('sync failed');
      });

      await program.parseAsync(['node', 'test', 'update']);

      const allLogs = consoleLogSpy.mock.calls.flat().join('\n');
      expect(allLogs).toContain('Skills sync failed');
      expect(writeInstalledVersion).not.toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenLastCalledWith(0);
    });
  });

  describe('Interactive confirmation', () => {
    it('should ask for confirmation when update available and not in CI', async () => {
      const { execSync } = await import('child_process');
      const readline = await import('readline');

      delete process.env.CI;

      vi.mocked(execSync).mockReturnValue('99.0.0\n');

      vi.mocked(readline.createInterface).mockReturnValue({
        question: vi.fn((_query: string, callback: (answer: string) => void) => {
          callback('y');
        }),
        close: vi.fn(),
      } as any);

      await program.parseAsync(['node', 'test', 'update']);

      const allLogs = consoleLogSpy.mock.calls.flat().join('\n');
      expect(allLogs).toContain('Update available');
    });

    it('should show "Checking for updates" when version is unknown', async () => {
      const { execSync } = await import('child_process');
      const readline = await import('readline');

      delete process.env.CI;

      vi.mocked(execSync).mockImplementation((cmd: any) => {
        const cmdStr = String(cmd);
        if (cmdStr.includes('npm view')) throw new Error('npm view failed');
        return '';
      });

      vi.mocked(readline.createInterface).mockReturnValue({
        question: vi.fn((_query: string, callback: (answer: string) => void) => {
          callback('y');
        }),
        close: vi.fn(),
      } as any);

      await program.parseAsync(['node', 'test', 'update']);

      const allLogs = consoleLogSpy.mock.calls.flat().join('\n');
      expect(allLogs).toContain('Checking for updates');
    });

    it('should cancel update when user declines', async () => {
      const { execSync } = await import('child_process');
      const readline = await import('readline');

      delete process.env.CI;

      vi.mocked(execSync).mockReturnValue('99.0.0\n');

      vi.mocked(readline.createInterface).mockReturnValue({
        question: vi.fn((_query: string, callback: (answer: string) => void) => {
          callback('n');
        }),
        close: vi.fn(),
      } as any);

      await program.parseAsync(['node', 'test', 'update']);

      const allLogs = consoleLogSpy.mock.calls.flat().join('\n');
      expect(allLogs).toContain('Update cancelled');
    });
  });

  describe('Unexpected error handling', () => {
    it('should handle error thrown during update with JSON output', async () => {
      const { execSync } = await import('child_process');

      vi.mocked(execSync).mockImplementation((cmd: any) => {
        const cmdStr = String(cmd);
        if (cmdStr.includes('npm view')) return '99.0.0\n';
        const error = new Error('Permission denied');
        (error as any).code = 'EACCES';
        throw error;
      });

      await program.parseAsync(['node', 'test', 'update', '--json']);

      const allLogs = consoleLogSpy.mock.calls.flat().join('\n');
      expect(allLogs).toContain('"cli"');
    });
  });
});
