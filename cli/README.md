# hermes-coding CLI

TypeScript command-line tool for hermes-coding state and task management.

## Overview

The hermes-coding CLI provides efficient operations for managing development workflow state, tasks, and language detection. It's designed to be called from hermes-coding skills during autonomous development phases.

**Key capabilities:**
- State management across 5 workflow phases
- Task CRUD operations with dependency tracking and document mode
- Automatic language and framework detection
- JSON output for integration with bash scripts
- Progress tracking across tasks and projects
- Phase 3 implementation loop with multi-tool support

## Installation

```bash
# Install globally from npm
npm install -g hermes-coding

# Or use in a project
npx hermes-coding <command>
```

## Quick Start

```bash
# Initialize hermes-coding in your project
hermes-coding init

# Check project status
hermes-coding status

# Detect project language/framework
hermes-coding detect
```

## Commands

### `init`

Initialize hermes-coding in the current project. Copies skill files into `.claude/` and optionally creates a pre-commit hook.

```bash
hermes-coding init [--json] [--no-hook]
```

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |
| `--no-hook` | Skip pre-commit hook creation |

### `state`

Manage workflow state stored in `.hermes-coding/state.json`.

**Get current state:**
```bash
hermes-coding state get [--json]
```

**Set state:**
```bash
hermes-coding state set --phase <phase> [--task <taskId>] [--json]
# Example:
hermes-coding state set --phase implement --task auth.login.ui
```

**Update state fields:**
```bash
hermes-coding state update [--phase <phase>] [--task <taskId>] [--prd <prdJson>] [--add-error <errorJson>] [--json]
```

**Clear state:**
```bash
hermes-coding state clear [--json]
```

**Archive current session:**
```bash
hermes-coding state archive [--force] [--json]
```
Archives the current session to `.hermes-coding/archive/` and clears state. Use `--force` to archive even if the session is incomplete.

**Supported phases:** `clarify`, `breakdown`, `implement`, `deliver`, `complete`

### `tasks`

Manage tasks in `.hermes-coding/tasks/` directory.

**Initialize task system:**
```bash
hermes-coding tasks init [--project-goal <goal>] [--language <language>] [--framework <framework>] [--json]
# Example:
hermes-coding tasks init --project-goal "User authentication system" --language typescript --framework nextjs
```

**Create a task:**
```bash
# Field mode (individual flags):
hermes-coding tasks create <taskId> \
  --module <module> \
  --description <desc> \
  [--priority <1-10>] \
  [--estimated-minutes <minutes>] \
  [--criteria <criterion1> --criteria <criterion2>] \
  [--dependencies <dep1> --dependencies <dep2>] \
  [--test-pattern <pattern>] \
  [--json]

# Document mode (markdown file with YAML frontmatter):
hermes-coding tasks create --content-file <path> [--json]
```

**List tasks:**
```bash
hermes-coding tasks list [options] [--json]
# Options:
#   -s, --status <status>         Filter by status
#   -m, --module <module>         Filter by module
#   -p, --priority <priority>     Filter by priority
#   --has-dependencies            Only show tasks with dependencies
#   --ready                       Only show tasks with satisfied dependencies
#   --limit <n>                   Limit results (default: 100)
#   --offset <n>                  Skip first n results
#   --sort <field>                Sort by: priority|status|estimatedMinutes
```

**Get next task (with comprehensive context):**
```bash
hermes-coding tasks next [--json]
```
Returns the highest-priority pending task with git info, workflow state, progress statistics, dependency status, test requirements, and recent activity.

**Get specific task:**
```bash
hermes-coding tasks get <taskId> [--json] [--prompt]
```
Use `--prompt` to render a complete implementer prompt including task content, context, progress logs, and PRD.

**Mark task as in progress:**
```bash
hermes-coding tasks start <taskId> [--dry-run] [--json]
```

**Mark task as completed:**
```bash
hermes-coding tasks complete <taskId> [--duration <duration>] [--dry-run] [--json]
# Example:
hermes-coding tasks complete auth.login.ui --duration "23m 15s"
```

**Mark task as failed:**
```bash
hermes-coding tasks fail <taskId> --reason <reason> [--dry-run] [--json]
```

### `status`

Display overall project progress and statistics.

```bash
hermes-coding status [--json]
```

Shows current session info, overall progress, and per-module breakdown with visual progress bars.

### `detect`

Detect project language and configuration.

```bash
hermes-coding detect [--save] [--json]
```
Use `--save` to persist detected configuration to the task index metadata.

### `progress`

Append entries to progress log files.

```bash
# Task progress:
hermes-coding progress append <content> --task <taskId> [--json]

# Project progress:
hermes-coding progress append <content> --project [--json]
```

### `loop`

Run the Phase 3 implementation loop.

```bash
hermes-coding loop [max-iterations] [--tool <claude|amp>] [--visible]
```
Requires state to exist and phase to be `implement`. Each iteration gets the next task and invokes the selected AI tool.

### `update`

Check for and install CLI updates.

```bash
hermes-coding update [--check] [--json]
```
Use `--check` to check for updates without installing.

## Usage in Skills

The CLI is designed to be called from bash skills. Here's a typical Phase 3 loop:

```bash
# Phase 3: Implementation loop
while true; do
  TASK_JSON=$(hermes-coding tasks next --json)

  if echo "$TASK_JSON" | jq -e '.error' > /dev/null; then
    echo "No more tasks"
    break
  fi

  TASK_ID=$(echo "$TASK_JSON" | jq -r '.task.id')

  hermes-coding tasks start "$TASK_ID"
  hermes-coding state update --task "$TASK_ID"

  # ... implement task (spawn agent, run tests, etc.) ...

  if [ $? -eq 0 ]; then
    hermes-coding tasks complete "$TASK_ID"
  else
    hermes-coding tasks fail "$TASK_ID" --reason "Tests failed"
    break
  fi
done
```

## Data Structures

### State File (`.hermes-coding/state.json`)
```json
{
  "phase": "implement",
  "currentTask": "auth.login.ui",
  "prd": {},
  "errors": [],
  "startedAt": "2026-01-19T10:00:00Z",
  "updatedAt": "2026-01-19T10:15:00Z"
}
```

### Task File (`.hermes-coding/tasks/auth/login.ui.md`)
```markdown
---
id: auth.login.ui
module: auth
priority: 2
status: in_progress
estimatedMinutes: 25
dependencies:
  - setup.scaffold
testRequirements:
  unit:
    required: true
    pattern: "**/*.test.ts"
---

# Login UI Component

## Acceptance Criteria
1. Form displays email and password fields
2. Submit button validates email format
3. Error messages display on validation failure

## Notes
Using React Hook Form for validation.
```

### Task Index (`.hermes-coding/tasks/index.json`)
```json
{
  "metadata": {
    "projectGoal": "User authentication system",
    "languageConfig": {
      "language": "typescript",
      "framework": "nextjs"
    }
  },
  "tasks": {
    "auth.login.ui": {
      "module": "auth",
      "priority": 2,
      "status": "in_progress",
      "filePath": "auth/login.ui.md"
    }
  }
}
```

## Architecture

```
Commands (CLI Interface)
  └── Services (Business Logic)
        └── Repositories (Data Access)
              └── Domain Models (Entities)
                    └── Infrastructure (File System, Logger)
```

**Key patterns:**
- **Dependency Injection** — Services and repositories injected via constructors
- **Repository Pattern** — All data access abstracted behind interfaces
- **Rich Domain Models** — Entities enforce business rules and state transitions
- **Circuit Breaker** — Auto-stops after 5 consecutive failures in implement phase
- **Saga Pattern** — Atomic multi-step operations with automatic rollback

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid input |
| 3 | Not found |
| 4 | Dependency not met |
| 5 | Permission denied |
| 6 | Already exists |
| 7 | Invalid state |
| 8 | File system error |
| 9 | Parse error |

## Development

```bash
cd cli
npm install
npm run build          # Compile TypeScript
npm run dev            # Watch mode
npm test               # Run tests
npm run lint           # ESLint
npm run format         # Prettier
```

Tests use Vitest with `fileParallelism: false`. Run with `CI=true` to avoid interactive prompts.

## Requirements

- Node.js >= 18.0.0

## License

MIT

---

**Version:** 0.1.0
**Repository:** https://github.com/douglas-ou/hermes-coding
