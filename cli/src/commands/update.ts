/**
 * Update Command - Update hermes-coding CLI
 *
 * Supports manual interactive updates and non-interactive auto-updates
 * triggered by the bootstrap script.
 */

import { Command } from 'commander';
import { execSync } from 'child_process';
import { createInterface } from 'readline';
import chalk from 'chalk';
import { ExitCode } from '../core/exit-codes';
import { handleError, Errors } from '../core/error-handler';
import { errorResponse, successResponse, outputResponse } from '../core/response-wrapper';
import { checkForUpdates, writeInstalledVersion } from '../services/update-checker.service';
import { syncSkills } from '../services/skill-sync.service';
import { version as currentVersion } from '../../package.json';

interface UpdateResult {
  cli: {
    updated: boolean;
    previousVersion: string;
    newVersion?: string;
    error?: string;
  };
  skills?: {
    synced: boolean;
    target?: string;
    totalFiles?: number;
    error?: string;
  };
}

const PACKAGE_NAME = 'hermes-coding';

function askConfirmation(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.toLowerCase().trim();
      resolve(normalized === 'y' || normalized === 'yes');
    });
  });
}

function getLatestVersion(): string | null {
  try {
    const result = execSync(`npm view ${PACKAGE_NAME} version`, {
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim();
  } catch {
    return null;
  }
}

function getInstalledVersion(): string | null {
  try {
    const result = execSync(`npm list -g ${PACKAGE_NAME} --depth=0 --json`, {
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(result) as {
      dependencies?: Record<string, { version?: string }>;
    };
    return parsed.dependencies?.[PACKAGE_NAME]?.version?.trim() || null;
  } catch {
    try {
      const result = execSync(`${PACKAGE_NAME} --version`, {
        encoding: 'utf-8',
        timeout: 30000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return result.trim().replace(/^v/, '');
    } catch {
      return null;
    }
  }
}

function updateCLI(silent: boolean = false): { success: boolean; newVersion?: string; error?: string } {
  try {
    if (!silent) {
      console.log(chalk.cyan('\n🔄 Updating CLI via npm...\n'));
    }

    execSync(`npm install -g ${PACKAGE_NAME}@latest`, {
      stdio: silent ? 'pipe' : 'inherit',
      timeout: 120000,
    });

    const newVersion = getInstalledVersion();
    return { success: true, newVersion: newVersion || undefined };
  } catch (error) {
    try {
      execSync(`npx npm install -g ${PACKAGE_NAME}@latest`, {
        stdio: silent ? 'pipe' : 'inherit',
        timeout: 120000,
      });
      const newVersion = getInstalledVersion();
      return { success: true, newVersion: newVersion || undefined };
    } catch (npxError) {
      return {
        success: false,
        error: npxError instanceof Error ? npxError.message : String(npxError),
      };
    }
  }
}

/**
 * Handle --auto mode: non-interactive update with skill sync.
 * Used by bootstrap-cli.sh to auto-update the CLI.
 *
 * In --auto mode, bash has already determined an update is needed,
 * so we skip the redundant npm view check and go straight to install.
 */
function handleAutoUpdate(options: { json?: boolean }): void {
  const result: UpdateResult = {
    cli: {
      updated: false,
      previousVersion: currentVersion,
    },
  };

  const installedVersionBeforeUpdate = getInstalledVersion();
  const cliAlreadyCurrent =
    installedVersionBeforeUpdate !== null &&
    installedVersionBeforeUpdate === currentVersion;

  let cliResult: { success: boolean; newVersion?: string; error?: string };
  if (cliAlreadyCurrent) {
    cliResult = { success: true, newVersion: installedVersionBeforeUpdate ?? currentVersion };
  } else {
    // Skip redundant npm view — bash already confirmed update is needed.
    // Go straight to npm install.
    cliResult = updateCLI(true);
  }

  if (!cliResult.success) {
    result.cli.error = cliResult.error;
    outputResponse(
      errorResponse(
        'AUTO_UPDATE_FAILED',
        cliResult.error || 'Failed to update hermes-coding CLI',
        {
          details: result,
          recoverable: true,
          suggestedAction: 'Check npm/network access and retry the update.',
          metadata: { operation: 'update' },
        }
      ),
      !!options.json
    );
    process.exit(ExitCode.GENERAL_ERROR);
    return;
  }

  result.cli.updated = !cliAlreadyCurrent;
  result.cli.newVersion = cliResult.newVersion;

  // Sync skills after successful CLI update
  let skillsSynced = false;
  try {
    const workspaceDir = process.env.HERMES_CODING_WORKSPACE || process.cwd();
    const syncResult = syncSkills(workspaceDir);
    result.skills = {
      synced: true,
      target: syncResult.target,
      totalFiles: syncResult.totalFiles,
    };
    skillsSynced = true;
  } catch (skillError) {
    result.skills = {
      synced: false,
      error: skillError instanceof Error ? skillError.message : String(skillError),
    };
  }

  // Only record installed version if both CLI update AND skills sync succeeded.
  // If skills sync failed, don't mark as complete so bash will retry next time.
  if (skillsSynced) {
    if (cliResult.newVersion) {
      writeInstalledVersion(cliResult.newVersion);
    }
    outputResponse(successResponse(result, { operation: 'update' }), !!options.json);
    process.exit(ExitCode.SUCCESS);
    return;
  }

  outputResponse(
    errorResponse(
      'SKILL_SYNC_FAILED',
      'CLI updated but failed to sync bundled skills',
      {
        details: result,
        recoverable: true,
        suggestedAction: 'Retry the update or run `hermes-coding init` in the workspace.',
        metadata: { operation: 'update' },
      }
    ),
    !!options.json
  );
  process.exit(ExitCode.GENERAL_ERROR);
}

export function registerUpdateCommand(program: Command): void {
  program
    .command('update')
    .description('Manually update hermes-coding CLI')
    .option('--check', 'Check for updates without installing')
    .option('--auto', 'Non-interactive auto-update with skill sync (used by bootstrap)')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        // Auto-update mode (non-interactive, used by bootstrap)
        if (options.auto) {
          handleAutoUpdate(options);
          return;
        }

        const result: UpdateResult = {
          cli: {
            updated: false,
            previousVersion: currentVersion,
          },
        };

        if (options.check) {
          const checkResult = checkForUpdates({
            packageName: PACKAGE_NAME,
            currentVersion,
          });

          if (!checkResult.latestVersion) {
            if (options.json) {
              outputResponse(successResponse({ error: 'Failed to check for updates' }, { operation: 'update-check' }), true);
            } else {
              console.log(chalk.yellow('Failed to check for updates'));
            }
            process.exit(ExitCode.GENERAL_ERROR);
          }

          const latestVersion = checkResult.latestVersion;
          const hasUpdate = checkResult.hasUpdate;

          if (options.json) {
            outputResponse(successResponse({ currentVersion, latestVersion, updateAvailable: hasUpdate }, { operation: 'update-check' }), true);
          } else {
            if (hasUpdate) {
              console.log(chalk.yellow(`\nUpdate available: ${currentVersion} → ${latestVersion}`));
              console.log(chalk.dim(`Run 'hermes-coding update' to install\n`));
            } else {
              console.log(chalk.green(`\n✓ You're on the latest version (${currentVersion})\n`));
            }
          }
          process.exit(ExitCode.SUCCESS);
        }

        const latestVersion = getLatestVersion();
        const hasUpdate = latestVersion ? latestVersion !== currentVersion : true;
        const versionKnown = latestVersion !== null;

        if (!hasUpdate) {
          console.log(chalk.green(`\n✓ CLI is already at the latest version (${currentVersion})\n`));
        }

        if (hasUpdate && !options.json && !process.env.CI) {
          if (versionKnown) {
            console.log(chalk.yellow(`\n📦 Update available: ${currentVersion} → ${latestVersion}\n`));
          } else {
            console.log(chalk.yellow(`\n📦 Checking for updates...\n`));
          }
          const confirmed = await askConfirmation('Do you want to update? (y/N): ');
          if (!confirmed) {
            console.log(chalk.dim('\nUpdate cancelled.\n'));
            process.exit(ExitCode.SUCCESS);
          }
        }

        if (hasUpdate) {
          const cliResult = updateCLI();
          result.cli.updated = cliResult.success;
          result.cli.newVersion = cliResult.newVersion;
          result.cli.error = cliResult.error;

          if (cliResult.success) {
            console.log(chalk.green(`\n✓ CLI updated to v${cliResult.newVersion}\n`));
          } else {
            console.log(chalk.yellow(`\n⚠️ CLI update failed: ${cliResult.error}\n`));
          }
        }

        const response = successResponse(result, { operation: 'update' });

        if (options.json) {
          outputResponse(response, true);
        } else {
          console.log(chalk.dim('Please restart the CLI to use the new version.\n'));
        }

        process.exit(ExitCode.SUCCESS);
      } catch (error) {
        handleError(Errors.fileSystemError('Update failed', error), options.json);
      }
    });
}
