<!-- Phase 3 | Tools: Read, Write, Bash, Task, Grep, Glob | Interactive: no -->

# Phase 3: Implementation Orchestrator (One Iteration)

## Goal

Perform exactly **one scheduler iteration** per invocation, then exit. The outer
`hermes-coding loop` starts this file repeatedly. This parent session must not
implement product code directly; it coordinates baseline checks, task selection,
sub-agent implementation, commit-hook regression, and acceptance verification.

The implementer prompt comes from:

```bash
hermes-coding tasks get "$TASK_ID" --prompt
```

That prompt is for the spawned implementer sub-agent, not for this orchestrator.

---

## Step 0: Bootstrap & Verify

```bash
source .claude/skills/hermes-coding/bootstrap-cli.sh

CURRENT_PHASE=$(hermes-coding state get --json 2>/dev/null | jq -r '.data.phase // .phase // "none"')
if [ "$CURRENT_PHASE" != "implement" ]; then
  echo "ERROR: Expected phase 'implement', got '$CURRENT_PHASE'"
  exit 1
fi

hermes-coding status --json
```

Show a short progress summary from `hermes-coding status --json` before doing
any task work.

---

## Step 1: Run Baseline Tests

Spawn the baseline-fixer skill. It detects the test command, runs the suite, and
auto-fixes any failures (one fix per commit). If all tests already pass, it exits 0
immediately.

```
Tool: Task
Parameters:
  subagent_type: "general-purpose"
  description: "Run and fix baseline tests"
  prompt: |
    Read skills/baseline-fixer/SKILL.md and follow the instructions exactly.
  run_in_background: false
```

- If the sub-agent exits 0: baseline is passing, continue to Step 2.
- If the sub-agent exits non-zero: baseline could not be fixed (INFRA issue or unrecoverable). Exit 1 with the message from the sub-agent.

---

## Step 2: Recover Scheduler

Only one task may be active. Recover stale scheduler state before selecting new
work.

```bash
IN_PROGRESS_JSON=$(hermes-coding tasks list --status in_progress --json)
IN_PROGRESS_COUNT=$(echo "$IN_PROGRESS_JSON" | jq -r '.data.tasks | length')

if [ "$IN_PROGRESS_COUNT" -gt 1 ]; then
  KEEP_TASK=$(echo "$IN_PROGRESS_JSON" | jq -r '.data.tasks | sort_by(.startedAt // "") | .[0].id')
  echo "Multiple in-progress tasks found. Keeping $KEEP_TASK and failing extras."
  echo "$IN_PROGRESS_JSON" | jq -r --arg keep "$KEEP_TASK" '.data.tasks[] | select(.id != $keep) | .id' |
    while read -r EXTRA_TASK; do
      [ -n "$EXTRA_TASK" ] || continue
      hermes-coding tasks fail "$EXTRA_TASK" --reason "Scheduler recovery: multiple in_progress tasks; keeping $KEEP_TASK"
    done
  TASK_ID="$KEEP_TASK"
elif [ "$IN_PROGRESS_COUNT" -eq 1 ]; then
  TASK_ID=$(echo "$IN_PROGRESS_JSON" | jq -r '.data.tasks[0].id')
  echo "Resuming in-progress task: $TASK_ID"
else
  TASK_ID=""
fi
```

If one task is already `in_progress`, resume it and skip `tasks next`.

---

## Step 3: Select One Task

If Step 2 did not find an active task, select exactly one ready task:

```bash
if [ -z "$TASK_ID" ]; then
  NEXT_JSON=$(hermes-coding tasks next --json)
  RESULT=$(echo "$NEXT_JSON" | jq -r '.data.result // "unknown"')

  case "$RESULT" in
    all_done)
      echo "All tasks resolved. Outer loop will transition to deliver."
      exit 0
      ;;
    blocked)
      echo "Remaining tasks are blocked by dependencies."
      exit 1
      ;;
    task_found)
      TASK_ID=$(echo "$NEXT_JSON" | jq -r '.data.task.id')
      hermes-coding tasks start "$TASK_ID"
      ;;
    *)
      echo "ERROR: Unexpected tasks next result: $RESULT"
      exit 1
      ;;
  esac
fi

TASK_JSON=$(hermes-coding tasks get "$TASK_ID" --json)
MODULE=$(echo "$TASK_JSON" | jq -r '.module // .data.module // "default"')
echo "Selected task: $TASK_ID (module: $MODULE)"
```

---

## Step 4: Inner Implementation Loop

The inner loop has no fixed retry limit. Continue until the task is terminal,
committed with passing hook checks, and verified against acceptance criteria; or
until a sub-agent marks it failed.

The Step 4/5 orchestration loop has only two intended terminal outcomes:
- the task is verified, then marked `complete`
- a sub-agent explicitly marks the task `failed`

`timeout`, `interrupted`, `no final result`, `commit hook failed`, and
`NOT VERIFIED` all stay inside the loop. They are retry conditions, not exit
conditions.

### 4.1 Spawn Implementer

```bash
IMPLEMENTER_PROMPT=$(hermes-coding tasks get "$TASK_ID" --prompt)
```

Spawn a fresh sub-agent:

```
Tool: Task
Parameters:
  subagent_type: "general-purpose"
  description: "Implement task: {TASK_ID}"
  prompt: "{IMPLEMENTER_PROMPT}"
  run_in_background: false
```

The implementer must follow the prompt exactly:
- Write failing tests first.
- Implement only this task.
- Use `CI=true` for tests.
- Write learnings with `hermes-coding progress append --task {TASK_ID} "..."`
- Leave the task `in_progress` when implementation is ready for parent-side commit and verification.
- Call `hermes-coding tasks fail {TASK_ID} --reason "..."` only if the task is genuinely blocked or impossible.
- Do not spawn sub-agents.

### 4.2 Check Sub-Agent Result

After the sub-agent run finishes, first determine whether the Task tool produced
a normal final result.

- If the run ended with `timeout`, `interrupted`, or `no final result`, do
  **not** read a leftover `in_progress` status as "implementation ready". Do
  **not** go to 4.3. Do **not** go to Step 5. Instead, spawn a fresh
  implementer/fixer sub-agent that continues from the current repo state and
  existing task progress, then return to 4.1.

- Only if the sub-agent returned normally should the parent inspect
  `TASK_STATUS`:

```bash
TASK_STATUS=$(hermes-coding tasks get "$TASK_ID" --json | jq -r '.status // .data.status // "unknown"')
```

- `in_progress` This means only that the task is not yet in a
  terminal state; it does **not** mean the implementation is definitely ready
  or that all acceptance criteria are satisfied.
- `completed` → ERROR: implementer must not complete the task; exit 1
- `unknown` → ERROR: unexpected status; exit 1
- `failed` → spawn the progress promoter below, then exit 1

If status is `failed`, spawn a progress promoter before exiting. Failed tasks
often contain the most valuable signal (falsified paths, hidden constraints).

```
Tool: Task
Parameters:
  subagent_type: "general-purpose"
  description: "Promote learnings for failed task: {TASK_ID}"
  prompt: |
    Read .claude/skills/hermes-coding/promote-progress.md and follow the instructions.
    TASK_ID: {TASK_ID} | MODULE: {MODULE}
  run_in_background: false
```

Then exit 1.

### 4.3 Commit With Regression Hook

Commit all changes from this task. The git commit hook is responsible for full
regression testing.

```bash
git add -A
if git diff --cached --quiet; then
  echo "No code changes to commit for task $TASK_ID."
else
  if git commit -m "feat(${MODULE}): complete task ${TASK_ID}

Implemented by hermes-coding Phase 3 loop.
Task: ${TASK_ID} | Module: ${MODULE}"; then
    echo "Committed task $TASK_ID."
  else
    echo "Commit hook failed. Spawning fixer sub-agent and retrying."
  fi
fi
```

`No code changes to commit` only means there is no committable diff right now.
It does **not** mean the task is complete. Still continue to Step 5 for
verification.

If `git commit` fails, spawn a fresh fixer sub-agent and loop back to 4.1:

```
Tool: Task
Parameters:
  subagent_type: "general-purpose"
  description: "Fix regression for task: {TASK_ID}"
  prompt: |
    The commit hook failed after implementing {TASK_ID}.
    Fix the regression without changing task scope.
    Use CI=true for all tests.
    Re-check the task spec with:
      hermes-coding tasks get {TASK_ID} --prompt
    Leave the task in_progress unless you must fail it with a clear reason.
    Do not spawn sub-agents.
  run_in_background: false
```

Then retry `git add -A && git commit`.

---

## Step 5: Verify & Complete

After a successful commit (or if there were no changes to commit), spawn a
verification sub-agent:

```
Tool: Task
Parameters:
  subagent_type: "general-purpose"
  description: "Verify task acceptance criteria: {TASK_ID}"
  prompt: |
    Verify task {TASK_ID} against its task file and current code.

    Required checks:
    - Read the task file via `hermes-coding tasks get {TASK_ID} --prompt`.
    - Inspect implementation and tests.
    - Run focused tests with CI=true when appropriate.
    - Report whether every acceptance criterion is met.

    Output one of:
    - VERIFIED: all acceptance criteria are met
    - NOT VERIFIED: list missing criteria and required fixes

    Do not modify task status unless you are certain the task is impossible.
    Do not spawn sub-agents.
  run_in_background: false
```

If the verifier reports **NOT VERIFIED**, or if the previous normal-return
attempt produced no committable changes and the verifier still cannot confirm
the acceptance criteria, spawn an implementer/fixer sub-agent with the missing
criteria and return to Step 4. The verifier output is the source of truth for
what remains.

If the verifier reports **VERIFIED**:

```bash
hermes-coding tasks complete "$TASK_ID"
```

Then spawn a progress promoter to carry learnings into the project progress file:

```
Tool: Task
Parameters:
  subagent_type: "general-purpose"
  description: "Promote learnings for completed task: {TASK_ID}"
  prompt: |
    Read .claude/skills/hermes-coding/promote-progress.md and follow the instructions.
    TASK_ID: {TASK_ID} | MODULE: {MODULE}
  run_in_background: false
```

```bash
echo "Task $TASK_ID verified and complete."
exit 0
```

The outer loop will start the next scheduler iteration.

---

## Constraints

- **NEVER** implement tasks in the parent session. Always spawn a sub-agent.
- **NEVER** select more than one task per invocation.
- **ALWAYS** use `CI=true` when running tests.
- **ALWAYS** write progress learnings via CLI.
- **ALWAYS** mark the selected task as completed or failed before exiting.
- **DO NOT** spawn sub-agents from implementer/fixer/verifier sub-agents.
- **DO NOT** transition the project phase here; the outer loop handles deliver transition.
- **NEVER** trigger commit, verification, completion, or any other terminal path
  after a sub-agent `timeout`, `interrupted`, or `no final result`. Restart the
  implementation loop instead.
- **DO NOT** treat `in_progress` as sufficient evidence that a task is ready for
  commit. Only a normal sub-agent return followed by successful verification can
  lead to completion.
