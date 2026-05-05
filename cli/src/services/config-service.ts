/**
 * Config Service
 *
 * Simple functions for reading/writing .hermes-coding/config.json.
 * No DI interface — thin wrappers over fs-extra, same pattern as skill-sync.
 */

import * as path from 'path';
import * as fs from 'fs-extra';

export interface HermesConfig {
  tool: string;
  toolCommand: string;
}

export const TOOL_COMMAND_MAP: Record<string, { command: string }> = {
  claude: {
    command: 'claude --dangerously-skip-permissions --print --verbose',
  },
  amp: {
    command: 'amp --dangerously-allow-all',
  },
  codex: {
    command: 'codex --yolo exec',
  },
};

/**
 * Read config from .hermes-coding/config.json.
 * Returns null if file doesn't exist or content is invalid JSON.
 */
export function readConfig(workspaceDir: string): HermesConfig | null {
  const configPath = path.join(workspaceDir, '.hermes-coding', 'config.json');
  try {
    if (!fs.existsSync(configPath)) return null;
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as HermesConfig;
  } catch {
    return null;
  }
}

/**
 * Write config to .hermes-coding/config.json.
 */
export function writeConfig(workspaceDir: string, config: HermesConfig): void {
  const configPath = path.join(workspaceDir, '.hermes-coding', 'config.json');
  fs.ensureDirSync(path.join(workspaceDir, '.hermes-coding'));
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/**
 * Maps each tool to its expected agent instruction file (project root)
 * and the command to generate it. Tools without a known file are excluded.
 */
export const TOOL_INSTRUCTION_FILE_MAP: Record<
  string,
  { fileName: string; initCommand: string }
> = {
  claude: { fileName: 'CLAUDE.md', initCommand: 'claude init' },
  codex: { fileName: 'AGENTS.md', initCommand: 'codex init' },
  amp: { fileName: 'AGENTS.md', initCommand: 'amp init' },
};

/**
 * Look up a tool's command pair from the TOOL_COMMAND_MAP.
 * Returns undefined for unknown tools.
 */
export function resolveToolCommand(
  tool: string,
): { command: string } | undefined {
  return TOOL_COMMAND_MAP[tool];
}
