/**
 * Init Command - Copy all bundled skills into the current project
 *
 * Copies every subdirectory under skills/ (hermes-coding, baseline-fixer, etc.)
 * into <cwd>/.claude/skills/ so Claude Code discovers them locally.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { ExitCode } from '../core/exit-codes';
import { handleError, Errors } from '../core/error-handler';
import { successResponse, outputResponse } from '../core/response-wrapper';
import { createHookService } from './service-factory';
import { syncSkills } from '../services/skill-sync.service';

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Copy hermes-coding skills into .claude/ for the current project')
    .option('--json', 'Output as JSON')
    .option('--no-hook', 'Skip pre-commit hook creation')
    .action(async (options) => {
      try {
        const { target, skills, totalFiles } = syncSkills(process.cwd());

        const result: Record<string, any> = {
          target,
          skills,
          totalFiles,
        };

        // Pre-commit hook creation (best-effort)
        if (options.hook !== false) {
          try {
            const hookService = createHookService(process.cwd());
            const hookResult = await hookService.createPreCommitHook(process.cwd());
            result.hook = hookResult;
          } catch (hookError) {
            // Best-effort: never fail init due to hook issues
            result.hook = { created: false, reason: String(hookError) };
          }
        }

        if (options.json) {
          const response = successResponse(result, { operation: 'init' });
          outputResponse(response, true);
        } else {
          console.log(chalk.green(`\n✓ hermes-coding skills installed\n`));
          console.log(chalk.dim(`  Target: ${target}`));
          for (const [name, files] of Object.entries(skills)) {
            console.log(chalk.dim(`  ${name}/: ${files.join(', ')}`));
          }

          if (result.hook) {
            if (result.hook.created) {
              console.log(chalk.green(`  Hook:   pre-commit created (${result.hook.testCommand})`));
            } else {
              console.log(chalk.dim(`  Hook:   skipped (${result.hook.reason})`));
            }
          }

          console.log();
        }

        process.exit(ExitCode.SUCCESS);
      } catch (error) {
        handleError(Errors.fileSystemError('Init failed', error), options.json);
      }
    });
}
