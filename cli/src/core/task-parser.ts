import * as fs from 'fs-extra';
import * as yaml from 'yaml';
import { TaskConfig, TaskStatus } from '../domain/task-entity';

export type { TaskConfig as Task };

/**
 * Structured error for task file parsing failures.
 */
export class TaskParseError extends Error {
  constructor(
    public readonly reason:
      | 'missing_frontmatter'
      | 'invalid_yaml'
      | 'missing_required_field'
      | 'invalid_field_value',
    message: string,
    public readonly filePath?: string,
    public readonly suggestion?: string
  ) {
    super(message);
    this.name = 'TaskParseError';
  }
}

const VALID_STATUSES: TaskStatus[] = [
  'pending',
  'in_progress',
  'completed',
  'failed',
];

/**
 * Split raw file content into frontmatter string and body string.
 * Handles CRLF, missing trailing newlines, and extra blank lines.
 */
export function splitFrontmatter(content: string): { frontmatterStr: string; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/);

  if (!match) {
    throw new TaskParseError(
      'missing_frontmatter',
      'File must start with YAML frontmatter delimited by --- lines',
      undefined,
      'Expected format:\n---\nid: module.name\nmodule: module\nstatus: pending\n---\n# Task Title'
    );
  }

  return {
    frontmatterStr: match[1],
    body: match[2] ?? '',
  };
}

/**
 * Parse raw frontmatter string into a validated TaskConfig.
 */
export function parseTaskContent(content: string, filePath?: string): TaskConfig {
  const { frontmatterStr, body } = splitFrontmatter(content);

  let frontmatter: Record<string, any>;
  try {
    frontmatter = yaml.parse(frontmatterStr) ?? {};
  } catch (err) {
    throw new TaskParseError(
      'invalid_yaml',
      `Invalid YAML in frontmatter: ${(err as Error).message}`,
      filePath,
      'Check YAML syntax: indentation, special characters, quoting'
    );
  }

  // Validate required fields
  for (const field of ['id', 'module', 'status'] as const) {
    if (!frontmatter[field]) {
      throw new TaskParseError(
        'missing_required_field',
        `Missing required field '${field}' in frontmatter`,
        filePath,
        `Add '${field}:' to the YAML frontmatter between the --- delimiters`
      );
    }
  }

  // Validate status value
  if (!VALID_STATUSES.includes(frontmatter.status)) {
    throw new TaskParseError(
      'invalid_field_value',
      `Invalid status '${frontmatter.status}'. Must be one of: ${VALID_STATUSES.join(', ')}`,
      filePath,
      `Change status to one of: ${VALID_STATUSES.join(', ')}`
    );
  }

  // Parse body sections
  const description = parseDescription(body);
  const acceptanceCriteria = parseAcceptanceCriteria(body);
  const notes = parseNotes(body);

  return {
    id: String(frontmatter.id),
    module: String(frontmatter.module),
    priority: Number(frontmatter.priority) || 0,
    status: frontmatter.status as TaskStatus,
    estimatedMinutes: frontmatter.estimatedMinutes != null ? Number(frontmatter.estimatedMinutes) : undefined,
    dependencies: frontmatter.dependencies ?? undefined,
    parallelGroup: frontmatter.parallelGroup != null ? Number(frontmatter.parallelGroup) : undefined,
    testRequirements: frontmatter.testRequirements,
    description,
    acceptanceCriteria,
    notes,
    startedAt: frontmatter.startedAt,
    completedAt: frontmatter.completedAt,
    failedAt: frontmatter.failedAt,
  };
}

/**
 * Extract the title from the first `# heading` in the body.
 */
function parseDescription(body: string): string {
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : '';
}

/**
 * Extract acceptance criteria from both numbered (`1. item`) and bullet (`- item`) formats.
 */
function parseAcceptanceCriteria(body: string): string[] {
  const criteria: string[] = [];

  // Find the ## Acceptance Criteria section by line scanning
  const lines = body.split(/\r?\n/);
  let inSection = false;
  let currentCriterionIndex = -1;

  for (const line of lines) {
    if (/^##\s+Acceptance Criteria\s*$/.test(line)) {
      inSection = true;
      continue;
    }

    if (inSection) {
      // Stop at next ## heading
      if (/^##\s/.test(line)) {
        break;
      }

      const trimmed = line.trim();
      if (!trimmed) continue;

      // Match numbered: "1. Some criterion"
      const numberedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
      if (numberedMatch) {
        criteria.push(numberedMatch[1].trim());
        currentCriterionIndex = criteria.length - 1;
        continue;
      }

      // Match bullet: "- Some criterion"
      const bulletMatch = trimmed.match(/^-\s+(.+)$/);
      if (bulletMatch) {
        criteria.push(bulletMatch[1].trim());
        currentCriterionIndex = criteria.length - 1;
        continue;
      }

      if (currentCriterionIndex !== -1 && /^\s+/.test(line)) {
        criteria[currentCriterionIndex] += `\n${trimmed}`;
      }
    }
  }

  return criteria;
}

/**
 * Extract notes from the body. Returns undefined for missing/empty notes.
 */
function parseNotes(body: string): string | undefined {
  const lines = body.split(/\r?\n/);
  let notesStart = -1;

  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Notes\s*$/.test(lines[i])) {
      notesStart = i + 1;
      break;
    }
  }

  if (notesStart === -1) return undefined;

  // Collect lines until next ## heading
  const notesLines: string[] = [];
  for (let i = notesStart; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break;
    notesLines.push(lines[i]);
  }

  const trimmed = notesLines.join('\n').trim();
  return trimmed || undefined;
}

// ---------------------------------------------------------------------------
// Document-mode authoring validation
// ---------------------------------------------------------------------------

/**
 * A single validation violation found during document-mode creation.
 */
export interface AuthoringViolation {
  field: string;
  reason: string;
}

/**
 * Error thrown when a task document fails authoring-time validation.
 */
export class TaskAuthoringError extends Error {
  constructor(
    public readonly violations: AuthoringViolation[],
    message: string,
    public readonly filePath?: string
  ) {
    super(message);
    this.name = 'TaskAuthoringError';
  }
}

const RUNTIME_LIFECYCLE_FIELDS = ['startedAt', 'completedAt', 'failedAt'] as const;

function isValidPositiveIntegerMetadata(value: unknown): boolean {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 1;
  }
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return false;
  }
  return Number(trimmed) >= 1;
}

/**
 * Validate raw YAML frontmatter shapes for document-mode creation before
 * parseTaskContent applies its legacy-compatible type coercions.
 */
export function validateAuthoringFrontmatter(content: string, filePath?: string): AuthoringViolation[] {
  const { frontmatterStr } = splitFrontmatter(content);

  let frontmatter: Record<string, any>;
  try {
    frontmatter = yaml.parse(frontmatterStr) ?? {};
  } catch (err) {
    throw new TaskParseError(
      'invalid_yaml',
      `Invalid YAML in frontmatter: ${(err as Error).message}`,
      filePath,
      'Check YAML syntax: indentation, special characters, quoting'
    );
  }

  const violations: AuthoringViolation[] = [];

  if (!isValidPositiveIntegerMetadata(frontmatter.priority)) {
    violations.push({ field: 'priority', reason: 'Missing or invalid priority (must be a positive integer)' });
  }

  if (frontmatter.estimatedMinutes != null && !isValidPositiveIntegerMetadata(frontmatter.estimatedMinutes)) {
    violations.push({ field: 'estimatedMinutes', reason: 'Invalid estimatedMinutes (must be a positive integer)' });
  }

  const dependencyViolation = validateDependencyShape(frontmatter.dependencies);
  if (dependencyViolation) {
    violations.push(dependencyViolation);
  }

  return violations;
}

/**
 * Validate a parsed TaskConfig for document-mode task creation.
 * Returns a list of violations (empty if valid).
 */
export function validateTaskForCreation(config: TaskConfig): AuthoringViolation[] {
  const violations: AuthoringViolation[] = [];

  if (!config.description || config.description.trim() === '') {
    violations.push({ field: 'description', reason: 'Missing or empty task title (first # heading)' });
  }

  if (!config.acceptanceCriteria || config.acceptanceCriteria.length === 0) {
    violations.push({ field: 'acceptanceCriteria', reason: 'Missing ## Acceptance Criteria items' });
  }

  if (!config.priority || !Number.isInteger(config.priority) || config.priority < 1) {
    violations.push({ field: 'priority', reason: 'Missing or invalid priority (must be a positive integer)' });
  }

  if (config.estimatedMinutes !== undefined) {
    if (!Number.isInteger(config.estimatedMinutes) || config.estimatedMinutes < 1) {
      violations.push({ field: 'estimatedMinutes', reason: 'Invalid estimatedMinutes (must be a positive integer)' });
    }
  }

  if (config.status !== 'pending') {
    violations.push({ field: 'status', reason: `Non-pending initial status "${config.status}" is not allowed in document mode` });
  }

  for (const field of RUNTIME_LIFECYCLE_FIELDS) {
    if ((config as any)[field] != null) {
      violations.push({ field, reason: `Runtime lifecycle field "${field}" is not allowed in document mode` });
    }
  }

  if (!config.id.startsWith(`${config.module}.`)) {
    violations.push({ field: 'id', reason: `Task id "${config.id}" does not start with module prefix "${config.module}."` });
  } else {
    const namePart = config.id.slice(config.module.length + 1);
    if (!namePart) {
      violations.push({ field: 'id', reason: 'Task name is empty after removing module prefix' });
    }
  }

  return violations;
}

/**
 * Validate that dependency values are of an accepted shape.
 * Accepted: array of strings, comma-separated string, or null/undefined.
 */
export function validateDependencyShape(value: unknown): AuthoringViolation | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const tokens = value.split(',').map((item) => item.trim());
    if (tokens.some((item) => item.length === 0)) {
      return { field: 'dependencies', reason: 'Dependency entries must not be blank' };
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== 'string') {
        return { field: 'dependencies', reason: `Dependency entries must be strings, got ${typeof item}` };
      }
      if (item.trim().length === 0) {
        return { field: 'dependencies', reason: 'Dependency entries must not be blank' };
      }
    }
    return null;
  }
  return { field: 'dependencies', reason: `Dependencies must be an array or comma-separated string, got ${typeof value}` };
}

/**
 * Check if a segment is safe for use as a filesystem path component.
 * Rejects empty strings, '..', path separators, and absolute paths.
 */
export function isPathSafeSegment(segment: string): boolean {
  if (!segment) return false;
  if (segment === '.') return false;
  if (segment === '..') return false;
  if (segment.includes('/') || segment.includes('\\')) return false;
  if (/^[a-zA-Z]:/.test(segment)) return false;
  return true;
}

export class TaskParser {
  /**
   * Parse a markdown file with YAML frontmatter into a TaskConfig object
   */
  static parseTaskFile(filePath: string): TaskConfig {
    const content = fs.readFileSync(filePath, 'utf-8');
    return parseTaskContent(content, filePath);
  }

  /**
   * Parse the index.json file
   */
  static parseIndex(indexPath: string): {
    version: string;
    updatedAt: string;
    metadata: {
      projectGoal: string;
      languageConfig?: any;
    };
    tasks: Record<
      string,
      {
        status: string;
        priority: number;
        module: string;
        description: string;
        filePath?: string;
      }
    >;
  } {
    if (!fs.existsSync(indexPath)) {
      return {
        version: '1.0.0',
        updatedAt: new Date().toISOString(),
        metadata: {
          projectGoal: '',
        },
        tasks: {},
      };
    }

    return fs.readJSONSync(indexPath);
  }
}
