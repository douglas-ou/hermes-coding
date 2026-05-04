/**
 * Init Command - Bootstrap hermes-coding in the current project
 *
 * Copies bundled skills to .claude/skills/ and .agents/skills/,
 * writes config.json with the user's tool selection, and
 * optionally creates a pre-commit hook.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as clack from '@clack/prompts';
import { ExitCode } from '../core/exit-codes';
import { handleError, Errors } from '../core/error-handler';
import { createHookService } from './service-factory';
import { syncSkills } from '../services/skill-sync.service';
import { writeConfig, resolveToolCommand, HermesConfig } from '../services/config-service';

const TOOL_OPTIONS = [
  { value: 'claude', label: 'Claude Code', hint: 'CLI by Anthropic' },
  { value: 'amp', label: 'Amp', hint: 'CLI by Sourcegraph' },
  { value: 'codex', label: 'Codex', hint: 'CLI by OpenAI' },
];

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Bootstrap hermes-coding in the current project')
    .option('--tool <tool>', 'Non-interactive: specify tool (claude, amp, codex)')
    .option('--no-hook', 'Skip pre-commit hook creation')
    .action(async (options) => {
      try {
        // ── 1. Determine tool ──────────────────────────────────────────
        let tool: string;

        if (options.tool) {
          // Non-interactive mode via --tool flag
          const resolved = resolveToolCommand(options.tool);
          if (!resolved) {
            console.error(chalk.red(`\n✗ Unknown tool '${options.tool}'. Available: claude, amp, codex\n`));
            process.exit(ExitCode.INVALID_INPUT);
            return;
          }
          tool = options.tool;
        } else {
          // Interactive selection
          const selection = await clack.select({
            message: 'Select your coding tool:',
            options: TOOL_OPTIONS,
            initialValue: 'claude',
          });

          // clack signals cancel with Symbol('clack:cancel')
          if (clack.isCancel(selection)) {
            console.log(chalk.dim('\nCancelled.\n'));
            process.exit(ExitCode.SUCCESS);
            return;
          }

          tool = selection as string;
        }

        // ── 2. Resolve commands and write config ───────────────────────
        const commands = resolveToolCommand(tool)!;
        const config: HermesConfig = {
          tool,
          toolCommand: commands.command,
          toolCommandInteractive: commands.interactive,
        };
        writeConfig(process.cwd(), config);

        // ── 3. Sync skills ─────────────────────────────────────────────
        const { target, agentsTarget, skills } = syncSkills(process.cwd());

        // ── 4. Pre-commit hook (best-effort) ───────────────────────────
        let hookCreated = false;
        let hookSkipped = false;
        let hookReason = '';

        if (options.hook !== false) {
          try {
            const hookService = createHookService(process.cwd());
            const hookResult = await hookService.createPreCommitHook(process.cwd());
            hookCreated = hookResult.created;
            hookSkipped = !hookResult.created;
            hookReason = hookResult.reason || '';
          } catch (hookError) {
            hookSkipped = true;
            hookReason = String(hookError);
          }
        }

        // ── 5. Output ──────────────────────────────────────────────────
        console.log(chalk.green(`\n✓ Workspace initialized (.hermes-coding/)`));
        console.log(chalk.dim(`  Tool:   ${tool}`));
        console.log(chalk.green(`✓ Config saved (.hermes-coding/config.json)`));

        for (const [name, files] of Object.entries(skills)) {
          const label = name === 'hermes-coding' ? `Skills synced to .claude/skills/${name}/` : `  ${name}/`;
          console.log(chalk.green(`✓ Skills synced to .claude/skills/${name}/`));
        }
        console.log(chalk.green(`✓ Skills synced to .agents/skills/hermes-coding/`));

        if (hookCreated) {
          console.log(chalk.green(`✓ Pre-commit hook installed`));
        } else if (hookSkipped) {
          console.log(chalk.dim(`  Hook: skipped (${hookReason})`));
        }

        console.log();

        process.exit(ExitCode.SUCCESS);
      } catch (error) {
        handleError(Errors.fileSystemError('Init failed', error));
      }
    });
}
