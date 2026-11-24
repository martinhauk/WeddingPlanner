import type { z } from 'zod';
import { decodeCoded } from '../schema/common.ts';

export type Severity = 'error' | 'warning';

/**
 * One validation finding. `message` never contains values from the instance files (deploy logs
 * are public): only a stable code, the file, a JSON path and a generic explanation.
 */
export type Diagnostic = {
  readonly severity: Severity;
  /** Stable code, e.g. `E_SLUG`, `E_DATETIME`, `W_I18N_MISSING`. */
  readonly code: string;
  /** File relative to the instance directory (`instance.json`, `site.json`, `media/…`) or `env`. */
  readonly file: string;
  /** JSON path inside the file, e.g. `$.rsvp.deadline`; `$` for the whole file. */
  readonly path: string;
  readonly message: string;
};

type PathSegment = PropertyKey;

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Formats path segments as a JSON path: `$.event.title.de`, `$.couple.names[1]`. */
export function jsonPath(segments: readonly PathSegment[]): string {
  let out = '$';
  for (const segment of segments) {
    if (typeof segment === 'number') {
      out += `[${segment}]`;
    } else {
      const key = String(segment);
      out += IDENTIFIER.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
    }
  }
  return out;
}

export function error(code: string, file: string, path: string, message: string): Diagnostic {
  return { severity: 'error', code, file, path, message };
}

export function warning(code: string, file: string, path: string, message: string): Diagnostic {
  return { severity: 'warning', code, file, path, message };
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}

/** `error E_SLUG instance.json $.slug: must match ^wed[0-9a-z]{3,8}$` */
export function formatDiagnostic(d: Diagnostic): string {
  return `${d.severity} ${d.code} ${d.file} ${d.path}: ${d.message}`;
}

type Issue = z.core.$ZodIssue;

/**
 * Converts Zod issues into diagnostics. Codes come from messages built with `coded()`; other issues
 * get `E_SCHEMA` (or `E_UNKNOWN_KEY`) and a message derived from the issue kind, never from the
 * input value.
 */
export function diagnosticsFromZod(file: string, error: z.ZodError): Diagnostic[] {
  return error.issues.flatMap((issue) => fromIssue(file, issue, []));
}

function fromIssue(file: string, issue: Issue, base: readonly PathSegment[]): Diagnostic[] {
  const path = [...base, ...issue.path];
  const decoded = decodeCoded(issue.message);
  if (decoded !== undefined) {
    return [errorAt(decoded.code, file, path, decoded.message)];
  }
  switch (issue.code) {
    case 'unrecognized_keys':
      return issue.keys.map((key) => errorAt('E_UNKNOWN_KEY', file, [...path, key], 'unknown key'));
    case 'invalid_key':
      return nested(file, issue.issues, path, 'invalid key');
    case 'invalid_union': {
      // When exactly one alternative has the value's type (e.g. the object form of a localized
      // text), its findings are the useful ones; otherwise report the union as a whole.
      const sameType = issue.errors.filter(
        (alternative) =>
          !alternative.every((i) => i.code === 'invalid_type' && i.path.length === 0),
      );
      const [only] = sameType;
      if (sameType.length === 1 && only !== undefined && only.length > 0) {
        return only.flatMap((i) => fromIssue(file, i, path));
      }
      return [errorAt('E_SCHEMA', file, path, 'does not match any allowed form')];
    }
    default:
      return [errorAt('E_SCHEMA', file, path, describe(issue))];
  }
}

function nested(
  file: string,
  issues: readonly Issue[],
  path: readonly PathSegment[],
  fallback: string,
): Diagnostic[] {
  const found = issues.flatMap((i) => fromIssue(file, i, path));
  return found.length > 0 ? found : [errorAt('E_SCHEMA', file, path, fallback)];
}

function errorAt(
  code: string,
  file: string,
  path: readonly PathSegment[],
  message: string,
): Diagnostic {
  return error(code, file, jsonPath(path), message);
}

function describe(issue: Issue): string {
  switch (issue.code) {
    case 'invalid_type':
      return issue.input === undefined ? 'is required' : `must be ${article(issue.expected)}`;
    case 'invalid_value':
      return `must be ${issue.values.map((v) => JSON.stringify(v)).join(' or ')}`;
    case 'invalid_format':
      return issue.format === 'regex'
        ? 'does not match the required pattern'
        : `must be a valid ${issue.format}`;
    case 'too_small':
      return sizeMessage('at least', issue.origin, issue.minimum, issue.inclusive);
    case 'too_big':
      return sizeMessage('at most', issue.origin, issue.maximum, issue.inclusive);
    default:
      return 'is invalid';
  }
}

function article(expected: string): string {
  return /^[aeiou]/.test(expected) ? `an ${expected}` : `a ${expected}`;
}

function sizeMessage(
  bound: 'at least' | 'at most',
  origin: string,
  limit: number | bigint,
  inclusive: boolean | undefined,
): string {
  switch (origin) {
    case 'array':
    case 'set':
      return `must have ${bound} ${limit} item(s)`;
    case 'string':
      return bound === 'at least' && Number(limit) === 1
        ? 'must not be empty'
        : `must have ${bound} ${limit} character(s)`;
    default: {
      const comparison = bound === 'at least' ? 'greater than' : 'less than';
      return `must be ${comparison}${inclusive === false ? '' : ' or equal to'} ${limit}`;
    }
  }
}
