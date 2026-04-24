# hermes-coding

[English](README.md) | [中文](README_ZH.md)

**Describe what to build. Get working, tested, committed code.**

hermes-coding is an AI coding tool that turns natural language requirements into production-ready code through a guided 4-phase loop: clarify → break down → implement → deliver.

[![npm version](https://img.shields.io/npm/v/hermes-coding.svg)](https://www.npmjs.com/package/hermes-coding)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

---

## Quick Start

```bash
# 1. Install the CLI
npm install -g hermes-coding

# 2. Copy skills into your project
cd your-project
hermes-coding init

# 3. Start Claude Code and kick off a session
/hermes-coding "Add password reset via email"
```

When the workflow reaches the implement phase, run the loop from your terminal:

```bash
hermes-coding loop
```

That's it. hermes-coding handles the rest — tasks, tests, git commit, and pull request.

---

## How It Works

```
CLARIFY  →  BREAKDOWN  →  IMPLEMENT  →  DELIVER
```

| Phase | What happens |
|-------|-------------|
| **Clarify** | Structured Q&A surfaces requirements, generates a PRD |
| **Breakdown** | PRD is split into atomic tasks (< 30 min each) with dependencies |
| **Implement** | `hermes-coding loop` runs tasks one at a time, writes tests first, self-heals on failure |
| **Deliver** | Quality gates (lint, type-check, tests), then git commit + pull request |

Each task runs in a **fresh agent context** to keep implementation focused and avoid context drift.

---

## Commands

### In Claude Code

| Command | Description |
|---------|-------------|
| `/hermes-coding "<requirement>"` | Start a new development session |
| `/hermes-coding resume` | Resume a session in progress |
| `/hermes-coding status` | Show current phase and task progress |
| `/hermes-coding cancel` | Abandon the current session |

### In your terminal

```bash
hermes-coding loop              # Run the implement loop (after Claude Code hands off)
hermes-coding state get         # Show current state as JSON
hermes-coding tasks list        # List all tasks and their status
hermes-coding tasks next        # Show the next ready task
hermes-coding tasks get <id> --prompt  # Get task details as an implementer prompt
hermes-coding progress append   # Append a learning to project or task progress
hermes-coding init              # Copy skills + create pre-commit hooks
hermes-coding detect            # Detect project language and framework
hermes-coding update            # Update to the latest version
```

---

## Installation

### Prerequisites

- [Claude Code](https://claude.ai/code) (latest)
- Node.js >= 18
- npm >= 9
- A git repository

### Steps

**1. Install the CLI globally**

```bash
npm install -g hermes-coding
```

**2. Initialize your project**

Run this once per project to copy the skills into `.claude/skills/` and set up pre-commit hooks:

```bash
cd your-project
hermes-coding init
```

**3. Start Claude Code and run your first session**

```bash
/hermes-coding "Build a REST API for user management"
```

---

## Key Features

**Test-driven by default** — each task writes failing tests before implementation. Baseline tests must pass before any task starts.

**Self-healing** — failed tasks are automatically investigated using web search and patched. Baseline tests are auto-fixed before each task via the built-in baseline-fixer skill.

**Language auto-detection** — detects your stack from project files and configures verify commands automatically.

**Auto-update** — checks for new versions on every command (cached, 24h interval). Run `hermes-coding update` to upgrade manually.

**State persistence** — all state lives in `.hermes-coding/`, so sessions survive restarts and context resets.

---

## Workspace Layout

After your first session:

```
your-project/
└── .hermes-coding/
    ├── state.json          # Phase + task state (managed by CLI)
    ├── prd.md              # Generated product requirements
    ├── progress.txt        # Learning log across tasks
    ├── context/            # Extracted context (decisions, plans, etc.)
    ├── tasks/
    │   ├── index.json      # Task index
    │   ├── auth/
    │   │   ├── login.md
    │   │   └── logout.md
    │   └── setup/
    │       └── scaffold.md
    ├── drafts/             # Phase 2 working files (pre-persistence)
    └── e2e-evidence/       # Screenshots from E2E tasks
```

Recommended `.gitignore` additions:

```
.hermes-coding/state.json
.hermes-coding/debug.log
.hermes-coding/drafts/
```

Keep task definitions and the PRD in version control:

```
!.hermes-coding/prd.md
!.hermes-coding/tasks/**/*.md
```

---

## Troubleshooting

**Skills not loading**
```bash
hermes-coding init   # Re-copy skills into .claude/skills/
/clear
```

**CLI not found**
```bash
npm list -g hermes-coding      # Verify installation
npm install -g hermes-coding   # Reinstall if missing
```

**Session stuck**
```bash
hermes-coding state get        # Check what phase you're in
hermes-coding tasks list       # See task statuses
hermes-coding state clear      # Reset (last resort)
```

**Node.js version mismatch**
```bash
node --version   # Must be >= 18
npm --version    # Must be >= 9
```

---

## Contributing

- **Bug reports** — [GitHub Issues](https://github.com/douglas-ou/hermes-coding/issues)
- **Feature requests** — [GitHub Discussions](https://github.com/douglas-ou/hermes-coding/discussions)
- **PRs** — fork, create a feature branch, add tests, use semantic commits

---

## Inspired By & Acknowledgements

- [superpowers](https://github.com/obra/superpowers) — Skills and agent workflows for Claude Code
- [ralph](https://github.com/snarktank/ralph) — Autonomous AI coding agent with spec-driven development
- [ralph-dev](https://github.com/mylukin/ralph-dev) — Ralph plugin for Claude Code with loop-driven implementation

---

## License

MIT — see [LICENSE](LICENSE).
