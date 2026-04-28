#!/usr/bin/env node

import { Command } from 'commander';
import { registerStateCommands } from './commands/state';
import { registerTaskCommands } from './commands/tasks';
import { registerStatusCommand } from './commands/status';
import { registerDetectCommand } from './commands/detect';
import { registerLoopCommand } from './commands/loop';
import { registerUpdateCommand } from './commands/update';
import { registerInitCommand } from './commands/init';
import { registerProgressCommands } from './commands/progress';
import { checkAndNotify, checkForUpdates } from './services/update-checker.service';
import chalk from 'chalk';
import { version, name } from '../package.json';

const program = new Command();

// Get workspace directory (default to current directory)
const workspaceDir = process.env.HERMES_CODING_WORKSPACE || process.cwd();

program
  .name('hermes-coding')
  .description('CLI tool for hermes-coding - efficient operations for AI agents')
  .version(version);

// Register command groups
registerStateCommands(program, workspaceDir);
registerTaskCommands(program, workspaceDir);
registerStatusCommand(program, workspaceDir);
registerDetectCommand(program, workspaceDir);
registerLoopCommand(program, workspaceDir);
registerUpdateCommand(program);
registerInitCommand(program);
registerProgressCommands(program, workspaceDir);

// Auto-update check - runs on EVERY command execution
// Shows notification if update available (cached check, 24 hour interval)
// Skip if NO_UPDATE_NOTIFIER is set or in CI environment
// In auto-update mode (triggered by bootstrap), suppress the banner
// Also skip the global pre-check for the dedicated `update --check` command
// because that command performs its own version lookup and should not query npm twice.
const isUpdateCheckCommand =
  process.argv.includes('update') && process.argv.includes('--check');

if (process.env.HERMES_CODING_AUTO_UPDATE === '1') {
  const result = checkForUpdates({
    packageName: name,
    currentVersion: version,
    suppressNotificationOnly: true,
  });
  if (result.hasUpdate && result.latestVersion) {
    console.error(chalk.dim(`Update available: ${version} -> ${result.latestVersion}`));
  }
} else if (!isUpdateCheckCommand) {
  checkAndNotify({
    packageName: name,
    currentVersion: version,
  });
} else {
  // Skip redundant pre-check for `hermes-coding update --check`.
}

// Parse command line arguments
program.parse(process.argv);
