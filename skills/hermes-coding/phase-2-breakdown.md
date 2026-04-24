<!-- Phase 2 | Tools: Read, Write, Bash, AskUserQuestion | Interactive: yes (approval) -->

# Phase 2: Task Breakdown

## Goal

Break down the PRD into atomic, testable tasks (each <30 minutes), create task files via CLI, and get user approval before implementation. Every task must contain concrete TEST lines that an implementer can directly convert into `it('should...')` test blocks.

## Input

- PRD file: `.hermes-coding/prd.md`
- Design specs: `requirements-design/**/*.md`, `docs/design/**`, `*.spec.md`, `*.design.md`
- Technical decisions: `.hermes-coding/context/decisions.md` (if exists)
- Language config from CLI (if available)

---

## Workflow

### Step 0: Initialize CLI (Automatic)

**IMPORTANT:** This skill requires the hermes-coding CLI. It will build automatically on first use.

```bash
# Bootstrap CLI — verify or source from skill directory
hermes-coding --version 2>/dev/null || source .claude/skills/hermes-coding/bootstrap-cli.sh

# Verify CLI is ready
hermes-coding --version

# Context-compression resilience: Verify current phase
CURRENT_PHASE=$(hermes-coding state get --json 2>/dev/null | jq -r '.phase // "none"')
echo "Current phase: $CURRENT_PHASE"
# Expected: breakdown
```

### Step 1: Verify Prerequisites

```bash
# Verify PRD exists
[ -f ".hermes-coding/prd.md" ] || { echo "ERROR: PRD not found"; exit 1; }
```

### Step 2: Read and Analyze PRD

Read `.hermes-coding/prd.md` and extract:
- User stories from each Epic
- Technical requirements
- Architecture components
- **All API endpoints** (method + path + request/response shapes)
- **All page routes** (path + components)
- **All data model entities** (fields + relationships)
- **All user flows** (multi-step sequences)
- **Technical decisions** from Section 9.1 (test strategy, DB isolation, visual testing, CI constraints)

Keep a checklist of these items — it will be used for coverage verification in Step 4.5.

#### Step 2.1: Discover Additional Spec Files

**Do NOT rely solely on prd.md.** Scan the project for design and requirements documents:

```bash
# Discover spec files (check each pattern)
find . -path './.hermes-coding' -prune -o -path './node_modules' -prune -o \
  \( -path '*/requirements-design/*.md' -o -path '*/docs/design/*.md' \
     -o -name '*.spec.md' -o -name '*.design.md' \
     -o -name 'DESIGN.md' -o -name 'UI_UX_DESIGN_SPEC.md' \
     -o -name 'design.md' \) -print
```

For each discovered spec, extract and add to the coverage checklist:
- **Responsive breakpoints** (e.g., mobile/tablet/desktop definitions)
- **Accessibility requirements** (WCAG level, contrast ratios, keyboard navigation)
- **Visual design tokens** (colors, typography, spacing scales)
- **Component inventory** (named components with their states)
- **Performance targets** (LCP, FID, CLS, API latency budgets)

These become additional items in the Step 4.5 PRD coverage checklist alongside PRD-derived items.

#### Step 2.5: Infrastructure Context Scan

Read project configuration files to understand the existing environment. Generate an `ENVIRONMENT_CONTEXT` block that will be injected into relevant tasks.

```bash
# Scan for infrastructure files
for f in docker-compose.yml docker-compose.yaml .env .env.example \
         package.json prisma/schema.prisma tsconfig.json next.config.js \
         next.config.ts vite.config.ts; do
  [ -f "$f" ] && echo "FOUND: $f"
done
```

**Extract from each file (if found):**

| File | Extract |
|------|---------|
| `docker-compose.yml` | DB host, port, credentials, service names |
| `.env` / `.env.example` | Service URLs, API key names (**REDACT values**, keep key names only) |
| `package.json` | Existing dependencies + versions, npm scripts |
| `prisma/schema.prisma` | Current data models, relations |
| `tsconfig.json` / `next.config.js` | Build config, path aliases, output directory |

**Generate ENVIRONMENT_CONTEXT block:**

```markdown
## Environment Context
- DB: {engine} on {host}:{port} ({source}), DB name: {name}
- Test DB: {strategy from decisions.md, e.g., separate _test database}
- Object Storage: {provider} (credentials in .env: {KEY_NAMES})
- Test strategy: {mock | real + sandbox | mixed} (from PRD Section 9.1)
- Existing deps: {key packages with versions}
- Build: {framework} with {config highlights}
```

This block will be injected into the `## Environment Context` section of each relevant task file.

### Step 3: Classify and Create Atomic Tasks

**Before creating each task, classify it** as one of three types and apply the corresponding template:

#### Task Classification

| Type | Identification | Required Sections |
|------|---------------|-------------------|
| **API Route** | Involves HTTP endpoint, REST/GraphQL handler | API Contract + Error Codes + Auth matrix |
| **UI Component** | Involves frontend rendering, user interaction | State matrix (empty/loading/normal/error) + responsive breakpoints + accessibility |
| **Domain Logic** | Pure logic, validation, transformation, pipeline | Boundary Matrix + edge case table + input/output types |
| **E2E Scenario** | Verifies a complete user journey across multiple pages/APIs | Scenario Steps + Server Setup + Browser Config + Screenshot Checkpoints |

#### Task Breakdown Rules

- Each task completable within time estimates (see Time Estimation Guide below)
- **Each acceptance criterion must decompose into 3-10 `- TEST:` lines** (see TEST Line Format below)
- Tasks follow dependency order
- Group related tasks into modules
- If a task requires >5 different error handling paths, split it
- If a task touches >3 files, consider splitting it

**Task Naming Convention:** `{module}.{feature}.{aspect}`
- Example: `auth.signup.ui`, `auth.signup.api`, `auth.signup.tests`

#### Time Estimation Guide

| Complexity | Time Range | Examples |
|-----------|-----------|---------|
| Pure UI component (no API) | 15-20 min | Static form, display component |
| Single API route + basic logic | 20-25 min | GET endpoint, simple CRUD |
| API route + validation + error handling + auth | 30-45 min → **split into 2 tasks** | Authenticated upload with validation |
| Multi-step pipeline (upload → process → deploy) | 45-90 min → **split into 3+ tasks** | File processing workflow |
| E2E test scenario suite | 20-30 min | Happy path + error path tests |

#### Dependency Rules

- Only declare **DIRECT** dependencies (not transitive)
- If A depends on B and B depends on C, task A should NOT list C
- API tasks depend on their data model task, not on the testing setup
- UI tasks depend on their data-fetching API task
- E2E tasks depend on all tasks in the user journey they cover
- Foundation tasks (testing setup, shared infra) are implicit dependencies — do not list them unless the task directly extends them

### Step 3.5: TEST Line Coverage Self-Validation

**Before persisting each task draft via CLI**, validate its TEST lines against the Edge Case Enumeration Checklist. For each task, verify:

#### API Route Tasks — Must Have:
- [ ] At least 1 happy path TEST
- [ ] At least 1 missing-required-field TEST (per required field)
- [ ] At least 1 boundary value TEST (empty, max length, zero)
- [ ] At least 1 auth failure TEST (no token / expired / wrong role)
- [ ] At least 1 not-found TEST (if resource operations)
- [ ] Error codes table filled with all error paths

#### UI Component Tasks — Must Have:
- [ ] At least 1 TEST per state in the State Matrix (empty/loading/normal/error)
- [ ] At least 1 user interaction TEST (click/keyboard/hover)
- [ ] At least 1 form validation TEST (if form present)
- [ ] At least 1 responsive breakpoint TEST (if design spec defines breakpoints)
- [ ] Accessibility section filled (keyboard nav + screen reader)

#### Domain Logic Tasks — Must Have:
- [ ] At least 1 happy path TEST
- [ ] At least 1 empty/null/undefined input TEST
- [ ] At least 1 boundary value TEST (min/max/edge of range)
- [ ] At least 1 invalid format/type TEST
- [ ] Boundary Matrix filled with all value boundaries

#### E2E Scenario Tasks — Must Have:
- [ ] At least 1 happy-path scenario covering the full user journey
- [ ] At least 1 auth boundary TEST (unauthenticated access attempt)
- [ ] At least 1 error recovery TEST (server error → user sees error UI → retry works)
- [ ] At least 1 screenshot checkpoint per critical state transition
- [ ] Server Setup section filled (start command, ready signal, teardown)
- [ ] Browser Config section filled (viewport, auth state, test data)

**If any checkbox is unchecked, add the missing TEST lines before creating the task.**

This is a self-check, not a user-facing step. It ensures no task goes into the system with incomplete edge case coverage.

### Step 4: Draft Tasks for Review

**CRITICAL:** Phase 2 SHALL NOT write directly into `.hermes-coding/tasks/**/*.md`. Task persistence happens ONLY through the CLI after user approval.

**Single-Writer Semantics:** The CLI owns `.hermes-coding/tasks/`. Phase 2 authors rich task content as draft files under `.hermes-coding/drafts/tasks/`, presents those drafts for approval, then persists each approved draft into the managed task store via `hermes-coding tasks create --content-file <path>`.

**Workflow:**

1. **Draft** the complete markdown file (with YAML frontmatter + body) into `.hermes-coding/drafts/tasks/<task-id>.md`
2. **Validate** drafts locally for required metadata, TEST lines, dependencies, and PRD coverage
3. **Ask for approval** before persisting into `.hermes-coding/tasks/`

```bash
# Initialize tasks
hermes-coding tasks init --project-goal "..." --language "..."

# For each task:
# Draft the complete task markdown file only
mkdir -p .hermes-coding/drafts/tasks
# Write the full task content (frontmatter + body) to a draft file
# Example draft path: .hermes-coding/drafts/tasks/auth.login.ui.md
```

Draft files remain editable until approval. Do not call `hermes-coding tasks create --content-file` before the user approves the task plan, because `tasks create` is create-only and cannot overwrite already persisted task IDs.

### Step 4.5: PRD Coverage Verification

**MANDATORY.** Cross-check all tasks against the PRD checklist from Step 2:

1. **API endpoints**: For each endpoint in PRD → verify at least one task covers it
2. **Page routes**: For each page/route in PRD → verify at least one task covers it
3. **Data model entities**: For each entity in PRD → verify a data-model task references it
4. **User flows**: For each multi-step user flow in PRD → verify an e2e task covers the full path
5. **Non-functional requirements**: For each constraint (rate limits, auth, size limits) → verify a task tests it

**Output a coverage table:**

```markdown
## PRD Coverage Check

| PRD Item | Type | Covered By Task | Status |
|----------|------|----------------|--------|
| POST /api/sites | API | sites.create.api | ✅ |
| Dashboard page | Route | dashboard.overview.ui | ✅ |
| Site entity | Model | sites.model.setup | ✅ |
| Create → Deploy flow | Flow | deploy.e2e.tests | ✅ |
| {uncovered item} | ... | — | ❌ MISSING |
```

**If any PRD item shows ❌ MISSING:**
- Create additional tasks to cover it, OR
- Justify exclusion with a concrete reason (e.g., "deferred to v2 per PRD scope")

**Do NOT proceed to Step 4.7 until all PRD items are covered or explicitly excluded.**

### Step 4.7: Cross-Cutting Concerns Audit

**After module-level tasks are generated**, check for missing cross-cutting tasks. Only generate tasks for concerns that are **explicitly specified** in the PRD, design specs (from Step 2.1), or technical decisions:

| Concern | Trigger Condition | Task Type |
|---------|------------------|-----------|
| Responsive/Mobile support | Design spec defines breakpoints | UI (cross-cutting) |
| Accessibility (a11y/WCAG) | Design spec mentions a11y, WCAG, or contrast ratios | UI (cross-cutting) |
| Visual regression testing | Design spec defines precise visual tokens, or decisions.md selects Playwright screenshots | Domain (testing) |
| Performance baselines | NFRs define latency/throughput/Core Web Vitals targets | Domain (testing) |
| Security hardening (XSS/CORS/CSP) | NFRs mention security requirements | API (cross-cutting) |
| Error monitoring/logging | NFRs mention observability or error tracking | Domain (infra) |
| Internationalization (i18n) | PRD mentions multi-language support | UI (cross-cutting) |

**For each applicable concern:**
1. Create a dedicated cross-cutting task with `type: ui | api | domain` as appropriate
2. In its Description, list ALL module tasks it applies to (e.g., "Applies to: auth.login.ui, dashboard.overview.ui, editor.preview.ui")
3. Include specific `- TEST:` lines (not vague "ensure accessibility")

**Example cross-cutting task:**
```
- TEST: All interactive elements reachable via Tab key → focus ring visible
- TEST: All images have alt text → axe-core reports 0 violations
- TEST: Color contrast ratio >= 4.5:1 for body text → meets WCAG AA
- TEST: Dashboard renders correctly at 375px width → no horizontal scroll
```

**If no cross-cutting concerns apply (no design specs found, no NFRs), skip this step.**

### Step 5: Analyze Dependency Graph & Show Task Plan for Approval

#### Step 5.1: Validate Dependency Graph

Analyze the dependency graph to confirm all declared dependencies are valid:

1. Verify every referenced dependency exists as a task ID
2. Check for circular dependencies (must be a DAG)
3. Confirm that dependency ordering is consistent with priority ordering

**Note:** `parallelGroup` is no longer generated. The supported implement controller is `hermes-coding loop`, which selects the next ready task via `hermes-coding tasks next --json`. Existing task files that contain `parallelGroup` in their frontmatter will still be parsed for backward compatibility, but the field is deprecated.

#### Step 5.2: Display Task Plan

Display the task plan and ask for user approval:

```markdown
📋 Task Plan

**Total Tasks**: {N} tasks
**Estimated Time**: {X} hours

## PRD Coverage: {covered}/{total} items (see coverage table above)

## Execution Order (dependency-resolved)
Tasks will be selected by the controller via `hermes-coding tasks next`, which respects dependency ordering.

## Tasks by Module
### Module: {name} (Priority {range})
1. [P{n}] {task.id} - {description} ({minutes} min)
   - Type: API | UI | Domain | E2E
   - Dependencies: {deps or "none"}
   - TEST lines: {count}
...
```

**Use AskUserQuestion tool:**
- Question: "Do you approve this task breakdown?"
- Options: "Yes, proceed", "Modify first", "Cancel"
- Add "(Recommended)" to suggested option based on task quality

### Step 6: Handle Response & Update State

```bash
case "$ANSWER" in
  "Yes, proceed"*)
    # Persist approved drafts one at a time via CLI document-mode.
    # For each draft:
    hermes-coding tasks create \
      --content-file ".hermes-coding/drafts/tasks/<task-id>.md" \
      --module "<module>" \
      --json
    hermes-coding tasks list --json
    hermes-coding state update --phase implement
    ;;
  "Modify first"*)
    echo "Edit draft files in: .hermes-coding/drafts/tasks/"
    echo "No task has been persisted yet. After editing drafts, resume review with: /hermes-coding resume"
    exit 0
    ;;
  "Cancel"*)
    hermes-coding state clear
    exit 1
    ;;
esac
```

### Step 7: Return Result

**REQUIRED Output Format:**
```yaml
---PHASE RESULT---
phase: breakdown
status: complete
tasks_created: {N}
tasks_dir: .hermes-coding/tasks
estimated_hours: {X}
prd_coverage: {covered}/{total}
parallel_groups: {G}
cross_cutting_tasks: {C}
next_phase: implement
---END PHASE RESULT---
```

---

## TEST Line Format (P0 Requirement)

**Every acceptance criterion MUST decompose into concrete `- TEST:` lines.**

Format: `- TEST: {specific operation/input} → {specific expected result/error}`

The implementer must be able to convert each `- TEST:` line directly into an `it('should...')` test block. If you cannot write a concrete TEST line, the AC is too abstract and needs further decomposition.

**Good examples:**

```
- TEST: POST /api/sites with valid payload → 201, returns { id, name, status: "pending" }
- TEST: POST /api/sites without auth header → 401, returns { error: "unauthorized" }
- TEST: POST /api/sites with name > 64 chars → 400, returns { error: "name_too_long" }
- TEST: Upload file > 50MB → 413, returns { error: "file_too_large" }
- TEST: Render SiteCard with status="deploying" → shows spinner + "Deploying..." text
- TEST: Click delete button → shows confirmation dialog, does NOT delete yet
- TEST: validateDomain("exam ple.com") → returns { valid: false, reason: "contains_spaces" }
```

**Bad examples (too vague — NEVER write these):**

```
- TEST: API handles errors correctly
- TEST: UI shows proper states
- TEST: Validation works for edge cases
- TEST: Start with failing tests for size limits
```

**Minimum: 3 TEST lines per AC. Target: 5-8 per AC.**

### Edge Case Enumeration Checklist (Mandatory)

When writing TEST lines, you MUST systematically enumerate edge cases by category. Do NOT rely on intuition -- follow the checklist for the task type.

#### API Route Edge Cases

For each API endpoint, enumerate TEST lines covering ALL applicable categories:

| Category | What to Test | Example TEST Line |
|----------|-------------|-------------------|
| **Happy path** | Valid input, authenticated | `- TEST: POST /api/sites with valid payload + auth → 201` |
| **Missing required fields** | Omit each required field one at a time | `- TEST: POST /api/sites without name field → 400, { error: "name_required" }` |
| **Invalid field types** | Wrong type for each field | `- TEST: POST /api/sites with name=12345 (number) → 400, { error: "name_must_be_string" }` |
| **Boundary values** | Empty string, max length, zero, negative, extreme values | `- TEST: POST /api/sites with name="" → 400; name="a"*256 → 400` |
| **Auth failures** | No token, expired token, wrong role | `- TEST: POST /api/sites without Authorization header → 401` |
| **Not found** | Operate on non-existent resource | `- TEST: GET /api/sites/nonexistent-id → 404` |
| **Duplicate/conflict** | Create same resource twice | `- TEST: POST /api/sites with duplicate name → 409, { error: "name_exists" }` |
| **File/payload limits** | Oversize uploads, wrong MIME types | `- TEST: Upload 51MB file → 413; upload .exe file → 415` |
| **Concurrent modification** | Race conditions (if applicable) | `- TEST: Two simultaneous PUT /api/sites/:id → one succeeds, one gets 409` |

**Minimum for an API task: at least one TEST line from each of Happy path, Missing fields, Boundary values, Auth failures.**

#### UI Component Edge Cases

For each UI component, enumerate TEST lines covering ALL applicable categories:

| Category | What to Test | Example TEST Line |
|----------|-------------|-------------------|
| **Each state** | Empty, loading, normal, error (from State Matrix) | `- TEST: SiteList with 0 sites → shows empty state + "Create your first site" CTA` |
| **User interactions** | Click, hover, keyboard, focus | `- TEST: Press Enter on focused submit button → submits form` |
| **Form validation** | Submit with empty, invalid, and valid data | `- TEST: Submit form with empty email → inline error "Email is required"` |
| **Loading timing** | Skeleton display, transition to content | `- TEST: While API loading → skeleton visible; after load → skeleton replaced by content` |
| **Responsive layout** | Each breakpoint from design spec | `- TEST: At 375px width → sidebar hidden, cards stack vertically` |
| **Accessibility** | Keyboard navigation, screen reader | `- TEST: Tab through form → focus order: name, email, submit` |
| **Error recovery** | Retry after failure, dismiss errors | `- TEST: Click retry after fetch error → re-triggers API call` |

**Minimum for a UI task: at least one TEST line from each of Each state, User interactions, Form validation.**

#### Domain Logic Edge Cases

For each domain logic function, enumerate TEST lines covering ALL applicable categories:

| Category | What to Test | Example TEST Line |
|----------|-------------|-------------------|
| **Happy path** | Valid input, expected output | `- TEST: validateDomain("example.com") → { valid: true }` |
| **Empty/null/undefined** | Missing inputs | `- TEST: validateDomain("") → ValidationError("required")` |
| **Type coercion** | Wrong input types | `- TEST: validateDomain(123) → TypeError or ValidationError` |
| **Boundary values** | Min, max, zero, edge of valid range | `- TEST: validateDomain("a"*253 + ".com") → valid (max DNS length); "a"*254 + ".com" → too_long` |
| **Invalid format** | Malformed inputs | `- TEST: validateDomain("exam ple.com") → { valid: false, reason: "contains_spaces" }` |
| **State transitions** | Valid and invalid transitions (if stateful) | `- TEST: Site.deploy() when status="draft" → status changes to "deploying"` |
| **Invalid state transitions** | Operations not allowed in current state | `- TEST: Site.deploy() when status="deploying" → throws AlreadyDeployingError` |

**Minimum for a Domain task: at least one TEST line from each of Happy path, Empty/null, Boundary values.**

---

## Task File Format

### Base Format (All Tasks)

```markdown
---
id: {module}.{task-name}
module: {module-name}
type: api | ui | domain | e2e
priority: {number}
status: pending
estimatedMinutes: {number}
dependencies: [{direct-dependency-ids-only}]
---
# {Task Title}

## Description
{What needs to be implemented and why}

## Environment Context
{Auto-generated from Step 2.5 infrastructure scan. Include:}
- DB: {engine on host:port, DB name}
- Test DB: {isolation strategy from decisions.md}
- External services: {provider + credential key names from .env}
- Test strategy: {mock | real + sandbox | mixed}
- Key deps: {relevant packages with versions from package.json}

## Acceptance Criteria
1. {High-level criterion}

## Test Cases (Red Phase)
- TEST: {input/operation} → {expected output/behavior}
- TEST: {boundary input} → {expected error/rejection}
- TEST: {edge case} → {expected handling}

## Fixtures Required
- {Test data, mock services, or seed data needed}
```

### API Route Task (type: api)

Additional required sections:

```markdown
## API Contract
\`\`\`
{METHOD} {path}
Headers: { Authorization: Bearer <token> }
Request: { field: type, ... }
Response 2xx: { field: type, ... }
\`\`\`

## Error Codes
| Code | HTTP Status | Condition | Response Body |
|------|-------------|-----------|---------------|
| unauthorized | 401 | Missing/invalid token | { error: "unauthorized" } |
| validation_error | 400 | Invalid input | { error: "...", fields: [...] } |
```

### UI Component Task (type: ui)

Additional required sections:

```markdown
## State Matrix
| State | Condition | Renders |
|-------|-----------|---------|
| Empty | No data | Empty state illustration + CTA |
| Loading | Fetching | Skeleton / spinner |
| Normal | Data present | Component with data |
| Error | Fetch failed | Error message + retry button |

## Responsive Breakpoints
| Breakpoint | Layout Change |
|-----------|--------------|
| <640px (mobile) | Stack vertically, hide sidebar |
| 640-1024px (tablet) | 2-column grid |
| >1024px (desktop) | 3-column grid + sidebar |

## Accessibility
- Keyboard navigation: {tab order, focus management}
- Screen reader: {aria labels, live regions}
```

### Domain Logic Task (type: domain)

Additional required sections:

```markdown
## Boundary Matrix
| Input | Condition | Expected Output |
|-------|-----------|----------------|
| "" | Empty string | ValidationError("required") |
| "a".repeat(256) | Max length exceeded | ValidationError("too_long") |
| "valid-input" | Happy path | ProcessedResult({...}) |

## Input/Output Types
\`\`\`typescript
Input: { field: type, ... }
Output: { field: type, ... } | ErrorType
\`\`\`
```

### E2E Scenario Task (type: e2e)

E2E tasks verify complete user journeys against a running application. They use Playwright (or the project's E2E framework) and produce screenshot evidence.

Additional required sections:

```markdown
## Server Setup
- Start command: {e.g., npm run dev}
- Ready signal: {e.g., "Ready on http://localhost:3000" in stdout}
- Required services: {e.g., PostgreSQL via docker-compose, seed data via prisma db seed}
- Teardown: {e.g., kill dev server, reset test DB}

## Scenario Steps
1. Navigate to {URL}
2. {User action: click, type, wait}
3. Assert: {visible element, URL change, API response}
4. Screenshot: {checkpoint name}
5. {Next action...}

## Screenshot Checkpoints
| Step | Checkpoint Name | What to Verify |
|------|----------------|---------------|
| 1 | landing-page-loaded | Hero section visible, CTA button present |
| 3 | form-submitted | Success toast visible, form cleared |
| 5 | dashboard-updated | New item appears in list |

## Browser Config
- Viewport: {e.g., 1280x720 desktop, 375x667 mobile}
- Auth state: {e.g., pre-authenticated via storageState, or login flow included}
- Test data: {seed data required before test, cleanup after}
```

**E2E Task Rules:**
- E2E tasks depend on ALL module tasks in the user journey they cover
- E2E tasks are typically the last tasks to execute (all dependencies must complete first)
- Each scenario step must be concrete enough to automate (no vague "verify it works")
- Screenshot checkpoints serve as visual evidence — at least 1 per critical state transition
- The test file uses Playwright's `test()` and `expect()`, NOT vitest

**E2E Edge Cases to Cover:**
| Category | What to Test |
|----------|-------------|
| Happy path | Complete journey from start to finish |
| Auth boundary | Access protected page without login → redirect to login |
| Error recovery | Trigger server error mid-flow → verify error UI + retry |
| Responsive | Run same scenario at mobile viewport (375px) |
| Navigation | Browser back/forward during multi-step flow |

---

## Phase 2.5: Test Case Enrichment (Optional)

For Priority 1 tasks, consider enriching before implementation:

1. Read each P1 task's acceptance criteria
2. Expand each AC into additional TEST cases covering:
   - Happy path with realistic data
   - Boundary values (min, max, zero, empty)
   - Authorization/permission scenarios
   - Concurrent access / race conditions (if applicable)
3. Define all error codes with HTTP status mappings
4. Identify required fixtures and seed data
5. Write API contracts with exact request/response shapes

This enrichment can be done inline during Step 3, or as a separate pass after Step 4.5.

---

## Tool Constraints

### AskUserQuestion
- Max 4 questions per call
- `header`: ≤12 chars (e.g., "Approval")
- Add "(Recommended)" to suggested option

---

## Constraints

- **NEVER** create tasks >30 minutes (split using Time Estimation Guide)
- **NEVER** batch task creation in memory (context-compression vulnerability)
- **NEVER** write vague TEST lines (each must specify input → output)
- **NEVER** skip PRD coverage verification (Step 4.5)
- **NEVER** declare transitive dependencies
- **NEVER** ignore design spec files found in Step 2.1
- **NEVER** hardcode test strategy — always read from PRD Section 9.1 / decisions.md
- **NEVER** write directly into `.hermes-coding/tasks/**/*.md` — use `--content-file` via CLI only
- **ALWAYS** classify each task as API/UI/Domain before creating it
- **ALWAYS** author task content as drafts under `.hermes-coding/drafts/tasks/` before persisting via CLI
- **ALWAYS** persist tasks via `hermes-coding tasks create --content-file <path> --module <module>`
- **ALWAYS** scan for design/spec files beyond prd.md (Step 2.1)
- **ALWAYS** scan project infrastructure and inject Environment Context (Step 2.5)
- **ALWAYS** run cross-cutting concerns audit if design specs exist (Step 4.7)
- **ALWAYS** verify the dependency graph is valid (Step 5.1)
- **ALWAYS** verify task creation via CLI after each create
- **ALWAYS** get user approval before transitioning to implement
- **ALWAYS** return structured PHASE RESULT block

---

## Error Handling

| Error | Action |
|-------|--------|
| PRD not found | Fail, prompt to run Phase 1 |
| Task creation fails | Retry once, then report error |
| User rejects plan | Save state, allow manual editing |
| PRD coverage < 100% | Create missing tasks or document exclusions before proceeding |
| Cannot write concrete TEST lines | AC is too abstract — decompose further or ask for clarification |
| No decisions.md found | Use mock-first defaults, log warning in task Environment Context |
| Design spec mentions a11y but no a11y task exists | Step 4.7 must create cross-cutting a11y task |
| Infrastructure files not found | Generate minimal Environment Context noting "no infra files detected" |
