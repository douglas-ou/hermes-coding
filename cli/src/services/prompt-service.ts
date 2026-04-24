import { Task } from '../domain/task-entity';
import { TaskContext } from './context-service';

export interface PromptInput {
  task: Task;
  taskFileContent: string;
  context: TaskContext;
  projectProgress: string | null;
  taskProgress: string | null;
  prdContent: string | null;
}

export interface IPromptService {
  renderImplementerPrompt(input: PromptInput): string;
}

const PRD_LIMIT = 10000;

export class PromptService implements IPromptService {
  renderImplementerPrompt(input: PromptInput): string {
    const { task } = input;
    const sections = [
      this.renderRole(task),
      this.renderContext(input),
      this.renderTaskSpec(input.taskFileContent),
      this.renderPriorLearnings(input),
      this.renderPrd(input.prdContent),
      this.renderTddProtocol(),
      this.renderProgressWriting(task),
      this.renderCompletion(task),
      this.renderConstraints(),
    ];

    return `${sections.join('\n\n')}\n`;
  }

  private renderRole(task: Task): string {
    return [
      '# Role',
      '',
      `You are an implementer agent for task \`${task.id}\` in a hermes-coding workflow.`,
    ].join('\n');
  }

  private renderContext(input: PromptInput): string {
    const { context, task } = input;
    const lines = [
      '# Context',
      '',
      `- Workspace: ${context.currentDirectory}`,
    ];

    if (context.git.branch) {
      lines.push(`- Git branch: ${context.git.branch}`);
    } else if (context.git.error) {
      lines.push(`- Git: ${context.git.error}`);
    } else {
      lines.push('- Git branch: unknown');
    }

    if (context.git.recentCommits && context.git.recentCommits.length > 0) {
      lines.push('- Recent commits:');
      context.git.recentCommits.forEach((commit) => {
        lines.push(`  - ${commit.hash} ${commit.message} (${commit.time})`);
      });
    } else {
      lines.push('- Recent commits: none available');
    }

    if (context.state?.phase) {
      lines.push(`- Phase: ${context.state.phase}`);
    }

    const progress = context.progress;
    lines.push(
      `- Progress: ${progress.completed}/${progress.total} tasks completed (${progress.percentage}%)`,
      `- Task status: ${task.status}`,
      `- Dependency status: ${this.renderDependencySummary(context)}`
    );

    return lines.join('\n');
  }

  private renderDependencySummary(context: TaskContext): string {
    if (!context.dependencyStatus || context.dependencyStatus.length === 0) {
      return 'No dependencies';
    }

    return context.dependencyStatus
      .map((dep) => `${dep.id}=${dep.status}${dep.satisfied ? '' : ' (unsatisfied)'}`)
      .join(', ');
  }

  private renderTaskSpec(taskFileContent: string): string {
    return ['# Task Spec', '', '```markdown', taskFileContent.trimEnd(), '```'].join('\n');
  }

  private renderPriorLearnings(input: PromptInput): string {
    const sections = ['# Prior Learnings'];

    if (input.projectProgress?.trim()) {
      sections.push('', '## Project Progress', '', input.projectProgress.trimEnd());
    }

    if (input.taskProgress?.trim()) {
      sections.push('', '## Task Progress', '', input.taskProgress.trimEnd());
    }

    if (sections.length === 1) {
      sections.push('', 'No prior progress logs were found.');
    }

    return sections.join('\n');
  }

  private renderPrd(prdContent: string | null): string {
    if (!prdContent?.trim()) {
      return ['# PRD Context', '', 'No PRD context was found.'].join('\n');
    }

    const trimmed = prdContent.trimEnd();
    const truncated = trimmed.length > PRD_LIMIT
      ? `${trimmed.slice(0, PRD_LIMIT)}\n\n[PRD truncated at ${PRD_LIMIT} characters]`
      : trimmed;

    return ['# PRD Context', '', truncated].join('\n');
  }

  private renderTddProtocol(): string {
    return [
      '# TDD Protocol',
      '',
      '- Write failing tests first.',
      '- Implement only enough production code to make the tests pass.',
      '- If tests fail, analyze the root cause and fix it in this same agent context.',
      '- Repeat until tests pass or you determine the task cannot be completed.',
      '- Always run tests with `CI=true` to avoid interactive hangs.',
      '',
      'After each test run, before moving on:',
      '- If tests failed unexpectedly → record why in task progress (see Progress Writing)',
      '- If you had to change your approach → record what failed and why',
      '- If you discovered a hidden dependency → record it immediately',
    ].join('\n');
  }

  private renderProgressWriting(task: Task): string {
    return [
      '# Progress Writing',
      '',
      '## When to write',
      '',
      'Write IMMEDIATELY when any of these happen — do not wait until the end:',
      '- An approach you tried failed (record what and why)',
      '- You discover a hidden dependency or non-obvious constraint',
      '- Your expectation about the codebase was wrong (what you assumed vs reality)',
      '- You find a non-obvious pattern that works',
      '- You hit a risk that is unresolved and could affect other tasks',
      '',
      '## What to write',
      '',
      'Each entry must answer: "If the next agent does not know this, will they waste time?"',
      'If the answer is not clearly yes, do not write it.',
      '',
      'Good: "Module X requires Y to be initialized first — otherwise Z throws NPE"',
      'Good: "Tried mocking A directly — fails because B intercepts; must mock at B level"',
      'Good: "Config file at path/to/config is not auto-reloaded; restart required after changes"',
      'Bad: "Implemented the function" (process log, not decision info)',
      'Bad: "Tests pass" (obvious, no decision value)',
      'Bad: "Read file X" (activity trace, not a learning)',
      '',
      '## Command',
      '',
      `\`hermes-coding progress append --task ${task.id} "your learning"\``,
    ].join('\n');
  }

  private renderCompletion(task: Task): string {
    return [
      '# Completion',
      '',
      `Do NOT call \`hermes-coding tasks complete ${task.id}\` yourself.`,
      'Leave the task in `in_progress` when implementation and local validation are done.',
      'The parent Phase 3 orchestrator will commit, verify acceptance criteria, and mark completion.',
      `If blocked or stuck, call \`hermes-coding tasks fail ${task.id} --reason "clear reason"\`.`,
      'Do not mark the task completed just because code compiles or local tests pass.',
    ].join('\n');
  }

  private renderConstraints(): string {
    return [
      '# Constraints',
      '',
      '- Do NOT spawn sub-agents.',
      '- Do NOT work on multiple tasks.',
      '- Work on this one task only.',
      '- Always use `CI=true` when running tests.',
      '- Do not mark unrelated tasks complete or failed.',
    ].join('\n');
  }
}
