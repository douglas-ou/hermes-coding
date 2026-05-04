import { existsSync } from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { Command } from 'commander';
import chalk from 'chalk';
import { ExitCode } from '../core/exit-codes';
import { createError, Errors, handleError } from '../core/error-handler';
import { createStateService } from './service-factory';
import { readConfig, resolveToolCommand } from '../services/config-service';

function resolveLoopScriptPath(): string {
  return path.resolve(__dirname, '..', '..', 'scripts', 'ralph-loop.sh');
}

export function registerLoopCommand(program: Command, workspaceDir: string): void {
  program
    .command('loop')
    .description('Run the Phase 3 implement loop from the current terminal')
    .option('--tool <tool>', 'Override tool from config (claude, amp, codex)')
    .option('--custom <command>', 'Custom tool command (overrides everything)')
    .argument('[max-iterations]', 'Maximum number of iterations')
    .addHelpText(
      'after',
      '\nRun this after /hermes-coding or /hermes-coding resume has advanced the workflow to implement.'
    )
    .action(async (maxIterations: string | undefined, options: { tool?: string; custom?: string }) => {
      try {
        const stateService = createStateService(workspaceDir);
        const state = await stateService.getState();

        if (!state) {
          handleError(Errors.stateNotFound());
          return;
        }

        if (state.phase !== 'implement') {
          handleError(
            createError(
              'INVALID_STATE',
              `The loop command only supports the implement phase. Current phase: ${state.phase}`,
              {
                suggestedAction: 'Resume the workflow in Claude Code, then run "hermes-coding loop" after implement handoff.',
              }
            )
          );
          return;
        }

        const loopScriptPath = resolveLoopScriptPath();
        if (!existsSync(loopScriptPath)) {
          handleError(
            Errors.fileSystemError('Unable to locate the bundled loop controller script', {
              loopScriptPath,
            })
          );
          return;
        }

        // ── Resolve tool commands: --custom > --tool > config.json ──
        let toolCommand: string;
        let toolLabel: string;

        if (options.custom) {
          // Highest priority: explicit custom command
          toolCommand = options.custom;
          toolLabel = 'custom';
        } else if (options.tool) {
          // Second: --tool flag → lookup from TOOL_COMMAND_MAP
          const resolved = resolveToolCommand(options.tool);
          if (!resolved) {
            console.error(chalk.red(`\n✗ Unknown tool '${options.tool}'. Available: claude, amp, codex\n`));
            process.exit(ExitCode.INVALID_INPUT);
            return;
          }
          toolCommand = resolved.command;
          toolLabel = options.tool;
        } else {
          // Third: read from config.json
          const config = readConfig(workspaceDir);
          if (!config) {
            console.error(chalk.red(`\n✗ No tool configuration found.`));
            console.error(chalk.dim(`  Run 'hermes-coding init' to select a tool first.\n`));
            process.exit(ExitCode.INVALID_INPUT);
            return;
          }
          toolCommand = config.toolCommand;
          toolLabel = config.tool;
        }

        // ── Build script args ──
        const scriptArgs: string[] = [
          loopScriptPath,
          '--tool', toolLabel,
          '--tool-command', toolCommand,
        ];
        if (options.custom) scriptArgs.push('--custom', options.custom);
        if (maxIterations) scriptArgs.push(maxIterations);

        const result = spawnSync('/bin/bash', scriptArgs, {
          cwd: workspaceDir,
          env: {
            ...process.env,
            NO_UPDATE_NOTIFIER: process.env.NO_UPDATE_NOTIFIER || '1',
            HERMES_CODING_WORKSPACE: workspaceDir,
          },
          stdio: 'inherit',
        });

        if (result.error) {
          handleError(Errors.fileSystemError('Failed to launch the loop controller', result.error));
          return;
        }

        process.exit(result.status ?? ExitCode.GENERAL_ERROR);
      } catch (error) {
        handleError(Errors.fileSystemError('Failed to start the loop controller', error));
      }
    });
}
