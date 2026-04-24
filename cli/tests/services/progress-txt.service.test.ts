import { describe, it, expect, beforeEach } from 'vitest';
import { MockFileSystem } from '../../src/test-utils';
import {
  getProgressTxtPath,
  getSagaLogPath,
  getTaskProgressPath,
  appendToProjectProgress,
  appendToTaskProgress,
  appendSagaActivityLine,
} from '../../src/services/progress-txt.service';

describe('progress-txt.service', () => {
  const workspaceDir = '/ws';
  let fs: MockFileSystem;

  beforeEach(() => {
    fs = new MockFileSystem();
  });

  // ---------------------------------------------------------------------------
  // Path helpers
  // ---------------------------------------------------------------------------

  it('getProgressTxtPath', () => {
    expect(getProgressTxtPath(workspaceDir)).toBe('/ws/.hermes-coding/progress.txt');
  });

  it('getSagaLogPath', () => {
    expect(getSagaLogPath(workspaceDir)).toBe('/ws/.hermes-coding/saga.log');
  });

  it('getTaskProgressPath', () => {
    expect(getTaskProgressPath(workspaceDir, 'auth.login', 'auth')).toBe(
      '/ws/.hermes-coding/tasks/auth/auth.login.progress.txt'
    );
  });

  // ---------------------------------------------------------------------------
  // appendToProjectProgress
  // ---------------------------------------------------------------------------

  describe('appendToProjectProgress', () => {
    it('should create progress file if missing and append timestamped line', async () => {
      await appendToProjectProgress(fs, workspaceDir, 'discovered hidden constraint');

      const content = await fs.readFile(getProgressTxtPath(workspaceDir), 'utf-8');
      expect(content).toContain('# Project Progress');
      expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T.*\] discovered hidden constraint/);
    });

    it('should append to existing progress file', async () => {
      await appendToProjectProgress(fs, workspaceDir, 'first learning');
      await appendToProjectProgress(fs, workspaceDir, 'second learning');

      const content = await fs.readFile(getProgressTxtPath(workspaceDir), 'utf-8');
      expect(content).toContain('first learning');
      expect(content).toContain('second learning');
    });
  });

  // ---------------------------------------------------------------------------
  // appendToTaskProgress
  // ---------------------------------------------------------------------------

  describe('appendToTaskProgress', () => {
    it('should create task progress file if missing and append timestamped line', async () => {
      await appendToTaskProgress(fs, workspaceDir, 'auth.login', 'auth', 'mock returns undefined not null');

      const p = getTaskProgressPath(workspaceDir, 'auth.login', 'auth');
      const content = await fs.readFile(p, 'utf-8');
      expect(content).toContain('# Task Progress: auth.login');
      expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T.*\] mock returns undefined not null/);
    });

    it('should append to existing task progress file', async () => {
      await appendToTaskProgress(fs, workspaceDir, 'auth.login', 'auth', 'first');
      await appendToTaskProgress(fs, workspaceDir, 'auth.login', 'auth', 'second');

      const p = getTaskProgressPath(workspaceDir, 'auth.login', 'auth');
      const content = await fs.readFile(p, 'utf-8');
      expect(content).toContain('first');
      expect(content).toContain('second');
    });
  });

  // ---------------------------------------------------------------------------
  // appendSagaActivityLine
  // ---------------------------------------------------------------------------

  describe('appendSagaActivityLine', () => {
    it('should append lifecycle entry to saga.log', async () => {
      await appendSagaActivityLine(fs, workspaceDir, 'STARTED', 'auth.login');

      const content = await fs.readFile(getSagaLogPath(workspaceDir), 'utf-8');
      expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T.*\] STARTED: auth\.login/);
    });

    it('should include details when provided', async () => {
      await appendSagaActivityLine(fs, workspaceDir, 'COMPLETED', 'auth.login', 'duration: 5m');

      const content = await fs.readFile(getSagaLogPath(workspaceDir), 'utf-8');
      expect(content).toMatch(/COMPLETED: auth\.login - duration: 5m/);
    });

    it('should append multiple entries', async () => {
      await appendSagaActivityLine(fs, workspaceDir, 'STARTED', 'auth.login');
      await appendSagaActivityLine(fs, workspaceDir, 'COMPLETED', 'auth.login');

      const content = await fs.readFile(getSagaLogPath(workspaceDir), 'utf-8');
      expect(content).toContain('STARTED');
      expect(content).toContain('COMPLETED');
    });
  });
});
