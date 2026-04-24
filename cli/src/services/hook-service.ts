import * as path from 'path';
import * as fs from 'fs-extra';
import { LanguageConfig, LanguageDetector } from '../language/detector';
import { ILogger } from '../infrastructure/logger';

export interface HookResult {
  created: boolean;
  reason: string;
  hookPath: string;
  testCommand: string | null;
}

const MARKER = '# hermes-coding auto-generated pre-commit hook';

export class HookService {
  constructor(
    private readonly detector: typeof LanguageDetector,
    private readonly logger: ILogger
  ) {}

  async createPreCommitHook(projectDir: string): Promise<HookResult> {
    const hookPath = path.join(projectDir, '.git', 'hooks', 'pre-commit');
    const hooksDir = path.dirname(hookPath);

    // Not a git repo
    if (!fs.existsSync(hooksDir)) {
      this.logger.info('Not a git repo — skipping pre-commit hook creation.');
      return { created: false, reason: 'not a git repo', hookPath, testCommand: null };
    }

    // Detect language and extract test command
    const config = this.detector.detect(projectDir);
    const testCommand = extractTestCommand(config);

    if (!testCommand) {
      this.logger.info('No test command detected — skipping pre-commit hook creation.');
      return { created: false, reason: 'no test command detected', hookPath, testCommand: null };
    }

    // Existing hook check
    if (fs.existsSync(hookPath)) {
      const content = fs.readFileSync(hookPath, 'utf-8');
      if (content.includes(MARKER)) {
        return { created: false, reason: 'already exists', hookPath, testCommand };
      }
      this.logger.warn('Existing pre-commit hook found — not overwriting. Use --no-verify to skip.');
      return { created: false, reason: 'existing hook', hookPath, testCommand };
    }

    // Create hook
    const script = generateHookScript(testCommand);
    fs.writeFileSync(hookPath, script, { encoding: 'utf-8' });
    fs.chmodSync(hookPath, 0o755);

    this.logger.info(`Pre-commit hook created at ${hookPath}`);
    return { created: true, reason: 'created', hookPath, testCommand };
  }
}

const TEST_COMMAND_PATTERN = /test|rspec|phpunit|jest\b/;

/**
 * Extract the single test command from a LanguageConfig's verifyCommands.
 * Matches commands containing "test" (npm test, pytest, go test, cargo test…)
 * plus known test runners that lack the substring (rspec, phpunit, jest).
 * Prepends CI=true if not already present.
 */
export function extractTestCommand(config: LanguageConfig): string | null {
  const testCmd = config.verifyCommands.find((cmd) => TEST_COMMAND_PATTERN.test(cmd));
  if (!testCmd) return null;
  if (testCmd.startsWith('CI=true')) return testCmd;
  return `CI=true ${testCmd}`;
}

/**
 * Generate the pre-commit hook shell script.
 */
export function generateHookScript(testCommand: string): string {
  return [
    '#!/bin/sh',
    MARKER,
    '# Runs regression tests before allowing commits.',
    '# To skip temporarily: git commit --no-verify',
    '',
    'set -e',
    '',
    'echo "hermes-coding: running pre-commit regression tests..."',
    '',
    testCommand,
    '',
    'echo "hermes-coding: all tests passed."',
    '',
  ].join('\n');
}
