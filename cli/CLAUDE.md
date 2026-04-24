# hermes-coding CLI

TypeScript command-line tool for managing AI agent workflow state and tasks. Called from hermes-coding skills during autonomous development phases.

## Key Design

- **Zero-config**: Creates `.hermes-coding/` on first use
- **CLI-first**: All operations via command-line for bash integration
- **JSON output**: Every command supports `--json` flag
- **Layered architecture**: Commands → Services → Repositories → Domain → Infrastructure

## Development Commands

**CRITICAL**: Always use `CI=true` when running tests.

```bash
# Build and run
npm run dev           # Development with watch
npm run build         # Production build

# Testing (MUST use CI=true)
CI=true npm test                           # All tests
CI=true npx vitest run tests/core/task-parser.test.ts  # Single file
CI=true npx vitest run --coverage          # With coverage

# Code quality
npm run lint          # Lint check
npm run format        # Format code
```

## Quick Start: Adding a New Feature

Follow this layered approach:

### 1. Domain Entity (`src/domain/`)
```typescript
export class MyEntity {
  constructor(public readonly id: string, private _status: string) {}
  canTransition(): boolean { return this._status === 'ready'; }
  transition(): void {
    if (!this.canTransition()) throw new Error('Invalid transition');
    this._status = 'done';
  }
}
```

### 2. Repository Interface (`src/repositories/`)
```typescript
export interface IMyRepository {
  findById(id: string): Promise<MyEntity | null>;
  save(entity: MyEntity): Promise<void>;
}
```

### 3. Service (`src/services/`)
```typescript
export class MyService {
  constructor(private repo: IMyRepository, private logger: ILogger) {}
  async process(id: string): Promise<MyEntity> {
    const entity = await this.repo.findById(id);
    if (!entity) throw new Error('Not found');
    entity.transition();
    await this.repo.save(entity);
    return entity;
  }
}
```

### 4. Service Factory (`src/commands/service-factory.ts`)
```typescript
export function createMyService(workspaceDir: string): MyService {
  const fileSystem = new FileSystemService();
  const repo = new FileSystemMyRepository(fileSystem, workspaceDir);
  return new MyService(repo, new ConsoleLogger());
}
```

### 5. Command (`src/commands/`)
```typescript
my.command('process <id>')
  .option('--json', 'Output JSON')
  .action(async (id, options) => {
    const service = createMyService(process.env.HERMES_CODING_WORKSPACE || process.cwd());
    try {
      const entity = await service.process(id);
      outputResponse({ entity }, options.json);
    } catch (error) { handleError(error, options.json); }
  });
```

## File Structure

```
cli/src/
├── commands/              # CLI interface (thin layer)
│   ├── service-factory.ts # Dependency injection
│   ├── state.ts           # state get/set/update/clear/archive
│   ├── tasks.ts           # task lifecycle (create, list, next, complete...)
│   ├── loop.ts            # Phase 3 loop engine
│   ├── init.ts            # Bootstrap workspace + pre-commit hook
│   ├── status.ts          # Workspace overview
│   ├── detect.ts          # Language/framework detection
│   ├── progress.ts        # Append to progress log
│   └── update.ts          # Check for CLI updates
├── services/              # Business logic
│   ├── task-service.ts
│   ├── state-service.ts
│   ├── context-service.ts       # Phase 1 context management
│   ├── detection-service.ts     # Project detection
│   ├── hook-service.ts          # Git hook management
│   ├── prompt-service.ts        # Prompt generation for tasks
│   ├── progress-txt.service.ts  # Progress log persistence
│   ├── status-service.ts        # Status aggregation
│   └── update-checker.service.ts
├── repositories/          # Data access
│   ├── task-repository.ts
│   ├── state-repository.ts
│   └── index-repository.ts      # index.json management
├── domain/                # Entities with behavior
│   ├── task-entity.ts
│   └── state-entity.ts
├── infrastructure/        # File I/O, logging
│   ├── file-system.ts
│   └── logger.ts
├── core/                  # Utilities
│   ├── task-parser.ts     # YAML frontmatter parsing
│   ├── task-writer.ts     # Task file serialization
│   ├── task-dependencies.ts # Dependency resolution
│   ├── exit-codes.ts      # Semantic exit codes (0-9)
│   ├── error-handler.ts   # Centralized error → exit code mapping
│   ├── response-wrapper.ts # Structured JSON output
│   ├── retry.ts           # Retry with backoff
│   └── structured-output.ts
├── language/              # Language detection
│   └── detector.ts
└── test-utils/            # Mock implementations
```

**Workspace Structure:**
```
.hermes-coding/
├── state.json           # Current phase and task
├── prd.md               # Product Requirements Document
├── context/             # Phase 1 clarification artifacts
├── tasks/
│   ├── index.json       # Task index
│   └── {module}/{id}.md # Task files
└── progress.txt         # Learning log across tasks
```

## Task File Format

```markdown
---
id: auth.login
module: auth
priority: 2
status: pending
estimatedMinutes: 25
parallelGroup: 1
dependencies:
  - setup.scaffold
---

# Task Description

## Acceptance Criteria
1. Criterion 1
```

Task files support incremental merge on save — unknown frontmatter fields and custom body sections are preserved when updating an existing task.

## Archive Naming

When a session is archived (`hermes-coding state archive`), the archive folder is named using a slugified PRD title (e.g. `todo-app-20260402`). Falls back to timestamp if no title is available. Title is extracted from `state.prd.title` or the first `# heading` in `prd.md`.

## Architecture Rules

| Layer | DO | DON'T |
|-------|-----|-------|
| Commands | Parse args, call services, format output | Put business logic, access file system |
| Services | Business logic, coordinate repos | Create own dependencies |
| Repositories | Data persistence, maintain index.json | Expose file paths to services |
| Domain | Behavior methods, enforce invariants | Just be data bags |
| Infrastructure | File I/O, logging, retry logic | Contain business rules |

## Testing Patterns

```typescript
// Service test with mock repository
describe('MyService', () => {
  it('should process entity', async () => {
    const mockRepo = {
      findById: vi.fn().mockResolvedValue(new MyEntity('test', 'ready')),
      save: vi.fn(),
    };
    const service = new MyService(mockRepo, new MockLogger());

    const result = await service.process('test');

    expect(result.status).toBe('done');
  });
});
```

**Key practices:**
- Use `beforeEach`/`afterEach` for test isolation
- Mock `console.log`, `process.exit` in CLI tests
- Use unique temp directories per test file
- Test behavior, not implementation

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

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `HERMES_CODING_WORKSPACE` | Override workspace directory |
| `CI` | Set to `true` for CI/test mode |
