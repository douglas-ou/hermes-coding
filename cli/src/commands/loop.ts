import { existsSync } from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { Command } from 'commander';
import { ExitCode } from '../core/exit-codes';
import { createError, Errors, handleError } from '../core/error-handler';
import { createStateService } from './service-factory';

function resolveLoopScriptPath(): string {
  return path.resolve(__dirname, '..', '..', 'scripts', 'ralph-loop.sh');
}

export function registerLoopCommand(program: Command, workspaceDir: string): void {
  program
    .command('loop')
    .description('Run the Phase 3 implement loop from the current terminal')
    .option('--tool <tool>', 'AI tool to use (claude or amp)', 'claude')
    .option('--custom <command>', 'Custom tool command to run (e.g. "codex --approval-mode full-auto")')
    .option('--visible', 'Open a visible terminal window per iteration')
    .argument('[max-iterations]', 'Maximum number of iterations')
    .addHelpText(
      'after',
      '\nRun this after /hermes-coding or /hermes-coding resume has advanced the workflow to implement.'
    )
    .action(async (maxIterations: string | undefined, options: { tool: string; visible: boolean; custom?: string }) => {
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

        const scriptArgs: string[] = [loopScriptPath, '--tool', options.tool];
        if (options.custom) scriptArgs.push('--custom', options.custom);
        if (options.visible) scriptArgs.push('--visible');
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
