import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as os from 'os';
import { HookService, extractTestCommand, generateHookScript } from '../../src/services/hook-service';
import { LanguageConfig, LanguageDetector } from '../../src/language/detector';
import { MockLogger } from '../../src/test-utils/mock-logger';

/**
 * Mock LanguageDetector for testing
 */
class MockLanguageDetector {
  private mockConfig: LanguageConfig = {
    language: 'typescript',
    verifyCommands: ['npm test'],
  };

  detect(_projectPath: string): LanguageConfig {
    return this.mockConfig;
  }

  setMockConfig(config: LanguageConfig): void {
    this.mockConfig = config;
  }
}

describe('HookService', () => {
  let detector: MockLanguageDetector;
  let logger: MockLogger;
  let service: HookService;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `hook-service-test-${Date.now()}`);
    await fs.ensureDir(tempDir);
    detector = new MockLanguageDetector();
    logger = new MockLogger();
    service = new HookService(detector as any, logger);
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  describe('extractTestCommand', () => {
    it('should extract npm test from TypeScript config', () => {
      const config: LanguageConfig = {
        language: 'typescript',
        verifyCommands: ['npx tsc --noEmit', 'npm run lint', 'npm test', 'npm run build'],
      };
      expect(extractTestCommand(config)).toBe('CI=true npm test');
    });

    it('should extract pytest from Python config', () => {
      const config: LanguageConfig = {
        language: 'python',
        verifyCommands: ['mypy .', 'flake8', 'pytest'],
      };
      expect(extractTestCommand(config)).toBe('CI=true pytest');
    });

    it('should extract go test from Go config', () => {
      const config: LanguageConfig = {
        language: 'go',
        verifyCommands: ['go fmt ./...', 'go vet ./...', 'go test ./...', 'go build ./...'],
      };
      expect(extractTestCommand(config)).toBe('CI=true go test ./...');
    });

    it('should extract cargo test from Rust config', () => {
      const config: LanguageConfig = {
        language: 'rust',
        verifyCommands: ['cargo fmt -- --check', 'cargo clippy -- -D warnings', 'cargo test', 'cargo build'],
      };
      expect(extractTestCommand(config)).toBe('CI=true cargo test');
    });

    it('should return null for unknown language with no test commands', () => {
      const config: LanguageConfig = {
        language: 'unknown',
        verifyCommands: [],
      };
      expect(extractTestCommand(config)).toBeNull();
    });

    it('should extract rspec from Ruby config', () => {
      const config: LanguageConfig = {
        language: 'ruby',
        verifyCommands: ['rubocop', 'rspec'],
      };
      expect(extractTestCommand(config)).toBe('CI=true rspec');
    });

    it('should extract phpunit from PHP config', () => {
      const config: LanguageConfig = {
        language: 'php',
        verifyCommands: ['./vendor/bin/phpcs', './vendor/bin/phpunit'],
      };
      expect(extractTestCommand(config)).toBe('CI=true ./vendor/bin/phpunit');
    });

    it('should extract npx jest from JS config without scripts.test', () => {
      const config: LanguageConfig = {
        language: 'javascript',
        verifyCommands: ['npx jest'],
      };
      expect(extractTestCommand(config)).toBe('CI=true npx jest');
    });

    it('should not double-prefix CI=true', () => {
      const config: LanguageConfig = {
        language: 'typescript',
        verifyCommands: ['CI=true npm test'],
      };
      expect(extractTestCommand(config)).toBe('CI=true npm test');
    });
  });

  describe('generateHookScript', () => {
    it('should contain shebang', () => {
      expect(generateHookScript('CI=true npm test')).toContain('#!/bin/sh');
    });

    it('should contain marker comment', () => {
      expect(generateHookScript('CI=true npm test')).toContain(
        '# hermes-coding auto-generated pre-commit hook'
      );
    });

    it('should contain the test command', () => {
      expect(generateHookScript('CI=true npm test')).toContain('CI=true npm test');
    });

    it('should contain set -e', () => {
      expect(generateHookScript('CI=true npm test')).toContain('set -e');
    });

    it('should mention --no-verify', () => {
      expect(generateHookScript('CI=true npm test')).toContain('git commit --no-verify');
    });
  });

  describe('createPreCommitHook', () => {
    it('should create hook in a git repo with test command', async () => {
      // Arrange
      await fs.ensureDir(path.join(tempDir, '.git', 'hooks'));
      detector.setMockConfig({
        language: 'typescript',
        verifyCommands: ['npm test'],
      });

      // Act
      const result = await service.createPreCommitHook(tempDir);

      // Assert
      expect(result.created).toBe(true);
      expect(result.reason).toBe('created');
      expect(result.testCommand).toBe('CI=true npm test');
      expect(fs.existsSync(result.hookPath)).toBe(true);

      const content = fs.readFileSync(result.hookPath, 'utf-8');
      expect(content).toContain('CI=true npm test');
    });

    it('should skip if not a git repo', async () => {
      // Act (tempDir has no .git)
      const result = await service.createPreCommitHook(tempDir);

      // Assert
      expect(result.created).toBe(false);
      expect(result.reason).toBe('not a git repo');
    });

    it('should skip if no test command detected', async () => {
      // Arrange
      await fs.ensureDir(path.join(tempDir, '.git', 'hooks'));
      detector.setMockConfig({
        language: 'unknown',
        verifyCommands: [],
      });

      // Act
      const result = await service.createPreCommitHook(tempDir);

      // Assert
      expect(result.created).toBe(false);
      expect(result.reason).toBe('no test command detected');
    });

    it('should be idempotent (skip if hook with marker exists)', async () => {
      // Arrange
      await fs.ensureDir(path.join(tempDir, '.git', 'hooks'));
      detector.setMockConfig({
        language: 'typescript',
        verifyCommands: ['npm test'],
      });

      // First call creates the hook
      await service.createPreCommitHook(tempDir);

      // Act - second call
      const result = await service.createPreCommitHook(tempDir);

      // Assert
      expect(result.created).toBe(false);
      expect(result.reason).toBe('already exists');
    });

    it('should skip if existing non-hermes hook found', async () => {
      // Arrange
      const hooksDir = path.join(tempDir, '.git', 'hooks');
      await fs.ensureDir(hooksDir);
      fs.writeFileSync(path.join(hooksDir, 'pre-commit'), '#!/bin/sh\necho "custom hook"\n');

      detector.setMockConfig({
        language: 'typescript',
        verifyCommands: ['npm test'],
      });

      // Act
      const result = await service.createPreCommitHook(tempDir);

      // Assert
      expect(result.created).toBe(false);
      expect(result.reason).toBe('existing hook');
      expect(logger.wasWarnCalled()).toBe(true);
    });

    it('should create executable hook file', async () => {
      // Arrange
      await fs.ensureDir(path.join(tempDir, '.git', 'hooks'));
      detector.setMockConfig({
        language: 'typescript',
        verifyCommands: ['npm test'],
      });

      // Act
      const result = await service.createPreCommitHook(tempDir);

      // Assert
      const stat = fs.statSync(result.hookPath);
      // Check executable bit (0o755)
      expect(stat.mode & 0o111).toBeTruthy();
    });
  });
});
