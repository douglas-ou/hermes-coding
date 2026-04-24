---
name: hermes-coding
description: Start a structured development session from a requirement. Use when user says "build X for me", "develop a feature", "implement X end-to-end", "start a new project", or wants guided requirement-to-PR delivery. Also handles resume, status, and cancel for in-progress sessions.
argument-hint: "<requirement>" [--mode=resume|status|cancel]
allowed-tools: [Task, Read, Write, Bash, AskUserQuestion, Grep, Glob]
user-invocable: true
---

# hermes-coding Orchestrator

## Goal

Transform a user requirement into a validated hermes-coding workflow state, then hand implement execution off to `hermes-coding loop` in a real terminal.

## Workflow Phases

```
1. CLARIFY    → Questions & PRD (interactive)
2. BREAKDOWN  → Atomic tasks (autonomous)
3. IMPLEMENT  → External terminal handoff to `hermes-coding loop`
4. DELIVER    → Verify + commit + PR (autonomous)
```

## Phase Files (Progressive Disclosure)

Each phase has detailed instructions in a co-located file — read only when that phase is active:

| Phase | File | Interactive |
|-------|------|-------------|
| 1. Clarify | [phase-1-clarify.md](phase-1-clarify.md) | Yes |
| 2. Breakdown | [phase-2-breakdown.md](phase-2-breakdown.md) | Yes (approval) |
| 3. Implement | [phase-3-implement.md](phase-3-implement.md) | Terminal handoff |
| 4. Deliver | [phase-4-deliver.md](phase-4-deliver.md) | Optional |

Shared bootstrap: [bootstrap-cli.sh](bootstrap-cli.sh)

## State Management

All state persists in `.hermes-coding/`:
- `state.json` - Current phase, progress (managed by CLI)
- `prd.md` - Product requirements document
- `context/` - Extracted context files (user-intent, decisions, plans, etc.)
- `drafts/` - Phase 2 draft files (task markdown before CLI persistence)
  - `drafts/tasks/` - Task drafts awaiting `hermes-coding tasks create --content-file`
- `tasks/` - Task files with index.json (managed by CLI — Phase 2 MUST NOT write directly)

---

## Execution

### Step 0: Bootstrap CLI

```bash
hermes-coding --version 2>/dev/null || source .claude/skills/hermes-coding/bootstrap-cli.sh
```

### Initialize

```bash
# Parse mode from arguments
MODE="new"  # or "resume", "status", "cancel"

case "$MODE" in
  resume)
    # Load existing state
    PHASE=$(hermes-coding state get --json | jq -r '.data.phase // .phase // "none"')
    ;;
  new)
    # Archive existing session if present
    hermes-coding state archive --force --json 2>/dev/null
    hermes-coding state set --phase clarify
    hermes-coding detect --save  # Detect language config
    PHASE="clarify"
    ;;
esac
```

### Main Loop (Context-Compression Resilient)

```bash
while true; do
  # Always re-query phase from CLI (context-compression safe)
  PHASE=$(hermes-coding state get --json | jq -r '.data.phase // .phase // "none"')

  case "$PHASE" in
    clarify)   dispatch_phase "phase-1-clarify.md"   ;;
    breakdown) dispatch_phase "phase-2-breakdown.md" ;;
    implement)
      echo ""
      echo "Implement is ready."
      echo "Open a terminal in this workspace and run:"
      echo "  hermes-coding loop"
      echo ""
      echo "After implement reaches deliver, resume this workflow to continue."
      break
      ;;
    deliver)   dispatch_phase "phase-4-deliver.md"   ;;
    complete)  echo "All phases complete!"; break ;;
    *)         echo "Unknown phase: $PHASE"; exit 1 ;;
  esac
done
```

### Phase Dispatch

To execute a phase:

1. **Read** the phase file from `.claude/skills/hermes-coding/` (e.g., `.claude/skills/hermes-coding/phase-1-clarify.md`)
2. **Spawn** a fresh Agent with the phase content as prompt:

```
Tool: Agent (or Task)
Parameters:
  subagent_type: "general-purpose"
  description: "Execute {phase-name} phase"
  prompt: |
    {content of phase file}

    ---
    ## Context
    - Workspace: {current working directory}
    - Bootstrap: hermes-coding --version 2>/dev/null || source .claude/skills/hermes-coding/bootstrap-cli.sh
    - {any phase-specific context from conversation}
  run_in_background: false
```

Each phase subagent gets a **fresh context window** with only its own instructions — preserving token efficiency and context isolation.

---

## Phase Summary

| Phase | Key Output |
|-------|------------|
| 1. Clarify | `.hermes-coding/prd.md` + `context/decisions.md` |
| 2. Breakdown | `.hermes-coding/tasks/` (with type, dependencies, Environment Context, TEST lines) |
| 3. Implement | Code + unit tests + E2E tests + `.hermes-coding/e2e-evidence/` screenshots |
| 4. Deliver | Commit + PR (quality gates include E2E + evidence review) |

**Implement handoff:**
- The Claude Code session does not keep driving Phase 3 once state reaches `implement`
- The supported implement entrypoint is `hermes-coding loop`, run by the user in a real terminal at the workspace root
- `hermes-coding loop` checks task status via `tasks next` to decide continuation

---

## Mode Commands

| Command | Action |
|---------|--------|
| `/hermes-coding {requirement}` | Start new session |
| `/hermes-coding resume` | Continue from saved state |
| `/hermes-coding status` | Show current progress |
| `/hermes-coding cancel` | Archive and clear session |

---

## State Transitions

```
clarify → breakdown → implement → deliver → complete
```

- Each phase updates state via `hermes-coding state update --phase {next}`
- Healing is embedded within the implement phase (spawned as sub-agent, not a state transition)
- Phases can only move forward

---

## Safety Limits

| Limit | Value | Purpose |
|-------|-------|---------|
| Orchestrator timeout | 12 hours | Prevent infinite loops |
| Per-phase timeout | Varies | Defined in each phase file |
| Heal attempts | 3 per task | Circuit breaker (embedded in Phase 3) |

---

## Constraints

- **NEVER** skip phases (must complete in order)
- **NEVER** rely on memory variables (always query CLI)
- **ALWAYS** get user approval before implement phase
- **ALWAYS** save state after each phase completion
- **ALWAYS** show progress updates during long operations
- **HANDOFF**: When phase becomes `implement`, stop in-session automation and instruct the user to run `hermes-coding loop` in a terminal
- **CONTEXT-AWARE CLARIFY**: The clarify phase extracts context from the full conversation history — discussions about UI layouts, data models, or design decisions before invoking `/hermes-coding` are automatically preserved in the PRD

---

## Error Handling

| Error | Action |
|-------|--------|
| Phase fails | Log error, show diagnostics, don't auto-retry |
| User cancels | Save state, show resume command |
| Interrupted | State persists, resume on next session |
| Unknown phase | Report error, suggest manual state reset |

---

## Resume Behavior

When resuming from each phase:

| Phase | Resume Action |
|-------|---------------|
| clarify | Continue with remaining questions |
| breakdown | Show plan again for approval |
| implement | Remind user to continue in terminal with `hermes-coding loop` |
| deliver | Re-run delivery checks |
