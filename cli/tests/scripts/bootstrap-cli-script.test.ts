import { spawnSync } from 'child_process';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const bootstrapScriptPath = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'skills',
  'hermes-coding',
  'bootstrap-cli.sh'
);

function writeExecutable(filePath: string, contents: string): void {
  fs.outputFileSync(filePath, contents, { encoding: 'utf-8', mode: 0o755 });
  fs.chmodSync(filePath, 0o755);
}

function seedBootstrapWorkspace(workspaceDir: string): {
  binDir: string;
  cacheDir: string;
  callLogPath: string;
} {
  const binDir = path.join(workspaceDir, '.test-bin');
  const cacheDir = path.join(workspaceDir, '.cache-under-test');
  const callLogPath = path.join(workspaceDir, '.bootstrap-call-log.txt');

  fs.ensureDirSync(binDir);
  fs.ensureDirSync(cacheDir);
  fs.writeFileSync(callLogPath, '', 'utf-8');

  writeExecutable(
    path.join(binDir, 'hermes-coding'),
    `#!/usr/bin/env bash
set -euo pipefail
CALL_LOG="${callLogPath}"
if [ "$1" = "--version" ]; then
  echo "0.1.2"
  exit 0
fi
if [ "$1" = "update" ] && [ "$2" = "--auto" ] && [ "$3" = "--target-version" ]; then
  echo "update --auto --target-version $4" >> "$CALL_LOG"
  echo '{"success":true}' 
  exit 0
fi
if [ "$1" = "update" ] && [ "$2" = "--check" ] && [ "$3" = "--json" ]; then
  echo "update --check --json" >> "$CALL_LOG"
  cat <<'JSON'
{
  "success": true,
  "data": {
    "currentVersion": "0.1.2",
    "latestVersion": "0.1.2",
    "updateAvailable": false
  }
}
JSON
  exit 0
fi
echo "unexpected hermes-coding invocation: $*" >> "$CALL_LOG"
exit 64
`
  );

  return { binDir, cacheDir, callLogPath };
}

describe('bootstrap-cli.sh', () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-cli-script-'));
  });

  afterEach(() => {
    fs.removeSync(workspaceDir);
  });

  it('should honor HERMES_CODING_CACHE_DIR and retry --auto when installedVersion is missing', () => {
    const { binDir, cacheDir, callLogPath } = seedBootstrapWorkspace(workspaceDir);
    const now = Date.now();

    fs.writeJSONSync(path.join(cacheDir, 'hermes-coding-update-check.json'), {
      latestVersion: '0.1.2',
      lastChecked: now,
      checkedVersion: '0.1.2',
      installedVersion: null,
    });

    const result = spawnSync(
      '/bin/bash',
      [
        '-lc',
        `source "${bootstrapScriptPath}"`
      ],
      {
        cwd: workspaceDir,
        encoding: 'utf-8',
        env: {
          ...process.env,
          CI: 'false',
          PATH: `${binDir}:${process.env.PATH || ''}`,
          HERMES_CODING_CACHE_DIR: cacheDir,
        },
      }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    const callLog = fs.readFileSync(callLogPath, 'utf-8');
    expect(callLog).toContain('update --auto --target-version 0.1.2');
    expect(callLog).not.toContain('update --check --json');
  });

  it('should refresh expired cache with --check even when NO_UPDATE_NOTIFIER is set', () => {
    const { binDir, cacheDir, callLogPath } = seedBootstrapWorkspace(workspaceDir);
    const staleTimestamp = Date.now() - (48 * 60 * 60 * 1000);

    fs.writeJSONSync(path.join(cacheDir, 'hermes-coding-update-check.json'), {
      latestVersion: '0.1.1',
      lastChecked: staleTimestamp,
      checkedVersion: '0.1.1',
    });

    const result = spawnSync(
      '/bin/bash',
      ['-lc', `source "${bootstrapScriptPath}"`],
      {
        cwd: workspaceDir,
        encoding: 'utf-8',
        env: {
          ...process.env,
          CI: 'false',
          PATH: `${binDir}:${process.env.PATH || ''}`,
          HERMES_CODING_CACHE_DIR: cacheDir,
        },
      }
    );

    expect(result.status).toBe(0);
    const callLog = fs.readFileSync(callLogPath, 'utf-8');
    expect(callLog).toContain('update --check --json');
  });

  it('should not exit when old cache is missing installedVersion and jq is unavailable', () => {
    const { binDir, cacheDir, callLogPath } = seedBootstrapWorkspace(workspaceDir);
    const now = Date.now();

    fs.writeJSONSync(path.join(cacheDir, 'hermes-coding-update-check.json'), {
      latestVersion: '0.1.2',
      lastChecked: now,
      checkedVersion: '0.1.2',
    });

    const result = spawnSync(
      '/bin/bash',
      ['-lc', `PATH="${binDir}:${process.env.PATH || ''}"; source "${bootstrapScriptPath}"`],
      {
        cwd: workspaceDir,
        encoding: 'utf-8',
        env: {
          ...process.env,
          CI: 'false',
          PATH: `${binDir}:${process.env.PATH || ''}`,
          HERMES_CODING_CACHE_DIR: cacheDir,
        },
      }
    );

    expect(result.status).toBe(0);
    const callLog = fs.readFileSync(callLogPath, 'utf-8');
    expect(callLog).toContain('update --auto --target-version 0.1.2');
  });

  it('should skip auto-update when CI=1', () => {
    const { binDir, cacheDir, callLogPath } = seedBootstrapWorkspace(workspaceDir);
    const now = Date.now();

    fs.writeJSONSync(path.join(cacheDir, 'hermes-coding-update-check.json'), {
      latestVersion: '0.2.0',
      lastChecked: now,
      checkedVersion: '0.1.2',
      installedVersion: null,
    });

    const result = spawnSync(
      '/bin/bash',
      ['-lc', `source "${bootstrapScriptPath}"`],
      {
        cwd: workspaceDir,
        encoding: 'utf-8',
        env: {
          ...process.env,
          CI: '1',
          PATH: `${binDir}:${process.env.PATH || ''}`,
          HERMES_CODING_CACHE_DIR: cacheDir,
        },
      }
    );

    expect(result.status).toBe(0);
    const callLog = fs.readFileSync(callLogPath, 'utf-8');
    expect(callLog).toBe('');
  });
});
