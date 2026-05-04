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
#   --tool-command <cmd>                 Full command for background mode
#   --tool-command-interactive <cmd>     Full command for interactive/visible mode
#   --custom <cmd>                       Custom command (highest priority)
#   --visible                            Open visible terminal per iteration
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
TOOL_COMMAND_INTERACTIVE=""
USER_MAX_ITERATIONS=""
VISIBLE=0
CUSTOM_TOOL=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --tool)                      TOOL="$2"; shift 2 ;;
    --tool=*)                    TOOL="${1#*=}"; shift ;;
    --tool-command)              TOOL_COMMAND="$2"; shift 2 ;;
    --tool-command=*)            TOOL_COMMAND="${1#*=}"; shift ;;
    --tool-command-interactive)  TOOL_COMMAND_INTERACTIVE="$2"; shift 2 ;;
    --tool-command-interactive=*) TOOL_COMMAND_INTERACTIVE="${1#*=}"; shift ;;
    --custom)                    CUSTOM_TOOL="$2"; shift 2 ;;
    --custom=*)                  CUSTOM_TOOL="${1#*=}"; shift ;;
    --visible)                   VISIBLE=1; shift ;;
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

echo "hermes-coding loop — project: $PROJECT_ROOT — tool: ${CUSTOM_TOOL:-$TOOL} — max: $MAX_ITERATIONS — visible: $VISIBLE"

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

  if [[ "$VISIBLE" -eq 1 && "$(uname)" == "Darwin" ]]; then
    # ── Visible mode: interactive TUI in a new Terminal.app window ──
    PROMPT_FILE=$(mktemp "/tmp/hermes-prompt-${i}-XXXXXX")
    echo "$PROMPT" > "$PROMPT_FILE"

    MARKER_FILE=$(mktemp "/tmp/hermes-marker-${i}-XXXXXX")
    rm -f "$MARKER_FILE"

    WRAPPER_FILE=$(mktemp "/tmp/hermes-wrapper-${i}-XXXXXX.sh")

    # Use CUSTOM_TOOL if set, otherwise use TOOL_COMMAND_INTERACTIVE from config
    if [[ -n "$CUSTOM_TOOL" ]]; then
      VISIBLE_CMD="$CUSTOM_TOOL"
    else
      VISIBLE_CMD="$TOOL_COMMAND_INTERACTIVE"
    fi

    cat > "$WRAPPER_FILE" <<WRAPPER
#!/bin/bash
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  Hermes Phase 3 Iteration"
echo "║  Iteration: ${i} / ${MAX_ITERATIONS}"
echo "║  Close this window or type /exit when done"
echo "╚══════════════════════════════════════════════════╝"
echo ""

export HERMES_CODING_WORKSPACE="${PROJECT_ROOT}"
cd "${PROJECT_ROOT}"

HERMES_PROMPT=\$(cat "${PROMPT_FILE}")
echo "\$HERMES_PROMPT" | ${SHELL:-/bin/bash} -i -c "${VISIBLE_CMD}" 2>&1

touch "${MARKER_FILE}"
rm -f "${PROMPT_FILE}" "${WRAPPER_FILE}"
echo ""
echo "Task finished. This window will close in 5 seconds..."
sleep 5
exit 0
WRAPPER
    chmod +x "$WRAPPER_FILE"

    echo "  Opening visible terminal window for Phase 3 iteration $i"
    echo "  (Watch the tool work in the new window. Close it when done.)"
    osascript -e "tell application \"Terminal\"
      activate
      do script \"clear && ${WRAPPER_FILE}\"
    end tell"

    echo "  Waiting for task to complete..."
    while [[ ! -f "$MARKER_FILE" ]]; do
      sleep 2
    done
    echo "  Iteration $i finished."
    rm -f "$MARKER_FILE"

  else
    # ── Background mode: eval-based dispatch ──
    # CUSTOM_TOOL takes priority over TOOL_COMMAND from config
    # Pipe prompt to stdin for tools like claude --print
    if [[ -n "$CUSTOM_TOOL" ]]; then
      echo "$PROMPT" | eval "$CUSTOM_TOOL" 2>&1 || true
    else
      echo "$PROMPT" | eval "$TOOL_COMMAND" 2>&1 || true
    fi
  fi

  # ── Check for tool-not-found errors ───────────────────────────────
  if [ $? -ne 0 ]; then
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
