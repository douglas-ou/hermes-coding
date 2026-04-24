# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

hermes-coding is a Claude Code plugin that automates software development workflows through a 4-phase process: **CLARIFY → BREAKDOWN → IMPLEMENT → DELIVER**. It has two major components that interact at runtime:

- **`skills/hermes-coding/`** — Markdown-based AI agent skill files (the "brains"). Invoked as `/hermes-coding` in Claude Code.
- **`skills/baseline-fixer/`** — Standalone skill for automated test failure resolution. Invoked as `/baseline-fixer`.
- **`cli/`** — TypeScript CLI binary (`hermes-coding`) that skills call via shell to persist state and tasks between agent invocations.

## Development Commands

All CLI work happens inside the `cli/` directory:

```bash
cd cli

# Build
npm run build         # Compile TypeScript → dist/
npm run dev           # Watch mode

# Testing (MUST use CI=true to avoid interactive prompts)
CI=true npm test                                          # All tests
CI=true npx vitest run tests/core/task-parser.test.ts    # Single file
CI=true npm test -- --coverage                           # With coverage

# Code quality
npm run lint          # ESLint
npm run format        # Prettier
```

Tests live in `cli/tests/` (mirrors `cli/src/`). Test runner is Vitest with `fileParallelism: false` — don't enable parallelism; tests use real temp directories and race.

## Architecture

### How Skills and CLI Interact

Skills are stateless markdown prompts. Between agent invocations, the CLI persists state to `.hermes-coding/` in the user's project:

```
User project root/
└── .hermes-coding/
    ├── state.json       # Current phase and currentTask
    ├── prd.md           # Product Requirements Document (Phase 1 output)
    ├── context/         # Phase 1 clarification artifacts (interview notes, tech constraints)
    ├── tasks/
    │   ├── index.json   # Task index (statuses, metadata)
    │   └── {module}/{id}.md   # Task files with YAML frontmatter
    ├── drafts/tasks/    # Phase 2 pre-persistence drafts
    └── progress.txt     # Learning log across tasks
```

The `hermes-coding loop` command (run from a terminal, not Claude Code) is the Phase 3 engine — it uses `tasks next` to get the next available task and determine whether to continue, stop, or report blocking.

### CLI Layered Architecture

See `cli/CLAUDE.md` for the full layered breakdown. Summary:

```
Commands (CLI interface)
  └── Services (business logic)
        └── Repositories (file persistence + index.json management)
              └── Domain entities (Task, State — behavior enforced here)
                    └── Infrastructure (FileSystemService, ConsoleLogger)
```

`service-factory.ts` is the DI wiring point — all services are instantiated there with their concrete dependencies. Tests inject mocks via the interfaces (`ITaskService`, `IStateService`, etc.).

### Skill Dispatch Logic

`skills/hermes-coding/SKILL.md` is the entry point. It reads `state.json` to determine the current phase and dispatches to the appropriate phase file. New invocations of `/hermes-coding` always start with Phase 1 unless resuming.

### CLI Commands

| Command | Subcommands | Purpose |
|---------|-------------|---------|
| `init` | — | Bootstrap `.hermes-coding/` in a project, install pre-commit hook |
| `state` | `get`, `set`, `update`, `clear`, `archive` | Manage workflow phase and current task |
| `tasks` | `init`, `create`, `list`, `next`, `get`, `start`, `complete`, `fail` | Full task lifecycle (supports `--json`, `--prompt`) |
| `status` | — | Show workspace overview (phase, task progress) |
| `detect` | — | Detect project language and framework |
| `progress` | `append` | Append structured learning entries to progress log |
| `update` | — | Check for CLI updates |
| `loop` | — | Phase 3 engine — repeatedly get next task and invoke agent |

### Task File Format

Task files use YAML frontmatter + markdown body. Key fields: `id`, `module`, `priority`, `status`, `estimatedMinutes`, `dependencies[]`, `testRequirements`. The CLI preserves unknown frontmatter fields on update (incremental merge).

## Key Constraints

- **`HERMES_CODING_WORKSPACE`** env var overrides the workspace directory (defaults to `process.cwd()`).
- All CLI commands output `{ success, data, error }` JSON when `--json` is passed — skills always use `--json` and check `.success`.
- Exit codes are semantic: 0=success, 1=general error, 2=invalid input, 3=not found, 4=dependency not met, 5=permission denied, 6=already exists, 7=invalid state, 8=file system error, 9=parse error.
- The CLI auto-builds on first plugin use via `skills/hermes-coding/bootstrap-cli.sh`.
