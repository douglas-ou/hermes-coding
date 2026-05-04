#!/usr/bin/env bash
#
# hermes-coding: Phase 3 outer loop controller.
# Iterates through tasks, spawning a fresh AI tool process per task.
#
# Run from project root: hermes-coding loop
# Internal: cli/scripts/ralph-loop.sh [options] [max_iterations]
#
# Options:
#   --tool <name>                        Tool name for logging (claude/amp/codex)
#   --tool-command <cmd>                 Full command for tool invocation
#   --custom <cmd>                       Custom command (highest priority)
#
# Env:
#   HERMES_CODING_WORKSPACE   Project root (default: $PWD)
#
# Concurrency: Only one loop per project. Uses PID lock file at
#   .hermes-coding/.loop.lock — stale locks (dead PID) are auto-cleaned.
#

set -euo pipefail

# ── Lock management ──────────────────────────────────────────────────

LOCK_FILE=""
LOOP_ACQUIRED_LOCK=0

acquire_lock() {
  local workspace="$1"
  LOCK_FILE="${workspace}/.hermes-coding/.loop.lock"

  # No lock file → we can acquire
  if [[ ! -f "$LOCK_FILE" ]]; then
    echo $$ > "$LOCK_FILE"
    LOOP_ACQUIRED_LOCK=1
    return 0
  fi

  # Lock exists — read the PID
  local existing_pid
  existing_pid=$(cat "$LOCK_FILE" 2>/dev/null) || existing_pid=""

  # Empty or non-numeric PID → stale/corrupt lock → clean up
  if [[ ! "$existing_pid" =~ ^[0-9]+$ ]]; then
    rm -f "$LOCK_FILE"
    echo $$ > "$LOCK_FILE"
    LOOP_ACQUIRED_LOCK=1
    return 0
  fi

  # Check if the process is still alive
  if kill -0 "$existing_pid" 2>/dev/null; then
    echo "Error: hermes-coding loop is already running (PID $existing_pid)." >&2
    echo "  Lock file: $LOCK_FILE" >&2
    echo "  If this is stale, kill the process or delete the lock file." >&2
    exit 1
  fi

  # Stale lock (process dead) → auto-clean and acquire
  rm -f "$LOCK_FILE"
  echo $$ > "$LOCK_FILE"
  LOOP_ACQUIRED_LOCK=1
}

release_lock() {
  if [[ "$LOOP_ACQUIRED_LOCK" -eq 1 && -n "$LOCK_FILE" && -f "$LOCK_FILE" ]]; then
    # Only remove our own lock (PID matches)
    local lock_pid
    lock_pid=$(cat "$LOCK_FILE" 2>/dev/null) || lock_pid=""
    if [[ "$lock_pid" == "$$" ]]; then
      rm -f "$LOCK_FILE"
    fi
  fi
  LOOP_ACQUIRED_LOCK=0
}

# ── Cleanup on exit ──────────────────────────────────────────────────

cleanup() {
  release_lock
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ── Argument parsing ─────────────────────────────────────────────────

TOOL="claude"
TOOL_COMMAND=""
USER_MAX_ITERATIONS=""
CUSTOM_TOOL=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --tool)                      TOOL="$2"; shift 2 ;;
    --tool=*)                    TOOL="${1#*=}"; shift ;;
    --tool-command)              TOOL_COMMAND="$2"; shift 2 ;;
    --tool-command=*)            TOOL_COMMAND="${1#*=}"; shift ;;
    --custom)                    CUSTOM_TOOL="$2"; shift 2 ;;
    --custom=*)                  CUSTOM_TOOL="${1#*=}"; shift ;;
    *)
      if [[ "$1" =~ ^[0-9]+$ ]]; then
        USER_MAX_ITERATIONS="$1"
      fi
      shift
      ;;
  esac
done

# ── Config missing check ─────────────────────────────────────────────

if [ -z "$CUSTOM_TOOL" ] && [ -z "$TOOL_COMMAND" ]; then
  echo "Error: No tool configuration found. Run 'hermes-coding init' to select a tool." >&2
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "Error: jq is required (brew install jq / apt install jq)." >&2
  exit 1
fi

PROJECT_ROOT="${HERMES_CODING_WORKSPACE:-$(pwd)}"
export HERMES_CODING_WORKSPACE="$PROJECT_ROOT"

if ! command -v hermes-coding &>/dev/null; then
  echo "Error: hermes-coding CLI not found on PATH." >&2
  exit 1
fi

# ── Acquire lock ─────────────────────────────────────────────────────

acquire_lock "$PROJECT_ROOT"

# ── Pre-flight checks ────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(dirname "$CLI_DIR")"

resolve_skill_file() {
  local workspace_skill="${PROJECT_ROOT}/.claude/skills/hermes-coding/phase-3-implement.md"
  local bundled_skill="${CLI_DIR}/plugin-assets/skills/hermes-coding/phase-3-implement.md"
  local source_skill="${REPO_ROOT}/skills/hermes-coding/phase-3-implement.md"

  if [[ -f "$workspace_skill" ]]; then
    echo "$workspace_skill"
    return 0
  fi

  if [[ -f "$bundled_skill" ]]; then
    echo "$bundled_skill"
    return 0
  fi

  if [[ -f "$source_skill" ]]; then
    echo "$source_skill"
    return 0
  fi

  return 1
}

# Determine max iterations
if [[ -n "$USER_MAX_ITERATIONS" ]]; then
  MAX_ITERATIONS="$USER_MAX_ITERATIONS"
else
  TASK_TOTAL=$(hermes-coding tasks list --json --limit 1 2>/dev/null | jq -r '.data.total // 0')
  [[ "$TASK_TOTAL" =~ ^[0-9]+$ ]] || TASK_TOTAL=0
  MAX_ITERATIONS=$((TASK_TOTAL + 5))
fi

# Verify phase is implement
PHASE=$(hermes-coding state get --json 2>/dev/null | jq -r '.data.phase // .phase // "none"')
if [[ "$PHASE" != "implement" ]]; then
  echo "Error: phase is '$PHASE', expected 'implement'." >&2
  exit 1
fi

echo "hermes-coding loop — project: $PROJECT_ROOT — tool: ${CUSTOM_TOOL:-$TOOL} — max: $MAX_ITERATIONS"

# ── Main loop ────────────────────────────────────────────────────────

SKILL_FILE="$(resolve_skill_file)" || {
  echo "Error: phase-3 skill file not found." >&2
  exit 1
}

for i in $(seq 1 "$MAX_ITERATIONS"); do
  echo ""
  echo "=== Iteration $i / $MAX_ITERATIONS ==="
  PROMPT=$(cat "$SKILL_FILE")

  # ── Invoke AI tool ────────────────────────────────────────────────

  # Use interactive shell (-i) so user aliases resolve.
  # CUSTOM_TOOL takes priority over TOOL_COMMAND from config.
  USER_SHELL="${SHELL:-/bin/bash}"
  TOOL_EXIT=0
  if [[ -n "$CUSTOM_TOOL" ]]; then
    echo "$PROMPT" | "$USER_SHELL" -ic "$CUSTOM_TOOL" 2>&1 || TOOL_EXIT=$?
  else
    echo "$PROMPT" | "$USER_SHELL" -ic "$TOOL_COMMAND" 2>&1 || TOOL_EXIT=$?
  fi

  # Handle Ctrl+C (exit code 130 = SIGINT)
  if [[ "$TOOL_EXIT" -eq 130 ]]; then
    echo "" >&2
    echo "Loop interrupted by user (Ctrl+C)." >&2
    exit 130
  fi

  # Check for tool-not-found errors
  if [[ "$TOOL_EXIT" -ne 0 ]]; then
    TOOL_BIN=$(echo "${CUSTOM_TOOL:-$TOOL_COMMAND}" | cut -d' ' -f1)
    if ! command -v "$TOOL_BIN" &> /dev/null; then
      echo "Error: Tool not installed: $TOOL_BIN" >&2
      echo "Install it first, or run 'hermes-coding init' to switch tools." >&2
    fi
  fi

  NEXT_JSON=$(hermes-coding tasks next --json 2>/dev/null) || NEXT_JSON='{}'
  RESULT=$(echo "$NEXT_JSON" | jq -r '.data.result // "unknown"')

  case "$RESULT" in
    all_done)
      echo "All tasks resolved. Transitioning to deliver."
      hermes-coding state update --phase deliver
      exit 0
      ;;
    blocked)
      echo "Remaining tasks are blocked by dependencies."
      exit 1
      ;;
    task_found)
      ;;
    *)
      echo "Unexpected result from tasks next: $RESULT" >&2
      exit 1
      ;;
  esac

  # Brief pause between iterations
  sleep 2
done

echo "" >&2
echo "Reached max iterations ($MAX_ITERATIONS) without completing all tasks." >&2
exit 1
