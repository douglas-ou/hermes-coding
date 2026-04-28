<!-- Phase 4 | Tools: Read, Write, Bash, Grep, Glob | Interactive: optional -->

# Phase 4: Deliver

## Goal

Run quality gates, perform two-stage code review, create commit, and optionally create pull request.

## Input

- Completed tasks from Phase 3
- Task directory: `.hermes-coding/tasks/`
- Implementation files: All modified/created files
- E2E evidence: `.hermes-coding/e2e-evidence/` (screenshots from E2E tasks, if any)
- E2E smoke results: `.hermes-coding/e2e-smoke-results.txt` (from Phase 3 Step 4.5, if any)

---

## Workflow

### Step 0: Initialize CLI (Automatic)

**IMPORTANT:** This skill requires the hermes-coding CLI. It will build automatically on first use.

```bash
# Bootstrap CLI — always source so auto-update can run
source .claude/skills/hermes-coding/bootstrap-cli.sh

# Verify CLI is ready
hermes-coding --version

# Context-compression resilience: Verify current phase and task progress
CURRENT_PHASE=$(hermes-coding state get --json 2>/dev/null | jq -r '.phase // "none"')
TASKS_JSON=$(hermes-coding tasks list --json 2>/dev/null)
TOTAL=$(echo "$TASKS_JSON" | jq -r '.data.total // 0')
COMPLETED=$(echo "$TASKS_JSON" | jq -r '.data.completed // 0')
FAILED=$(echo "$TASKS_JSON" | jq -r '.data.failed // 0')
echo "Current phase: $CURRENT_PHASE | Tasks: $COMPLETED/$TOTAL completed, $FAILED failed"
# Expected: deliver
```

### Step 1: Gather Summary

```bash
# Query task stats (context-compression safe)
COMPLETED=$(hermes-coding tasks list --status completed --json | jq -r '.data.total')
TOTAL=$(hermes-coding tasks list --json | jq -r '.data.total')
echo "Tasks completed: $COMPLETED/$TOTAL"
```

### Step 2: Run Quality Gates

**CRITICAL:** All gates must pass before delivery.

```bash
# Get verification commands from language config
VERIFY_CMDS=$(hermes-coding detect --json | jq -r '.data.languageConfig.verifyCommands[]?')

# Run each command with CI=true
while IFS= read -r cmd; do
  [ -z "$cmd" ] && continue
  echo "Running: $cmd"
  CI=true eval "$cmd"
  [ $? -ne 0 ] && { echo "GATE FAILED: $cmd"; exit 1; }
done <<< "$VERIFY_CMDS"
```

**Standard Quality Gates:**
- Type checking (e.g., `npx tsc --noEmit`)
- Linting (e.g., `npm run lint`)
- Unit/Integration tests (e.g., `CI=true npm test`)
- Build (e.g., `npm run build`)
- E2E tests (if E2E tasks exist):
  ```bash
  # Start services and dev server
  docker-compose up -d 2>/dev/null
  npm run dev &
  DEV_PID=$!
  for i in $(seq 1 30); do curl -s http://localhost:3000 > /dev/null 2>&1 && break; sleep 1; done

  # Run Playwright E2E tests
  CI=true npx playwright test --reporter=list
  E2E_EXIT=$?

  # Teardown
  kill $DEV_PID 2>/dev/null
  docker-compose down 2>/dev/null

  [ $E2E_EXIT -ne 0 ] && { echo "E2E GATE FAILED"; exit 1; }
  ```

### Step 3: Two-Stage Code Review

**Stage 1: Spec Compliance** (Blocking)
- Does implementation satisfy all acceptance criteria?
- Are all required tests present (unit + integration + E2E where applicable)?
- No requirements missed?
- If E2E tasks exist: verify `.hermes-coding/e2e-evidence/` contains screenshots for all defined checkpoints

**Stage 2: Code Quality** (Advisory)
- Files not too large (>500 lines → suggest splitting)
- No debug code left (console.log, TODO, FIXME)
- No excessive commented code
- Best practices followed

**Stage 3: E2E Evidence Review** (If E2E tasks exist)
- All screenshot checkpoints captured in `.hermes-coding/e2e-evidence/`
- Screenshots show expected UI state (not error pages or blank screens)
- Both desktop and mobile viewports captured (if required by tasks)
- E2E smoke test results in `.hermes-coding/e2e-smoke-results.txt` show all passed

### Step 4: Create Git Commit

```bash
# Stage changes
git add .

# Generate commit message based on completed tasks
# Format: feat(modules): description

git commit -m "$(cat <<EOF
feat({modules}): implement {N} tasks

Tasks completed:
{task list}

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
EOF
)"

COMMIT_SHA=$(git rev-parse --short HEAD)
```

### Step 5: Create Pull Request (Optional)

If `gh` CLI available and on feature branch:

```bash
# Push branch
git push -u origin $(git branch --show-current)

# Create PR
gh pr create \
  --title "{PR title}" \
  --body "{PR body with summary, tasks, quality gates}"
```

### Step 6: Cleanup (Optional)

Ask user about cleaning up temporary files:
- Remove: `state.json`, `debug.log`
- Keep: `prd.md`, `tasks/`, `progress.txt` (cross-task learnings — valuable for future sessions)

### Step 7: Update State & Return Result

```bash
hermes-coding state update --phase complete
```

**REQUIRED Output Format:**
```yaml
---PHASE RESULT---
phase: deliver
status: complete
tasks_delivered: {N}
commit_sha: {sha}
pr_url: {url or null}
quality_gates:
  typecheck: passed
  lint: passed
  tests: passed
  build: passed
  e2e: passed | skipped
code_review:
  spec_compliance: passed
  code_quality: passed | passed_with_suggestions
  e2e_evidence: verified | skipped
e2e_evidence_dir: .hermes-coding/e2e-evidence
next_phase: null
---END PHASE RESULT---
```

---

## Quality Gate Rules

| Gate | Blocking | Retry |
|------|----------|-------|
| Type checking | Yes | Fix errors, re-run |
| Linting | Yes | Fix errors, re-run |
| Unit/Integration tests | Yes | Fix failures, re-run |
| Build | Yes | Fix errors, re-run |
| E2E tests | Yes (if E2E tasks exist) | Fix scenarios, re-run Playwright |
| Spec compliance | Yes | Implementation incomplete |
| E2E evidence review | Yes (if E2E tasks exist) | Missing screenshots = incomplete |
| Code quality | No | Suggestions only |

---

## Constraints

- **NEVER** commit if any blocking gate fails
- **NEVER** push without user awareness (PR creation is explicit)
- **ALWAYS** use `CI=true` when running verification commands
- **ALWAYS** include `Co-Authored-By` in commit message
- **ALWAYS** show full gate output as evidence
- **ALWAYS** return structured PHASE RESULT block

---

## Error Handling

| Error | Action |
|-------|--------|
| Quality gate fails | Stop delivery, report failure, don't commit |
| Spec compliance issues | Report issues, don't commit |
| Commit fails | Abort delivery, report error |
| PR creation fails | Continue (manual PR fallback) |
| gh CLI not found | Skip PR, show manual instructions |
