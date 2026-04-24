---
name: baseline-fixer
description: Auto-fix failing baseline tests before Phase 3 task execution. Detects test command, runs tests, classifies failures, then fixes one issue at a time with one commit per fix, looping until all tests pass. Used internally by hermes-coding Phase 3.
argument-hint: ""
allowed-tools: [Task, Read, Write, Bash, Grep, Glob]
user-invocable: true
disable-model-invocation: true
---

# Baseline Fixer

Fix failing baseline tests before Phase 3 task execution begins. **One fix per iteration, one commit per fix** — for full traceability.

## Step 0: Detect & Run Baseline

Detect the test command from project config:

```bash
if [ -f package.json ] && jq -e '.scripts.test' package.json >/dev/null 2>&1; then
  TEST_CMD="CI=true npm test"
elif [ -f cli/package.json ] && jq -e '.scripts.test' cli/package.json >/dev/null 2>&1; then
  TEST_CMD="cd cli && CI=true npm test"
elif [ -f pyproject.toml ] || [ -f pytest.ini ]; then
  TEST_CMD="CI=true pytest"
elif [ -f go.mod ]; then
  TEST_CMD="CI=true go test ./..."
else
  echo "ERROR: Could not detect a baseline test command from project config."
  exit 1
fi

echo "Running baseline tests: $TEST_CMD"
TEST_OUTPUT=$(eval "$TEST_CMD" 2>&1)
BASELINE_EXIT=$?
```

- If `BASELINE_EXIT` is 0: all tests passing — exit 0.
- If non-zero: proceed to Step 1.

## Step 1: Classify the Failure

Scan `TEST_OUTPUT` for these patterns:

| Pattern in output | Classification |
|---|---|
| `ECONNREFUSED`, `ENOTFOUND`, `connection refused` | HARD-INFRA |
| Everything else | FIXABLE |

**HARD-INFRA:** Print a diagnostic message explaining what environment setup is needed (e.g., "DB connection refused — start the database service before running the loop"). Log the failure and exit 1.

**FIXABLE:** Proceed to Step 2. This includes missing dependencies, missing env vars, missing config files, missing CLI tools, and all code failures.

## Step 2: Fix-One-Commit-One Loop

Repeat until baseline passes:

### 2.1 Identify One Issue

From the current `TEST_OUTPUT`, identify the **first or root failure**. Focus on fixing only that single issue this iteration.

### 2.2 Spawn Fixer Sub-Agent

```
Tool: Task
Parameters:
  subagent_type: "general-purpose"
  description: "Fix one failing baseline test issue"
  prompt: |
    The project baseline tests are failing. Fix ONE issue only.

    Test command: {TEST_CMD}

    Test output:
    {TEST_OUTPUT}

    The issue to fix: {description of the identified issue}

    Instructions:
    - Fix ONLY this one issue. Do not touch unrelated code.
    - Use CI=true for all test runs.
    - Do not spawn sub-agents.
    - Do not modify task status in hermes-coding.
    - Do not commit — the parent skill handles commits.
    - When done, leave the code in a state where this specific issue is resolved.
  run_in_background: false
```

### 2.3 Re-run Baseline

```bash
eval "$TEST_CMD" > /tmp/baseline-recheck.txt 2>&1
BASELINE_EXIT=$?
TEST_OUTPUT=$(cat /tmp/baseline-recheck.txt)
```

### 2.4 Commit the Fix

```bash
git add -A
git commit -m "fix(baseline): {concise description of what was fixed}"
```

Log via CLI:

```bash
hermes-coding progress append --task "baseline-fix" "Fix attempt N: {description of what was fixed}"
```

### 2.5 Check Result

- If `BASELINE_EXIT` is 0: all tests passing — exit 0.
- If non-zero: loop back to 2.1 with the updated `TEST_OUTPUT`.

## Constraints

- Do not spawn sub-agents from within fixer sub-agents.
- Always use `CI=true` when running tests.
- Do not modify any hermes-coding task status.
- Do not transition project phase.
- HARD-INFRA failures exit immediately — no code edits attempted. All other failures enter the fix loop.
- **One fix per commit.** Never batch multiple unrelated fixes into one commit.
- Each commit message must describe what was fixed — not a generic message.
