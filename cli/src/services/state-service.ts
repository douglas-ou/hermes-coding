/**
 * StateService - Business logic for workflow state management
 *
 * Extracts state operations from CLI commands into testable service layer.
 * Uses dependency injection for repository and logger.
 */

import * as path from 'path';
import { State, Phase, StateConfig } from '../domain/state-entity';
import { IStateRepository } from '../repositories/state-repository';
import { ILogger } from '../infrastructure/logger';
import { IFileSystem } from '../infrastructure/file-system';

export interface StateUpdate {
  phase?: Phase;
  currentTask?: string;
  prd?: any;
  addError?: any;
}

/**
 * IStateService interface for dependency injection
 */
export interface ArchiveResult {
  archived: boolean;
  archivePath: string | null;
  files: string[];
  blocked?: boolean;
  blockedReason?: string;
  currentPhase?: string;
}

export interface ArchiveOptions {
  force?: boolean;
}

export interface IStateService {
  /**
   * Get current workflow state
   */
  getState(): Promise<State | null>;

  /**
   * Initialize new workflow state
   */
  initializeState(phase?: Phase): Promise<State>;

  /**
   * Update state fields
   */
  updateState(updates: StateUpdate): Promise<State>;

  /**
   * Set current task
   */
  setCurrentTask(taskId: string | undefined): Promise<State>;

  /**
   * Clear state (delete state file)
   */
  clearState(): Promise<void>;

  /**
   * Check if state exists
   */
  exists(): Promise<boolean>;

  /**
   * Archive current session to .hermes-coding/archive/TIMESTAMP/
   * Copies state.json, prd.md, tasks/, progress.txt, debug.log
   * Then clears the state
   *
   * @param options.force - If true, archive even if session is not complete.
   *                        By default, refuses to archive incomplete sessions.
   */
  archiveSession(options?: ArchiveOptions): Promise<ArchiveResult>;
}

/**
 * StateService implementation
 */
/**
 * Convert a title string to a filesystem-safe slug.
 * e.g. "hermes-coding Architecture Refactoring" → "hermes-coding-architecture-refactoring"
 */
function slugify(text: string, maxLength = 50): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-') // keep alphanumeric and CJK, replace rest with dash
    .replace(/^-+|-+$/g, '')                    // trim leading/trailing dashes
    .slice(0, maxLength)
    .replace(/-+$/, '');                         // trim trailing dash after slice
}

/**
 * Extract a human-readable label from prd state or prd.md file content.
 */
async function extractSessionLabel(
  state: State | null,
  fileSystem: IFileSystem,
  prdPath: string
): Promise<string | null> {
  // 1) Try state.prd.title
  if (state?.prd?.title) {
    return state.prd.title;
  }

  // 2) Try first markdown heading from prd.md
  try {
    if (await fileSystem.exists(prdPath)) {
      const raw = await fileSystem.readFile(prdPath, 'utf-8');
      const content = typeof raw === 'string' ? raw : raw.toString('utf-8');
      const match = content.match(/^#\s+(.+)/m);
      if (match) {
        // Strip common prefixes like "Product Requirements Document: "
        let title = match[1].trim();
        title = title.replace(/^Product Requirements Document:\s*/i, '');
        if (title.length > 0) return title;
      }
    }
  } catch {
    // ignore read errors
  }

  return null;
}

export class StateService implements IStateService {
  constructor(
    private stateRepository: IStateRepository,
    private logger: ILogger,
    private fileSystem?: IFileSystem,
    private workspaceDir?: string
  ) {}

  async getState(): Promise<State | null> {
    this.logger.debug('Getting workflow state');
    return await this.stateRepository.get();
  }

  async initializeState(phase: Phase = 'clarify'): Promise<State> {
    this.logger.info(`Initializing workflow state`, { phase });

    // Check if state already exists
    const existing = await this.stateRepository.get();
    if (existing) {
      this.logger.warn('State already exists, returning existing state');
      return existing;
    }

    // Create new state
    const now = new Date().toISOString();
    const stateConfig: Omit<StateConfig, 'updatedAt'> = {
      phase,
      startedAt: now,
    };

    await this.stateRepository.set(stateConfig);

    const state = await this.stateRepository.get();
    if (!state) {
      throw new Error('Failed to initialize state');
    }

    this.logger.info(`Workflow state initialized`, { phase });
    return state;
  }

  async updateState(updates: StateUpdate): Promise<State> {
    this.logger.info('Updating workflow state', { updates });

    const currentState = await this.stateRepository.get();
    if (!currentState) {
      throw new Error('State not found. Initialize state first.');
    }

    // Apply updates using repository
    await this.stateRepository.update(updates);

    const updatedState = await this.stateRepository.get();
    if (!updatedState) {
      throw new Error('Failed to update state');
    }

    this.logger.info('Workflow state updated');
    return updatedState;
  }

  async setCurrentTask(taskId: string | undefined): Promise<State> {
    this.logger.info('Setting current task', { taskId });

    const currentState = await this.stateRepository.get();
    if (!currentState) {
      throw new Error('State not found. Initialize state first.');
    }

    await this.stateRepository.update({ currentTask: taskId });

    const updatedState = await this.stateRepository.get();
    if (!updatedState) {
      throw new Error('Failed to set current task');
    }

    this.logger.info('Current task set', { taskId });
    return updatedState;
  }

  async clearState(): Promise<void> {
    this.logger.info('Clearing workflow state');
    await this.stateRepository.clear();
    this.logger.info('Workflow state cleared');
  }

  async exists(): Promise<boolean> {
    return await this.stateRepository.exists();
  }

  async archiveSession(options: ArchiveOptions = {}): Promise<ArchiveResult> {
    if (!this.fileSystem || !this.workspaceDir) {
      throw new Error('FileSystem and workspaceDir are required for archiveSession');
    }

    this.logger.info('Archiving session');

    const hermesCodingDir = path.join(this.workspaceDir, '.hermes-coding');
    const archivedFiles: string[] = [];

    // Check if there's anything to archive
    const hasState = await this.stateRepository.exists();
    const hasPrd = await this.fileSystem.exists(path.join(hermesCodingDir, 'prd.md'));
    const hasTasksDir = await this.fileSystem.exists(path.join(hermesCodingDir, 'tasks'));

    if (!hasState && !hasPrd && !hasTasksDir) {
      this.logger.info('No session data to archive');
      return {
        archived: false,
        archivePath: null,
        files: [],
      };
    }

    // Safety check: refuse to archive incomplete sessions unless --force is used
    if (hasState && !options.force) {
      const currentState = await this.stateRepository.get();
      if (currentState) {
        const completablePhases = ['complete', 'none'];
        if (!completablePhases.includes(currentState.phase)) {
          this.logger.warn('Refusing to archive incomplete session', {
            phase: currentState.phase,
            hint: 'Use --force to archive anyway',
          });
          return {
            archived: false,
            archivePath: null,
            files: [],
            blocked: true,
            blockedReason: `Session is in "${currentState.phase}" phase. Use --force to archive incomplete session.`,
            currentPhase: currentState.phase,
          };
        }
      }
    }

    // Build a meaningful archive folder name: <slug>_<datetime> or just <datetime>
    const currentState = hasState ? await this.stateRepository.get() : null;
    const prdPath = path.join(hermesCodingDir, 'prd.md');
    const label = await extractSessionLabel(currentState, this.fileSystem, prdPath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const folderName = label ? `${slugify(label)}_${timestamp}` : timestamp;
    const archiveDir = path.join(hermesCodingDir, 'archive', folderName);
    await this.fileSystem.ensureDir(archiveDir);

    // Files to archive
    const filesToArchive = [
      { src: 'state.json', name: 'state.json' },
      { src: 'prd.md', name: 'prd.md' },
      { src: 'tasks', name: 'tasks' },
      { src: 'context', name: 'context' },
      { src: 'progress.txt', name: 'progress.txt' },
      { src: 'debug.log', name: 'debug.log' },
    ];

    // Copy each file/directory if it exists
    for (const file of filesToArchive) {
      const srcPath = path.join(hermesCodingDir, file.src);
      const destPath = path.join(archiveDir, file.name);

      if (await this.fileSystem.exists(srcPath)) {
        await this.fileSystem.copy(srcPath, destPath);
        archivedFiles.push(file.name);
        this.logger.debug(`Archived: ${file.name}`);
      }
    }

    // Clear state after archiving
    if (hasState) {
      await this.stateRepository.clear();
    }

    // Remove prd.md after archiving
    if (hasPrd) {
      await this.fileSystem.remove(path.join(hermesCodingDir, 'prd.md'));
    }

    // Remove tasks directory after archiving
    if (hasTasksDir) {
      await this.fileSystem.remove(path.join(hermesCodingDir, 'tasks'));
    }

    // Remove context directory after archiving
    const contextDir = path.join(hermesCodingDir, 'context');
    if (await this.fileSystem.exists(contextDir)) {
      await this.fileSystem.remove(contextDir);
    }

    const progressTxt = path.join(hermesCodingDir, 'progress.txt');
    const debugLog = path.join(hermesCodingDir, 'debug.log');
    if (await this.fileSystem.exists(progressTxt)) {
      await this.fileSystem.remove(progressTxt);
    }
    if (await this.fileSystem.exists(debugLog)) {
      await this.fileSystem.remove(debugLog);
    }

    this.logger.info('Session archived', { archiveDir, files: archivedFiles });

    return {
      archived: true,
      archivePath: archiveDir,
      files: archivedFiles,
    };
  }
}
