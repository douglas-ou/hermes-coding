import { describe, it, expect } from 'vitest';
import {
  normalizeTaskDependencyIds,
  normalizeDependencyInput,
} from '../../src/core/task-dependencies';

describe('task-dependencies', () => {
  describe('normalizeTaskDependencyIds', () => {
    it('should split comma-separated tokens and trim', () => {
      expect(normalizeTaskDependencyIds(['a.b, c.d', 'e.f'])).toEqual(['a.b', 'c.d', 'e.f']);
    });

    it('should dedupe while preserving first occurrence order', () => {
      expect(normalizeTaskDependencyIds(['x', 'x, y', 'y'])).toEqual(['x', 'y']);
    });

    it('should return empty array for empty or whitespace-only input', () => {
      expect(normalizeTaskDependencyIds([])).toEqual([]);
      expect(normalizeTaskDependencyIds(['', '  ', ',,'])).toEqual([]);
    });
  });

  describe('normalizeDependencyInput', () => {
    it('should normalize string and array YAML shapes', () => {
      expect(normalizeDependencyInput('a, b')).toEqual(['a', 'b']);
      expect(normalizeDependencyInput(['x, y', 'z'])).toEqual(['x', 'y', 'z']);
      expect(normalizeDependencyInput(null)).toEqual([]);
      expect(normalizeDependencyInput(undefined)).toEqual([]);
      expect(normalizeDependencyInput(42)).toEqual([]);
    });
  });
});
