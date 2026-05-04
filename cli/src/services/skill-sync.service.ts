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

  // Copy to .agents/skills/ and rewrite internal path references
  copyToTarget(skillsRoot, agentsSkillsDir);
  rewriteClaudePathsToAgents(agentsSkillsDir);

  return {
    target: targetSkillsDir,
    agentsTarget: agentsSkillsDir,
    skills,
    totalFiles,
  };
}
