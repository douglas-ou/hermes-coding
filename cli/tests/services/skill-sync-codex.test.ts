import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { rewriteSpawnSyntaxForCodex } from '../../src/services/skill-sync.service';

describe('rewriteSpawnSyntaxForCodex', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-sync-test-'));
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  function writeFile(relativePath: string, content: string): string {
    const fullPath = path.join(tempDir, relativePath);
    fs.ensureDirSync(path.dirname(fullPath));
    fs.writeFileSync(fullPath, content, 'utf-8');
    return fullPath;
  }

  function readFile(relativePath: string): string {
    return fs.readFileSync(path.join(tempDir, relativePath), 'utf-8');
  }

  it('should transform Tool: Task to Tool: spawn_agent', () => {
    writeFile('test-skill/phase.md', [
      '```',
      'Tool: Task',
      'Parameters:',
      '  subagent_type: "general-purpose"',
      '  description: "Run baseline tests"',
      '  prompt: |',
      '    Do the thing.',
      '  run_in_background: false',
      '```',
    ].join('\n'));

    rewriteSpawnSyntaxForCodex(tempDir);

    const result = readFile('test-skill/phase.md');
    expect(result).toContain('Tool: spawn_agent');
    expect(result).not.toContain('Tool: Task');
  });

  it('should transform Tool: Agent (or Task) variant', () => {
    writeFile('test-skill/SKILL.md', [
      'Tool: Agent (or Task)',
      'Parameters:',
      '  subagent_type: "general-purpose"',
      '  description: "Execute phase"',
      '  prompt: |',
      '    Content here.',
      '  run_in_background: false',
    ].join('\n'));

    rewriteSpawnSyntaxForCodex(tempDir);

    const result = readFile('test-skill/SKILL.md');
    expect(result).toContain('Tool: spawn_agent');
    expect(result).not.toContain('Tool: Agent');
  });

  it('should remove subagent_type lines', () => {
    writeFile('test-skill/phase.md', [
      'Tool: Task',
      'Parameters:',
      '  subagent_type: "general-purpose"',
      '  description: "Test"',
      '  prompt: "hello"',
      '  run_in_background: false',
    ].join('\n'));

    rewriteSpawnSyntaxForCodex(tempDir);

    const result = readFile('test-skill/phase.md');
    expect(result).not.toContain('subagent_type');
  });

  it('should rename indented description to task_name', () => {
    writeFile('test-skill/phase.md', [
      'Tool: Task',
      'Parameters:',
      '  description: "Run baseline tests"',
      '  prompt: |',
      '    Do the thing.',
    ].join('\n'));

    rewriteSpawnSyntaxForCodex(tempDir);

    const result = readFile('test-skill/phase.md');
    expect(result).toContain('task_name: "Run baseline tests"');
    // Should NOT match unindented frontmatter description
    expect(result).not.toContain('  description:');
  });

  it('should insert fork_turns: "none" after task_name line', () => {
    writeFile('test-skill/phase.md', [
      'Tool: Task',
      'Parameters:',
      '  description: "Run tests"',
      '  prompt: |',
      '    Do the thing.',
    ].join('\n'));

    rewriteSpawnSyntaxForCodex(tempDir);

    const result = readFile('test-skill/phase.md');
    expect(result).toContain('  task_name: "Run tests"\n  fork_turns: "none"');
  });

  it('should rename indented prompt to message', () => {
    writeFile('test-skill/phase.md', [
      'Tool: Task',
      'Parameters:',
      '  description: "Test"',
      '  prompt: |',
      '    Read the skill file.',
      '  run_in_background: false',
    ].join('\n'));

    rewriteSpawnSyntaxForCodex(tempDir);

    const result = readFile('test-skill/phase.md');
    expect(result).toContain('  message: |');
    expect(result).not.toContain('  prompt:');
  });

  it('should remove run_in_background lines', () => {
    writeFile('test-skill/phase.md', [
      'Tool: Task',
      'Parameters:',
      '  subagent_type: "general-purpose"',
      '  description: "Test"',
      '  prompt: "hello"',
      '  run_in_background: false',
    ].join('\n'));

    rewriteSpawnSyntaxForCodex(tempDir);

    const result = readFile('test-skill/phase.md');
    expect(result).not.toContain('run_in_background');
  });

  it('should NOT rename frontmatter description (no indent)', () => {
    const frontmatter = [
      '---',
      'name: test-skill',
      'description: \'This is the skill description for frontmatter\'',
      'allowed-tools: [Task, Read, Write, Bash]',
      '---',
      '',
      '# Skill content',
      '',
      '```',
      'Tool: Task',
      'Parameters:',
      '  subagent_type: "general-purpose"',
      '  description: "Spawn block description"',
      '  prompt: |',
      '    Do the thing.',
      '  run_in_background: false',
      '```',
    ].join('\n');

    writeFile('test-skill/SKILL.md', frontmatter);

    rewriteSpawnSyntaxForCodex(tempDir);

    const result = readFile('test-skill/SKILL.md');
    // Frontmatter description must be preserved
    expect(result).toContain("description: 'This is the skill description for frontmatter'");
    // Spawn block description must be renamed
    expect(result).toContain('task_name: "Spawn block description"');
  });

  it('should rewrite Task to spawn_agent in allowed-tools frontmatter', () => {
    const frontmatter = [
      '---',
      'name: test-skill',
      'description: "Test skill"',
      'allowed-tools: [Task, Read, Write, Bash, Grep, Glob]',
      '---',
    ].join('\n');

    writeFile('test-skill/SKILL.md', frontmatter);

    rewriteSpawnSyntaxForCodex(tempDir);

    const result = readFile('test-skill/SKILL.md');
    expect(result).toContain('allowed-tools: [spawn_agent, Read, Write, Bash, Grep, Glob]');
    expect(result).not.toContain('[Task,');
  });

  it('should rewrite Task to spawn_agent in HTML comment Tools declaration', () => {
    writeFile('test-skill/phase.md', [
      '<!-- Phase 3 | Tools: Read, Write, Bash, Task, Grep, Glob | Interactive: no -->',
      '',
      '# Phase 3',
    ].join('\n'));

    rewriteSpawnSyntaxForCodex(tempDir);

    const result = readFile('test-skill/phase.md');
    expect(result).toContain('spawn_agent');
    expect(result).not.toMatch(/Tools:.*\bTask\b/);
  });

  it('should handle multiple spawn blocks in one file', () => {
    const content = [
      '# Phase 3',
      '',
      '## Step 1',
      '```',
      'Tool: Task',
      'Parameters:',
      '  subagent_type: "general-purpose"',
      '  description: "Run baseline"',
      '  prompt: |',
      '    Baseline content.',
      '  run_in_background: false',
      '```',
      '',
      '## Step 2',
      '```',
      'Tool: Task',
      'Parameters:',
      '  subagent_type: "general-purpose"',
      '  description: "Implement task"',
      '  prompt: "{IMPLEMENTER_PROMPT}"',
      '  run_in_background: false',
      '```',
    ].join('\n');

    writeFile('test-skill/phase.md', content);

    rewriteSpawnSyntaxForCodex(tempDir);

    const result = readFile('test-skill/phase.md');
    // Both blocks should be transformed
    const spawnCount = (result.match(/Tool: spawn_agent/g) || []).length;
    expect(spawnCount).toBe(2);
    expect(result).toContain('task_name: "Run baseline"');
    expect(result).toContain('task_name: "Implement task"');
    expect(result).toContain('fork_turns: "none"');
    // No leftover Claude syntax
    expect(result).not.toContain('subagent_type');
    expect(result).not.toContain('run_in_background');
  });

  it('should leave files without spawn blocks unchanged', () => {
    const content = [
      '# Simple file',
      '',
      'No spawn blocks here.',
      'Just plain text.',
    ].join('\n');

    writeFile('test-skill/readme.md', content);

    rewriteSpawnSyntaxForCodex(tempDir);

    const result = readFile('test-skill/readme.md');
    expect(result).toBe(content);
  });

  it('should process files in nested directories', () => {
    writeFile('nested/dir/skill.md', [
      'Tool: Task',
      'Parameters:',
      '  description: "Nested test"',
      '  prompt: "hello"',
    ].join('\n'));

    rewriteSpawnSyntaxForCodex(tempDir);

    const result = readFile('nested/dir/skill.md');
    expect(result).toContain('Tool: spawn_agent');
    expect(result).toContain('task_name: "Nested test"');
  });

  it('should skip non-text files', () => {
    const binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const fullPath = path.join(tempDir, 'images', 'icon.png');
    fs.ensureDirSync(path.dirname(fullPath));
    fs.writeFileSync(fullPath, binaryContent);

    rewriteSpawnSyntaxForCodex(tempDir);

    // Should not throw and file should be unchanged
    const result = fs.readFileSync(fullPath);
    expect(result).toEqual(binaryContent);
  });
});
