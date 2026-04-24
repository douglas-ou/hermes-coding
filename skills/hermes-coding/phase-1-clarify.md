<!-- Phase 1 | Tools: Read, Write, Bash, AskUserQuestion | Interactive: yes -->

# Phase 1: Clarify Requirements

## Goal

Transform user requirements into a comprehensive PRD that preserves all context from prior conversations.

## Core Principle

**Context preservation is the primary goal.** If the user discussed UI layouts, data models, or design decisions before invoking `/hermes-coding`, that information MUST be captured in the PRD.

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
# Expected: clarify (or none for new session)
```

### Step 1: Extract Context (CRITICAL - Do This First)

Before asking ANY questions, scan the **entire** conversation history for context. This step determines PRD quality and compression resilience.

#### 1.1 Create Context Directory

```bash
mkdir -p .hermes-coding/context
```

#### 1.2 Extract & Save Context Artifacts

Scan for these categories and save **verbatim** where possible:

| Category | What to Extract | Save To |
|----------|-----------------|---------|
| **Plan Mode** | Full plan content (copy exactly as-is) | `.hermes-coding/context/plan.md` |
| **User Intent** | Original requirement statements (quoted) | `.hermes-coding/context/user-intent.md` |
| **File References** | All file paths mentioned/read/edited | `.hermes-coding/context/files-referenced.md` |
| **UI/UX** | Wireframes, layouts, components, design tokens | `.hermes-coding/context/ui-design.md` |
| **Data Models** | Entities, schemas, relationships, field specs | `.hermes-coding/context/data-model.md` |
| **API Specs** | Endpoints, requests, responses, auth | `.hermes-coding/context/api-spec.md` |
| **Decisions** | Choices made, alternatives, trade-offs | `.hermes-coding/context/decisions.md` |
| **External Links** | URLs, documentation links, references | `.hermes-coding/context/external-links.md` |

#### 1.3 Context File Format

Each context file should follow this structure:

```markdown
# [Category Name]

## Source
- Extracted from: [conversation turn / file path / plan mode]
- Timestamp: [YYYY-MM-DD HH:MM]

## Content

[Verbatim content or structured extraction]

## References
- [List of related files/links]
```

#### 1.4 Plan Mode Handling (CRITICAL)

If a plan was created in Plan Mode before invoking hermes-coding:

1. **Copy the ENTIRE plan verbatim** - do not summarize
2. Save to `.hermes-coding/context/plan.md`
3. The plan becomes the primary source of implementation intent
4. PRD should reference and expand on the plan, not replace it

#### 1.5 File Reference Index

Create `.hermes-coding/context/files-referenced.md` with ALL files mentioned:

```markdown
# Referenced Files Index

## Files Read
- `/path/to/file1.ts` - [brief description of why referenced]
- `/path/to/file2.md` - [brief description]

## Files to Create/Modify
- `/path/to/new-file.ts` - [purpose]

## External URLs
- https://example.com/docs - [what it contains]
```

#### 1.6 User Intent Preservation

In `.hermes-coding/context/user-intent.md`, preserve user's **exact words**:

```markdown
# User Intent Record

## Original Request
> [Quote user's exact requirement text]

## Clarifications
> [Quote any follow-up clarifications]

## Constraints Mentioned
> [Quote any constraints user specified]
```

### Step 2: Identify Gaps

Determine what's MISSING after extraction:
- Tech stack? Scale? Authentication? Deployment?
- Only proceed to ask about information NOT already discussed

### Step 3: Confirm & Ask Questions

**If context was extracted:**
1. Display summary of extracted context to user
2. Use `AskUserQuestion` to confirm accuracy
3. Only ask additional questions for gaps

**If no prior context:**
- Ask standard clarification questions (app type, tech stack, scale, auth)

### Step 3.5: Collect Technical Decisions

**IMPORTANT:** Before generating the PRD, collect key technical decisions that directly affect task generation quality. These decisions prevent repeated confirmation loops during implementation.

Use `AskUserQuestion` to collect (skip questions already answered in prior context):

**Question Set 1: Test Infrastructure**
- **Test strategy**: "How should tests interact with external services?"
  - Options: "Mock all external services (fast, isolated)", "Use real services with sandbox isolation (Recommended)", "Mix: unit tests mock, integration/E2E use real"
- **Test DB isolation**: "How should test databases be isolated?"
  - Options: "Separate `_test` database (Recommended)", "Shared DB with table prefix", "In-memory database (SQLite)", "Same DB, transaction rollback"

**Question Set 2: Quality & Tooling**
- **Visual testing**: "Do you need visual regression testing?"
  - Options: "Playwright screenshots (Recommended if design spec exists)", "Storybook visual tests", "Not needed"
- **CI/CD constraints**: "Can your CI environment access cloud services (S3/COS, external APIs)?"
  - Options: "Yes, full access", "Limited (rate-limited or restricted)", "No, CI is fully isolated"

Save all decisions to `.hermes-coding/context/decisions.md` with this format:

```markdown
# Technical Decisions

## Source
- Collected during: Phase 1 Clarify
- Timestamp: [YYYY-MM-DD HH:MM]

## Decisions

### Test Strategy
- External services: {mock | real + sandbox | mixed}
- Rationale: {user's choice}

### Test DB Isolation
- Strategy: {separate _test DB | prefix | in-memory | rollback}
- Rationale: {user's choice}

### Visual Testing
- Tool: {Playwright screenshots | Storybook | none}

### CI/CD Constraints
- Cloud access: {full | limited | none}
```

### Step 4: Generate PRD

Create PRD with the following structure. **CRITICAL**: Include Context Index at the top for compression resilience.

#### PRD Structure

```markdown
# [Project Name] - Product Requirements Document

## Context Index (CRITICAL - Read These First After Compression)

> **Recovery Instructions**: If context was compressed, read these files in order:

| Priority | File | Contains |
|----------|------|----------|
| 1 | `.hermes-coding/context/plan.md` | Original implementation plan (if exists) |
| 2 | `.hermes-coding/context/user-intent.md` | User's exact requirements |
| 3 | `.hermes-coding/context/files-referenced.md` | All file paths and URLs |
| 4 | `.hermes-coding/context/decisions.md` | Design decisions and rationale |
| 5 | `.hermes-coding/context/[domain].md` | Domain-specific details |

---

## 1. Project Overview
[Goals, scope, constraints]

## 2. Technical Stack
[Language, frameworks, database, deployment]

## 3. UI/UX Design *(if discussed)*
[Reference: `.hermes-coding/context/ui-design.md`]

## 4. Data Model *(if discussed)*
[Reference: `.hermes-coding/context/data-model.md`]

## 5. API Contracts *(if discussed)*
[Reference: `.hermes-coding/context/api-spec.md`]

## 6. User Flows *(if discussed)*
[Key journeys, edge cases]

## 7. User Stories
[Epics with acceptance criteria]

## 8. Design Decisions *(if discussed)*
[Reference: `.hermes-coding/context/decisions.md`]

## 9. Non-Functional Requirements
[Performance, security, testing]

### 9.1 Technical Decisions (from Step 3.5)
- **Test strategy**: {mock | real + sandbox | mixed}
- **Test DB isolation**: {separate _test DB | prefix | in-memory | rollback}
- **Visual testing**: {Playwright screenshots | Storybook | none}
- **CI/CD constraints**: {full cloud access | limited | fully isolated}

## Appendix A: Original Plan *(if from Plan Mode)*

> **Source**: `.hermes-coding/context/plan.md`

[Include FULL plan content here - do not summarize]

## Appendix B: User Intent Record

> **Source**: `.hermes-coding/context/user-intent.md`

[Include user's exact words]

## Appendix C: Referenced Files

> **Source**: `.hermes-coding/context/files-referenced.md`

[List all file paths and their relevance]
```

### Step 5: Save PRD and Context Files

```bash
mkdir -p .hermes-coding/context

# REQUIRED: Backup existing PRD before overwriting
if [ -f ".hermes-coding/prd.md" ]; then
  BACKUP_TIMESTAMP=$(date +%Y%m%d-%H%M%S)
  cp .hermes-coding/prd.md ".hermes-coding/prd.${BACKUP_TIMESTAMP}.bak"
  # Keep only last 5 backups
  ls -t .hermes-coding/prd.*.bak 2>/dev/null | tail -n +6 | xargs -r rm -f
fi
```

**Save Order (Use Write tool for each):**

1. Save context files first (only those with content):
   - `.hermes-coding/context/plan.md` - If Plan Mode was used
   - `.hermes-coding/context/user-intent.md` - Always (user's exact words)
   - `.hermes-coding/context/files-referenced.md` - If files were referenced
   - `.hermes-coding/context/decisions.md` - If decisions were made
   - `.hermes-coding/context/[domain].md` - Domain-specific (ui-design, data-model, api-spec)

2. Save PRD last:
   - `.hermes-coding/prd.md` - Main PRD with Context Index

### Step 6: Update State & Return Result

```bash
# REQUIRED: Transition to next phase
hermes-coding state update --phase breakdown
```

**REQUIRED Output Format** (orchestrator parses this):

```yaml
---PHASE RESULT---
phase: clarify
status: complete
prd_file: .hermes-coding/prd.md
context_files:
  - .hermes-coding/context/user-intent.md
  - .hermes-coding/context/files-referenced.md
  - .hermes-coding/context/plan.md        # if Plan Mode was used
  - .hermes-coding/context/decisions.md   # always (from Step 3.5)
context_extracted: true/false
plan_mode_preserved: true/false
next_phase: breakdown
---END PHASE RESULT---
```

---

## Tool Constraints

### AskUserQuestion

- **Max 4 questions** per tool call
- Each question requires:
  - `question`: The question text
  - `header`: Short label (≤12 chars), e.g., "App Type", "Tech Stack"
  - `multiSelect`: true/false
  - `options`: 2-4 choices, each with `label` and `description`
- Add "(Recommended)" suffix to suggested default option
- "Other" option is auto-provided by Claude Code
- **60-second timeout** - keep questions simple

---

## Constraints

### Context Preservation (CRITICAL)

- **NEVER** summarize Plan Mode content - copy verbatim to `.hermes-coding/context/plan.md`
- **NEVER** paraphrase user requirements - quote exact words in `user-intent.md`
- **NEVER** omit file paths - every referenced file goes to `files-referenced.md`
- **ALWAYS** save context files BEFORE generating PRD
- **ALWAYS** include Context Index at top of PRD for compression recovery

### General Rules

- **NEVER** lose context from prior discussions
- **NEVER** ask questions about information already provided
- **NEVER** generate generic filler content - only include relevant sections
- **NEVER** ask questions in plain text - always use `AskUserQuestion` tool
- **ALWAYS** backup existing PRD before overwriting
- **ALWAYS** update state via CLI after completion
- **ALWAYS** return structured PHASE RESULT block

---

## Error Handling

| Error | Action |
|-------|--------|
| User cancels | Save partial state, return `status: cancelled` |
| Context unclear | Ask user to clarify specific points |
| PRD generation fails | Use minimal PRD with available info |
| State update fails | Log error, retry once, then report to orchestrator |
