import { describe, it, expect, beforeEach } from 'vitest';
import { State, StateConfig, Phase } from '../../src/domain/state-entity';

describe('State Domain Entity', () => {
  let baseConfig: StateConfig;

  beforeEach(() => {
    baseConfig = {
      phase: 'clarify',
      startedAt: '2026-01-20T10:00:00.000Z',
      updatedAt: '2026-01-20T10:00:00.000Z',
    };
  });

  describe('constructor', () => {
    it('should create state with all fields', () => {
      const config: StateConfig = {
        phase: 'implement',
        currentTask: 'test.task',
        prd: { title: 'Test PRD' },
        errors: [{ message: 'Error 1' }],
        startedAt: '2026-01-20T10:00:00.000Z',
        updatedAt: '2026-01-20T10:30:00.000Z',
      };

      const state = new State(config);

      expect(state.phase).toBe('implement');
      expect(state.currentTask).toBe('test.task');
      expect(state.prd).toEqual({ title: 'Test PRD' });
      expect(state.errors).toEqual([{ message: 'Error 1' }]);
      expect(state.startedAt).toBeInstanceOf(Date);
      expect(state.updatedAt).toBeInstanceOf(Date);
    });

    it('should parse timestamp strings to Date objects', () => {
      const config: StateConfig = {
        phase: 'clarify',
        startedAt: '2026-01-20T10:00:00.000Z',
        updatedAt: '2026-01-20T10:30:00.000Z',
      };

      const state = new State(config);

      expect(state.startedAt.toISOString()).toBe('2026-01-20T10:00:00.000Z');
      expect(state.updatedAt.toISOString()).toBe('2026-01-20T10:30:00.000Z');
    });

    it('should initialize empty errors array if not provided', () => {
      const state = new State(baseConfig);
      expect(state.errors).toEqual([]);
    });
  });

  describe('canTransitionTo', () => {
    it('should allow clarify → breakdown', () => {
      const state = new State({ ...baseConfig, phase: 'clarify' });
      expect(state.canTransitionTo('breakdown')).toBe(true);
    });

    it('should allow breakdown → implement', () => {
      const state = new State({ ...baseConfig, phase: 'breakdown' });
      expect(state.canTransitionTo('implement')).toBe(true);
    });

    it('should allow implement → deliver', () => {
      const state = new State({ ...baseConfig, phase: 'implement' });
      expect(state.canTransitionTo('deliver')).toBe(true);
    });

    it('should allow deliver → complete', () => {
      const state = new State({ ...baseConfig, phase: 'deliver' });
      expect(state.canTransitionTo('complete')).toBe(true);
    });

    it('should NOT allow clarify → implement (skipping breakdown)', () => {
      const state = new State({ ...baseConfig, phase: 'clarify' });
      expect(state.canTransitionTo('implement')).toBe(false);
    });

    it('should NOT allow breakdown → deliver (skipping implement)', () => {
      const state = new State({ ...baseConfig, phase: 'breakdown' });
      expect(state.canTransitionTo('deliver')).toBe(false);
    });

    it('should NOT allow backward transition (deliver → implement)', () => {
      const state = new State({ ...baseConfig, phase: 'deliver' });
      expect(state.canTransitionTo('implement')).toBe(false);
    });

    it('should NOT allow transition from complete phase', () => {
      const state = new State({ ...baseConfig, phase: 'complete' });
      expect(state.canTransitionTo('clarify')).toBe(false);
      expect(state.canTransitionTo('implement')).toBe(false);
      expect(state.canTransitionTo('deliver')).toBe(false);
    });

    it('should allow idempotent transition (same phase)', () => {
      const phases: Phase[] = ['clarify', 'breakdown', 'implement', 'deliver', 'complete'];
      for (const phase of phases) {
        const state = new State({ ...baseConfig, phase });
        expect(state.canTransitionTo(phase)).toBe(true);
      }
    });
  });

  describe('transitionTo', () => {
    it('should update timestamp on idempotent transition (same phase)', () => {
      const state = new State({ ...baseConfig, phase: 'implement' });
      const originalTimestamp = state.updatedAt.toISOString();
      state.transitionTo('implement');
      expect(state.phase).toBe('implement');
      expect(state.updatedAt.toISOString()).not.toBe(originalTimestamp);
    });

    it('should transition from clarify to breakdown', () => {
      const state = new State({ ...baseConfig, phase: 'clarify' });
      state.transitionTo('breakdown');
      expect(state.phase).toBe('breakdown');
    });

    it('should update timestamp on transition', () => {
      const state = new State({ ...baseConfig, phase: 'clarify' });
      const originalTimestamp = state.updatedAt.toISOString();
      state.transitionTo('breakdown');
      expect(state.updatedAt.toISOString()).not.toBe(originalTimestamp);
    });

    it('should throw error on invalid transition', () => {
      const state = new State({ ...baseConfig, phase: 'clarify' });
      expect(() => state.transitionTo('implement')).toThrow(
        'Invalid phase transition: clarify → implement. Allowed transitions from clarify: breakdown'
      );
    });

    it('should throw error on backward transition', () => {
      const state = new State({ ...baseConfig, phase: 'deliver' });
      expect(() => state.transitionTo('implement')).toThrow(
        'Invalid phase transition: deliver → implement'
      );
    });

    it('should throw error when transitioning from complete', () => {
      const state = new State({ ...baseConfig, phase: 'complete' });
      expect(() => state.transitionTo('clarify')).toThrow(
        'Invalid phase transition: complete → clarify. Allowed transitions from complete: none'
      );
    });
  });

  describe('setCurrentTask', () => {
    it('should set current task', () => {
      const state = new State({ ...baseConfig });
      state.setCurrentTask('test.task');
      expect(state.currentTask).toBe('test.task');
    });

    it('should clear current task when undefined', () => {
      const state = new State({ ...baseConfig, currentTask: 'old.task' });
      state.setCurrentTask(undefined);
      expect(state.currentTask).toBeUndefined();
    });

    it('should update timestamp', () => {
      const state = new State({ ...baseConfig });
      const originalTimestamp = state.updatedAt.toISOString();
      state.setCurrentTask('test.task');
      expect(state.updatedAt.toISOString()).not.toBe(originalTimestamp);
    });
  });

  describe('setPrd', () => {
    it('should set PRD', () => {
      const state = new State({ ...baseConfig });
      const prd = { title: 'Test PRD', userStories: ['story1', 'story2'] };
      state.setPrd(prd);
      expect(state.prd).toEqual(prd);
    });

    it('should update timestamp', () => {
      const state = new State({ ...baseConfig });
      const originalTimestamp = state.updatedAt.toISOString();
      state.setPrd({ title: 'Test' });
      expect(state.updatedAt.toISOString()).not.toBe(originalTimestamp);
    });
  });

  describe('addError', () => {
    it('should add error to errors array', () => {
      const state = new State({ ...baseConfig });
      const error = { message: 'Test error', code: 'TEST' };
      state.addError(error);
      expect(state.errors).toContainEqual(error);
    });

    it('should append to existing errors', () => {
      const state = new State({ ...baseConfig, errors: [{ message: 'Error 1' }] });
      state.addError({ message: 'Error 2' });
      expect(state.errors).toHaveLength(2);
      expect(state.errors[0]).toEqual({ message: 'Error 1' });
      expect(state.errors[1]).toEqual({ message: 'Error 2' });
    });

    it('should update timestamp', () => {
      const state = new State({ ...baseConfig });
      const originalTimestamp = state.updatedAt.toISOString();
      state.addError({ message: 'Error' });
      expect(state.updatedAt.toISOString()).not.toBe(originalTimestamp);
    });
  });

  describe('clearErrors', () => {
    it('should clear all errors', () => {
      const state = new State({
        ...baseConfig,
        errors: [{ message: 'Error 1' }, { message: 'Error 2' }],
      });
      state.clearErrors();
      expect(state.errors).toEqual([]);
    });

    it('should update timestamp', () => {
      const state = new State({ ...baseConfig, errors: [{ message: 'Error' }] });
      const originalTimestamp = state.updatedAt.toISOString();
      state.clearErrors();
      expect(state.updatedAt.toISOString()).not.toBe(originalTimestamp);
    });
  });

  describe('getNextAllowedPhases', () => {
    it('should return [breakdown] for clarify', () => {
      const state = new State({ ...baseConfig, phase: 'clarify' });
      expect(state.getNextAllowedPhases()).toEqual(['breakdown']);
    });

    it('should return [deliver] for implement', () => {
      const state = new State({ ...baseConfig, phase: 'implement' });
      expect(state.getNextAllowedPhases()).toEqual(['deliver']);
    });

    it('should return [] for complete', () => {
      const state = new State({ ...baseConfig, phase: 'complete' });
      expect(state.getNextAllowedPhases()).toEqual([]);
    });
  });

  describe('toJSON', () => {
    it('should serialize all fields to plain object', () => {
      const config: StateConfig = {
        phase: 'implement',
        currentTask: 'test.task',
        prd: { title: 'Test' },
        errors: [{ message: 'Error' }],
        startedAt: '2026-01-20T10:00:00.000Z',
        updatedAt: '2026-01-20T10:30:00.000Z',
      };
      const state = new State(config);
      const result = state.toJSON();
      expect(result).toEqual(config);
    });

    it('should convert Date objects to ISO strings', () => {
      const state = State.createNew();
      const result = state.toJSON();
      expect(typeof result.startedAt).toBe('string');
      expect(typeof result.updatedAt).toBe('string');
      expect(result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should return copy of errors array', () => {
      const state = new State({ ...baseConfig, errors: [{ message: 'Error' }] });
      const result = state.toJSON();
      result.errors!.push({ message: 'Modified' });
      expect(state.errors).toHaveLength(1);
      expect(result.errors).toHaveLength(2);
    });
  });

  describe('fromJSON', () => {
    it('should create State from plain object', () => {
      const config: StateConfig = {
        phase: 'implement',
        currentTask: 'test.task',
        startedAt: '2026-01-20T10:00:00.000Z',
        updatedAt: '2026-01-20T10:30:00.000Z',
      };
      const state = State.fromJSON(config);
      expect(state).toBeInstanceOf(State);
      expect(state.phase).toBe('implement');
      expect(state.currentTask).toBe('test.task');
    });

    it('should round-trip through toJSON and fromJSON', () => {
      const state1 = State.createNew();
      state1.transitionTo('breakdown');
      state1.setCurrentTask('test.task');
      state1.setPrd({ title: 'Test' });
      const json = state1.toJSON();
      const state2 = State.fromJSON(json);
      expect(state2.phase).toBe('breakdown');
      expect(state2.currentTask).toBe('test.task');
      expect(state2.prd).toEqual({ title: 'Test' });
    });
  });

  describe('createNew', () => {
    it('should create state in clarify phase', () => {
      const state = State.createNew();
      expect(state.phase).toBe('clarify');
    });

    it('should initialize with current timestamps', () => {
      const before = new Date();
      const state = State.createNew();
      const after = new Date();
      expect(state.startedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(state.startedAt.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(state.updatedAt.getTime()).toBe(state.startedAt.getTime());
    });
  });

  describe('workflow integration', () => {
    it('should support full workflow: clarify → breakdown → implement → deliver → complete', () => {
      const state = State.createNew();
      expect(state.phase).toBe('clarify');
      state.transitionTo('breakdown');
      expect(state.phase).toBe('breakdown');
      state.transitionTo('implement');
      expect(state.phase).toBe('implement');
      state.transitionTo('deliver');
      expect(state.phase).toBe('deliver');
      state.transitionTo('complete');
      expect(state.phase).toBe('complete');
    });
  });
});
