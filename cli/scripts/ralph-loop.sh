#!/usr/bin/env bash
#
# hermes-coding: Phase 3 outer loop controller.
# Iterates through tasks, spawning a fresh Claude/amp process per task.
#
# Run from project root: hermes-coding loop
# Internal: cli/scripts/ralph-loop.sh [--tool claude|amp] [max_iterations]
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
USER_MAX_ITERATIONS=""
VISIBLE=0
CUSTOM_TOOL=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --tool)     TOOL="$2"; shift 2 ;;
    --tool=*)   TOOL="${1#*=}"; shift ;;
    --custom)   CUSTOM_TOOL="$2"; shift 2 ;;
    --custom=*) CUSTOM_TOOL="${1#*=}"; shift ;;
    --visible)  VISIBLE=1; shift ;;
    *)
      if [[ "$1" =~ ^[0-9]+$ ]]; then
        USER_MAX_ITERATIONS="$1"
      fi
      shift
      ;;
  esac
done

if [[ -z "$CUSTOM_TOOL" && "$TOOL" != "amp" && "$TOOL" != "claude" ]]; then
  echo "Error: Invalid tool '$TOOL'. Must be 'amp' or 'claude'." >&2
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

  # Invoke AI tool
  if [[ -n "$CUSTOM_TOOL" && "$VISIBLE" -eq 0 ]]; then
    USER_SHELL="${SHELL:-/bin/bash}"
    echo "$PROMPT" | "$USER_SHELL" -i -c "$CUSTOM_TOOL" 2>&1 || true
  elif [[ -n "$CUSTOM_TOOL" && "$VISIBLE" -eq 1 && "$(uname)" == "Darwin" ]]; then
    PROMPT_FILE=$(mktemp "/tmp/hermes-prompt-${i}-XXXXXX")
    echo "$PROMPT" > "$PROMPT_FILE"

    MARKER_FILE=$(mktemp "/tmp/hermes-marker-${i}-XXXXXX")
    rm -f "$MARKER_FILE"

    WRAPPER_FILE=$(mktemp "/tmp/hermes-wrapper-${i}-XXXXXX.sh")
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
echo "\$HERMES_PROMPT" | "${SHELL:-/bin/bash}" -i -c "${CUSTOM_TOOL}" 2>&1

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

  elif [[ "$VISIBLE" -eq 1 && "$(uname)" == "Darwin" ]]; then
    # ── Visible mode: interactive TUI in a new Terminal.app window ──
    #
    # Key difference from background mode:
    #   - NO --print flag → full interactive TUI (tool calls, spinners, etc.)
    #   - Prompt passed as positional arg (not piped via stdin)
    #   - User watches Claude work, then closes window or types /exit when done
    #   - Main loop waits for the window to close via marker file
    #
    PROMPT_FILE=$(mktemp "/tmp/hermes-prompt-${i}-XXXXXX")
    echo "$PROMPT" > "$PROMPT_FILE"

    MARKER_FILE=$(mktemp "/tmp/hermes-marker-${i}-XXXXXX")
    rm -f "$MARKER_FILE"

    WRAPPER_FILE=$(mktemp "/tmp/hermes-wrapper-${i}-XXXXXX.sh")
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

# Read prompt from file to avoid shell escaping issues
HERMES_PROMPT=\$(cat "${PROMPT_FILE}")

if [[ "${TOOL}" == "amp" ]]; then
  echo "\$HERMES_PROMPT" | amp --dangerously-allow-all 2>&1
else
  # Interactive mode — full TUI, no --print
  claude --dangerously-skip-permissions "\$HERMES_PROMPT"
fi

# Signal completion to the main loop
touch "${MARKER_FILE}"

# Cleanup and close
rm -f "${PROMPT_FILE}" "${WRAPPER_FILE}"
echo ""
echo "Task finished. This window will close in 5 seconds..."
sleep 5
exit 0
WRAPPER
    chmod +x "$WRAPPER_FILE"

    echo "  Opening visible terminal window for Phase 3 iteration $i"
    echo "  (Watch Claude work in the new window. Close it when done.)"
    osascript -e "tell application \"Terminal\"
      activate
      do script \"clear && ${WRAPPER_FILE}\"
    end tell"

    # Wait for Claude to finish (marker file created when user closes window)
    echo "  Waiting for task to complete..."
    while [[ ! -f "$MARKER_FILE" ]]; do
      sleep 2
    done
    echo "  Iteration $i finished."

    # Cleanup (marker only; wrapper cleans its own files)
    rm -f "$MARKER_FILE"

  elif [[ "$TOOL" == "amp" ]]; then
    echo "$PROMPT" | amp --dangerously-allow-all 2>&1 || true
  else
    echo "$PROMPT" | claude --dangerously-skip-permissions --print --verbose \
      2>&1 || true
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
