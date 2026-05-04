import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { readConfig, writeConfig, resolveToolCommand, TOOL_COMMAND_MAP, HermesConfig } from '../../src/services/config-service';

describe('config-service', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-service-test-'));
  });

  afterEach(() => {
    fs.removeSync(tempDir);
  });

  describe('readConfig', () => {
    it('should return null when config file does not exist', () => {
      const result = readConfig(tempDir);
      expect(result).toBeNull();
    });

    it('should return null when config file contains invalid JSON', () => {
      const configDir = path.join(tempDir, '.hermes-coding');
      fs.ensureDirSync(configDir);
      fs.writeFileSync(path.join(configDir, 'config.json'), 'not json', 'utf-8');

      const result = readConfig(tempDir);
      expect(result).toBeNull();
    });

    it('should return correct HermesConfig when file exists', () => {
      const config: HermesConfig = {
        tool: 'codex',
        toolCommand: 'codex exec --sandbox danger-full-access --ask-for-approval never',
        toolCommandInteractive: 'codex',
      };
      writeConfig(tempDir, config);

      const result = readConfig(tempDir);
      expect(result).toEqual(config);
    });

    it('should return claude config correctly', () => {
      const config: HermesConfig = {
        tool: 'claude',
        toolCommand: 'claude --dangerously-skip-permissions --print --verbose',
        toolCommandInteractive: 'claude --dangerously-skip-permissions',
      };
      writeConfig(tempDir, config);

      const result = readConfig(tempDir);
      expect(result).toEqual(config);
    });
  });

  describe('writeConfig', () => {
    it('should write valid JSON to .hermes-coding/config.json', () => {
      const config: HermesConfig = {
        tool: 'amp',
        toolCommand: 'amp --dangerously-allow-all',
        toolCommandInteractive: 'amp --dangerously-allow-all',
      };

      writeConfig(tempDir, config);

      const configPath = path.join(tempDir, '.hermes-coding', 'config.json');
      expect(fs.existsSync(configPath)).toBe(true);

      const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(written).toEqual(config);
    });

    it('should create .hermes-coding directory if it does not exist', () => {
      const config: HermesConfig = {
        tool: 'claude',
        toolCommand: 'claude --dangerously-skip-permissions --print --verbose',
        toolCommandInteractive: 'claude --dangerously-skip-permissions',
      };

      expect(fs.existsSync(path.join(tempDir, '.hermes-coding'))).toBe(false);

      writeConfig(tempDir, config);

      expect(fs.existsSync(path.join(tempDir, '.hermes-coding'))).toBe(true);
    });

    it('should overwrite existing config', () => {
      const config1: HermesConfig = {
        tool: 'claude',
        toolCommand: 'claude --dangerously-skip-permissions --print --verbose',
        toolCommandInteractive: 'claude --dangerously-skip-permissions',
      };
      writeConfig(tempDir, config1);

      const config2: HermesConfig = {
        tool: 'codex',
        toolCommand: 'codex exec --sandbox danger-full-access --ask-for-approval never',
        toolCommandInteractive: 'codex',
      };
      writeConfig(tempDir, config2);

      const result = readConfig(tempDir);
      expect(result).toEqual(config2);
    });
  });

  describe('resolveToolCommand', () => {
    it('should return command pair for claude', () => {
      const result = resolveToolCommand('claude');
      expect(result).toEqual({
        command: 'claude --dangerously-skip-permissions --print --verbose',
        interactive: 'claude --dangerously-skip-permissions',
      });
    });

    it('should return command pair for amp', () => {
      const result = resolveToolCommand('amp');
      expect(result).toEqual({
        command: 'amp --dangerously-allow-all',
        interactive: 'amp --dangerously-allow-all',
      });
    });

    it('should return command pair for codex', () => {
      const result = resolveToolCommand('codex');
      expect(result).toEqual({
        command: 'codex exec --sandbox danger-full-access --ask-for-approval never',
        interactive: 'codex',
      });
    });

    it('should return undefined for unknown tool', () => {
      const result = resolveToolCommand('unknown-tool');
      expect(result).toBeUndefined();
    });
  });

  describe('TOOL_COMMAND_MAP', () => {
    it('should have entries for claude, amp, and codex', () => {
      expect(Object.keys(TOOL_COMMAND_MAP)).toEqual(['claude', 'amp', 'codex']);
    });

    it('should have command and interactive for each tool', () => {
      for (const [tool, entry] of Object.entries(TOOL_COMMAND_MAP)) {
        expect(entry.command).toBeTruthy();
        expect(entry.interactive).toBeTruthy();
        expect(typeof entry.command).toBe('string');
        expect(typeof entry.interactive).toBe('string');
      }
    });
  });
});
