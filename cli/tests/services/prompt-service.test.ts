import { describe, it, expect } from 'vitest';
import { PromptService } from '../../src/services/prompt-service';
import { Task } from '../../src/domain/task-entity';
import { TaskContext } from '../../src/services/context-service';

describe('PromptService', () => {
  const service = new PromptService();

  const task = new Task({
    id: 'auth.login',
    module: 'auth',
    priority: 1,
    status: 'in_progress',
    estimatedMinutes: 30,
    description: 'Implement login',
    acceptanceCriteria: ['User can log in', 'Errors are shown for invalid credentials'],
    dependencies: ['setup.db'],
    notes: 'Use JWT',
  });

  const context: TaskContext = {
    currentDirectory: '/workspace',
    git: {
      branch: 'feature/auth',
      recentCommits: [
        { hash: 'abc123', message: 'Add auth shell', time: '2 hours ago' },
        { hash: 'def456', message: 'Refactor session store', time: '1 day ago' },
      ],
    },
    state: { phase: 'implement' },
    progress: {
      completed: 2,
      failed: 1,
      inProgress: 1,
      pending: 3,
      total: 7,
      percentage: 29,
    },
    recentActivity: [],
    dependencyStatus: [
      { id: 'setup.db', status: 'completed', satisfied: true },
    ],
  };

  it('renders a complete prompt with all sections', () => {
    const prompt = service.renderImplementerPrompt({
      task,
      taskFileContent: `---
id: auth.login
module: auth
priority: 1
status: in_progress
---

# Implement login
`,
      context,
      projectProgress: '# Project Progress\n[2026-01-01] learned a thing',
      taskProgress: '# Task Progress: auth.login\n[2026-01-01] tried an approach',
      prdPath: '.hermes-coding/prd.md',
    });

    expect(prompt).toContain('# Role');
    expect(prompt).toContain('You are an implementer agent for task `auth.login`');
    expect(prompt).toContain('# Context');
    expect(prompt).toContain('- Git branch: feature/auth');
    expect(prompt).toContain('- Dependency status: setup.db=completed');
    expect(prompt).toContain('# Task Spec');
    expect(prompt).toContain('```markdown');
    expect(prompt).toContain('# Prior Learnings');
    expect(prompt).toContain('## Project Progress');
    expect(prompt).toContain('## Task Progress');
    expect(prompt).toContain('# PRD Context');
    expect(prompt).toContain('.hermes-coding/prd.md');
    expect(prompt).toContain('# TDD Protocol');
    expect(prompt).toContain('Always run tests with `CI=true`');
    expect(prompt).toContain('# Progress Writing');
    expect(prompt).toContain('hermes-coding progress append --task auth.login');
    expect(prompt).toContain('# Completion');
    expect(prompt).toContain('Do NOT call `hermes-coding tasks complete auth.login` yourself.');
    expect(prompt).toContain('The parent Phase 3 orchestrator will commit, verify acceptance criteria, and mark completion.');
    expect(prompt).toContain('# Constraints');
    expect(prompt).toContain('Do NOT spawn sub-agents');
  });

  it('handles missing optional fields while keeping required sections', () => {
    const prompt = service.renderImplementerPrompt({
      task,
      taskFileContent: '# Task',
      context,
      projectProgress: null,
      taskProgress: null,
      prdPath: null,
    });

    expect(prompt).toContain('# Prior Learnings');
    expect(prompt).toContain('No prior progress logs were found.');
    expect(prompt).toContain('# PRD Context');
    expect(prompt).toContain('No PRD context was found.');
    expect(prompt).toContain('# TDD Protocol');
    expect(prompt).toContain('# Constraints');
  });

  it('renders PRD file reference when path is provided', () => {
    const prompt = service.renderImplementerPrompt({
      task,
      taskFileContent: '# Task',
      context,
      projectProgress: null,
      taskProgress: null,
      prdPath: '.hermes-coding/prd.md',
    });

    expect(prompt).toContain('# PRD Context');
    expect(prompt).toContain('.hermes-coding/prd.md');
    expect(prompt).toContain('Read it when you need product requirements');
    expect(prompt).not.toContain('No PRD context was found.');
  });
});
