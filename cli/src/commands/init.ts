/**
 * Init Command - Copy all bundled skills into the current project
 *
 * Copies every subdirectory under skills/ (hermes-coding, baseline-fixer, etc.)
 * into <cwd>/.claude/skills/ so Claude Code discovers them locally.
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs-extra';
import chalk from 'chalk';
import { ExitCode } from '../core/exit-codes';
import { handleError, Errors } from '../core/error-handler';
import { successResponse, outputResponse } from '../core/response-wrapper';
import { createHookService } from './service-factory';

// Root of the installed CLI package (two hops up from dist/commands/)
const cliRoot = path.resolve(__dirname, '..', '..');

/**
 * Resolve the source skills/ root directory.
 * Dual-path: bundled npm package first, then local monorepo fallback.
 */
function resolveSkillsRoot(): string {
  // 1. Published npm: plugin-assets/skills/ bundled at publish time
  const bundled = path.join(cliRoot, 'plugin-assets', 'skills');
  if (fs.existsSync(bundled)) {
    return bundled;
  }

  // 2. Local dev / npm link: ../skills/ (monorepo layout)
  const monorepo = path.resolve(cliRoot, '..', 'skills');
  if (fs.existsSync(monorepo)) {
    return monorepo;
  }

  throw new Error(
    `Cannot locate skills assets.\n` +
      `Checked:\n  ${bundled}\n  ${monorepo}`
  );
}

/** Skip hidden files/directories (e.g. .DS_Store) */
function skipHidden(_src: string, dest: string): boolean {
  return !path.basename(dest).startsWith('.');
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Copy hermes-coding skills into .claude/ for the current project')
    .option('--json', 'Output as JSON')
    .option('--no-hook', 'Skip pre-commit hook creation')
    .action(async (options) => {
      try {
        const skillsRoot = resolveSkillsRoot();
        const targetSkillsDir = path.join(process.cwd(), '.claude', 'skills');

        // Enumerate skill subdirectories (hermes-coding, baseline-fixer, ...)
        const skillNames = fs
          .readdirSync(skillsRoot)
          .filter((name) => !name.startsWith('.') && fs.statSync(path.join(skillsRoot, name)).isDirectory());

        fs.mkdirpSync(targetSkillsDir);

        // Copy each skill directory
        const skills: Record<string, string[]> = {};
        for (const skillName of skillNames) {
          const srcDir = path.join(skillsRoot, skillName);
          const destDir = path.join(targetSkillsDir, skillName);

          fs.mkdirpSync(destDir);
          fs.copySync(srcDir, destDir, { overwrite: true, filter: skipHidden });

          skills[skillName] = fs
            .readdirSync(destDir)
            .filter((f) => !f.startsWith('.'));
        }

        const totalFiles = Object.values(skills).reduce((sum, files) => sum + files.length, 0);

        const result: Record<string, any> = {
          target: targetSkillsDir,
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
          console.log(chalk.dim(`  Target: ${targetSkillsDir}`));
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
