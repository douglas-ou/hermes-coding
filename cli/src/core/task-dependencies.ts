/**
 * Normalize task dependency IDs from CLI flags and YAML frontmatter.
 * Accepts comma-separated tokens (e.g. "a.b, c.d") and flattens to distinct IDs in order.
 */
export function normalizeTaskDependencyIds(parts: string[] | undefined | null): string[] {
  if (!parts || parts.length === 0) {
    return [];
  }

  const expanded: string[] = [];
  for (const part of parts) {
    if (part == null || typeof part !== 'string') {
      continue;
    }
    const trimmedPart = part.trim();
    if (!trimmedPart) {
      continue;
    }
    for (const segment of trimmedPart.split(',')) {
      const id = segment.trim();
      if (id) {
        expanded.push(id);
      }
    }
  }

  const seen = new Set<string>();
  return expanded.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
}

/**
 * Coerce YAML `dependencies` (array, string, or absent) into a normalized ID list.
 */
export function normalizeDependencyInput(value: unknown): string[] {
  if (value == null) {
    return [];
  }
  if (Array.isArray(value)) {
    return normalizeTaskDependencyIds(value.map((v) => String(v)));
  }
  if (typeof value === 'string') {
    return normalizeTaskDependencyIds([value]);
  }
  return [];
}
