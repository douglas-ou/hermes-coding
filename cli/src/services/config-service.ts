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
  toolCommandInteractive: string;
}

export const TOOL_COMMAND_MAP: Record<string, { command: string; interactive: string }> = {
  claude: {
    command: 'claude --dangerously-skip-permissions --print --verbose',
    interactive: 'claude --dangerously-skip-permissions',
  },
  amp: {
    command: 'amp --dangerously-allow-all',
    interactive: 'amp --dangerously-allow-all',
  },
  codex: {
    command: 'codex exec --sandbox danger-full-access --ask-for-approval never',
    interactive: 'codex',
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
 * Look up a tool's command pair from the TOOL_COMMAND_MAP.
 * Returns undefined for unknown tools.
 */
export function resolveToolCommand(
  tool: string,
): { command: string; interactive: string } | undefined {
  return TOOL_COMMAND_MAP[tool];
}
