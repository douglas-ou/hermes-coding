#!/usr/bin/env bash
set -euo pipefail
CLI_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(dirname "$CLI_DIR")"
rm -rf "$CLI_DIR/plugin-assets"
mkdir -p "$CLI_DIR/plugin-assets"
cp -r "$REPO_ROOT/skills" "$CLI_DIR/plugin-assets/skills"
