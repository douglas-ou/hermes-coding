/**
 * Update Command - Manually update hermes-coding CLI
 *
 * Provides manual control over CLI updates.
 */

import { Command } from 'commander';
import { execSync } from 'child_process';
import { createInterface } from 'readline';
import chalk from 'chalk';
import { ExitCode } from '../core/exit-codes';
import { handleError, Errors } from '../core/error-handler';
import { successResponse, outputResponse } from '../core/response-wrapper';
import { version as currentVersion } from '../../package.json';

interface UpdateResult {
  cli: {
    updated: boolean;
    previousVersion: string;
    newVersion?: string;
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

function updateCLI(): { success: boolean; newVersion?: string; error?: string } {
  try {
    console.log(chalk.cyan('\n🔄 Updating CLI via npm...\n'));

    execSync(`npm install -g ${PACKAGE_NAME}@latest`, {
      stdio: 'inherit',
      timeout: 120000,
    });

    const newVersion = getLatestVersion();
    return { success: true, newVersion: newVersion || undefined };
  } catch (error) {
    try {
      execSync(`npx npm install -g ${PACKAGE_NAME}@latest`, {
        stdio: 'inherit',
        timeout: 120000,
      });
      const newVersion = getLatestVersion();
      return { success: true, newVersion: newVersion || undefined };
    } catch (npxError) {
      return {
        success: false,
        error: npxError instanceof Error ? npxError.message : String(npxError),
      };
    }
  }
}

export function registerUpdateCommand(program: Command): void {
  program
    .command('update')
    .description('Manually update hermes-coding CLI')
    .option('--check', 'Check for updates without installing')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const result: UpdateResult = {
          cli: {
            updated: false,
            previousVersion: currentVersion,
          },
        };

        if (options.check) {
          const latestVersion = getLatestVersion();

          if (!latestVersion) {
            if (options.json) {
              outputResponse(successResponse({ error: 'Failed to check for updates' }, { operation: 'update-check' }), true);
            } else {
              console.log(chalk.yellow('Failed to check for updates'));
            }
            process.exit(ExitCode.GENERAL_ERROR);
          }

          const hasUpdate = latestVersion !== currentVersion;

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
