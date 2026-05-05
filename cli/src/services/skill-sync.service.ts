/**
 * Skill Sync Service
 *
 * Copies bundled skills from the npm package to both
 * .claude/skills/ and .agents/skills/ in the target workspace.
 *
 * Extracted from init.ts for reuse by the auto-update flow.
 */

import * as path from 'path';
import * as fs from 'fs-extra';

// Root of the installed CLI package (two hops up from dist/services/)
const cliRoot = path.resolve(__dirname, '..', '..');

export interface SkillSyncResult {
  /** .claude/skills/ target */
  target: string;
  /** .agents/skills/ target */
  agentsTarget: string;
  skills: Record<string, string[]>;
  totalFiles: number;
}

/**
 * Resolve the source skills/ root directory.
 * Dual-path: bundled npm package first, then local monorepo fallback.
 */
export function resolveSkillsRoot(): string {
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

/**
 * Copy all skill subdirectories to a single target directory.
 * Returns the skills map and total file count.
 */
function copyToTarget(skillsRoot: string, targetDir: string): {
  skills: Record<string, string[]>;
  totalFiles: number;
} {
  const skillNames = fs
    .readdirSync(skillsRoot)
    .filter(
      (name) =>
        !name.startsWith('.') &&
        fs.statSync(path.join(skillsRoot, name)).isDirectory()
    );

  fs.mkdirpSync(targetDir);

  const skills: Record<string, string[]> = {};
  for (const skillName of skillNames) {
    const srcDir = path.join(skillsRoot, skillName);
    const destDir = path.join(targetDir, skillName);

    fs.mkdirpSync(destDir);
    fs.copySync(srcDir, destDir, { overwrite: true, filter: skipHidden });

    skills[skillName] = fs
      .readdirSync(destDir)
      .filter((f) => !f.startsWith('.'));
  }

  const totalFiles = Object.values(skills).reduce(
    (sum, files) => sum + files.length,
    0
  );

  return { skills, totalFiles };
}

/**
 * Rewrite `.claude/skills/` path references to `.agents/skills/`
 * in all text files under the given directory.
 */
function rewriteClaudePathsToAgents(agentsSkillsDir: string): void {
  const textFileExts = new Set(['.md', '.sh', '.txt', '.yaml', '.yml', '.json']);

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && textFileExts.has(path.extname(fullPath))) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        if (content.includes('.claude/skills/')) {
          const updated = content.replace(/\.claude\/skills\//g, '.agents/skills/');
          fs.writeFileSync(fullPath, updated, 'utf-8');
        }
      }
    }
  }

  walk(agentsSkillsDir);
}

/**
 * Rewrite Claude Code spawn syntax to Codex `spawn_agent` syntax
 * in all text files under the .agents/skills/ directory.
 *
 * Claude Code uses `Tool: Task` with `subagent_type`, `description`,
 * `prompt`, and `run_in_background`. Codex uses `Tool: spawn_agent`
 * with `task_name`, `fork_turns`, and `message`.
 *
 * Transformations:
 *  1. "Tool: Task" / "Tool: Agent (or Task)" → "Tool: spawn_agent"
 *  2. Remove `subagent_type: "..."` lines
 *  3. `description:` → `task_name:` (indented only — skips frontmatter)
 *  4. Insert `fork_turns: "none"` after each `task_name:` line
 *  5. `prompt:` → `message:` (indented only)
 *  6. Remove `run_in_background: ...` lines
 *  7. `Task` → `spawn_agent` in `allowed-tools: [...]` frontmatter
 *  8. `Task` → `spawn_agent` in `<!-- ...Tools:... -->` HTML comments
 */
export function rewriteSpawnSyntaxForCodex(agentsSkillsDir: string): void {
  const textFileExts = new Set(['.md', '.sh', '.txt', '.yaml', '.yml', '.json']);

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && textFileExts.has(path.extname(fullPath))) {
        let content = fs.readFileSync(fullPath, 'utf-8');
        const original = content;

        // 1. Tool line: "Tool: Task" or "Tool: Agent (or Task)" → "Tool: spawn_agent"
        content = content.replace(
          /^Tool: (?:Agent \(or )?Task\)?$/gm,
          'Tool: spawn_agent'
        );

        // 2. Remove subagent_type lines (indented, inside spawn blocks)
        content = content.replace(/^\s*subagent_type: ".*"\n?/gm, '');

        // 3. description → task_name (2-space indent to avoid frontmatter)
        content = content.replace(/^ {2}description: /gm, '  task_name: ');

        // 4. Insert fork_turns: "none" after each task_name line
        content = content.replace(
          /^( {2}task_name: [^\n]*)\n/gm,
          '$1\n  fork_turns: "none"\n'
        );

        // 5. prompt → message (2-space indent)
        content = content.replace(/^ {2}prompt: /gm, '  message: ');

        // 6. Remove run_in_background lines
        content = content.replace(/^\s*run_in_background: [^\n]*\n?/gm, '');

        // 7. YAML frontmatter: Task → spawn_agent in allowed-tools
        content = content.replace(
          /^(allowed-tools:\s*\[[^\]]*?)\bTask\b/gm,
          '$1spawn_agent'
        );

        // 8. HTML comment: Task → spawn_agent in Tools declaration
        content = content.replace(
          /^(<!-- .*Tools:[^]*?-->)/gm,
          (match) => match.replace(/\bTask\b/g, 'spawn_agent')
        );

        if (content !== original) {
          fs.writeFileSync(fullPath, content, 'utf-8');
        }
      }
    }
  }

  walk(agentsSkillsDir);
}

/**
 * Copy bundled skills to both .claude/skills/ and .agents/skills/.
 *
 * The .agents/ copy has all `.claude/skills/` references rewritten
 * to `.agents/skills/` so that agent tools (Codex, Amp) resolve
 * paths correctly when reading their own skill files.
 *
 * @param workspaceDir - Project root where directories will be created
 * @returns SkillSyncResult with both targets and copied skill info
 */
export function syncSkills(workspaceDir: string): SkillSyncResult {
  const skillsRoot = resolveSkillsRoot();
  const targetSkillsDir = path.join(workspaceDir, '.claude', 'skills');
  const agentsSkillsDir = path.join(workspaceDir, '.agents', 'skills');

  // Copy to .claude/skills/ (unchanged)
  const { skills, totalFiles } = copyToTarget(skillsRoot, targetSkillsDir);

  // Copy to .agents/skills/ and rewrite for Codex/Amp compatibility
  copyToTarget(skillsRoot, agentsSkillsDir);
  rewriteClaudePathsToAgents(agentsSkillsDir);
  rewriteSpawnSyntaxForCodex(agentsSkillsDir);

  return {
    target: targetSkillsDir,
    agentsTarget: agentsSkillsDir,
    skills,
    totalFiles,
  };
}
