/**
 * Diagnostics for Luma.
 *
 * Every diagnostic carries a source position so the CLI, the REPL and the web
 * playground can all render the same annotated snippet:
 *
 *   error[semantic]: undefined variable 'hieght'
 *    --> shapes.luma:7:21
 *      |
 *    7 |   area(shape.width, hieght)
 *      |                     ^^^^^^
 *      = help: did you mean 'height'?
 *
 * The parser and the resolver report *every* problem they find rather than
 * stopping at the first, so a group of diagnostics is the normal currency —
 * see {@link LumaErrorGroup} and {@link formatErrors}.
 */

import type { Position } from "./token.ts";

export type ErrorPhase = "syntax" | "semantic" | "runtime";
export type Severity = "error" | "warning";

export interface DiagnosticOptions {
  /** How many characters the caret underlines. Defaults to 1. */
  span?: number;
  /** Innermost-first call frames, e.g. `["fib(...)", "main(...)"]`. */
  frames?: string[];
  /** An optional `= help: …` line, such as a spelling suggestion. */
  hint?: string;
  /** Warnings are reported but do not stop the program. Defaults to "error". */
  severity?: Severity;
}

export class LumaError extends Error {
  readonly phase: ErrorPhase;
  readonly position: Position;
  readonly span: number;
  readonly frames: string[];
  readonly hint: string | null;
  readonly severity: Severity;

  constructor(phase: ErrorPhase, message: string, position: Position, options: DiagnosticOptions = {}) {
    super(message);
    this.name = "LumaError";
    this.phase = phase;
    this.position = position;
    this.span = options.span ?? 1;
    this.frames = options.frames ?? [];
    this.hint = options.hint ?? null;
    this.severity = options.severity ?? "error";
  }
}

export class SyntaxError_ extends LumaError {
  constructor(message: string, position: Position, options: DiagnosticOptions = {}) {
    super("syntax", message, position, options);
    this.name = "LumaSyntaxError";
  }
}

/** Raised by the resolver, before a single line of the program has run. */
export class SemanticError extends LumaError {
  constructor(message: string, position: Position, options: DiagnosticOptions = {}) {
    super("semantic", message, position, options);
    this.name = "LumaSemanticError";
  }
}

export class RuntimeError extends LumaError {
  constructor(message: string, position: Position, options: DiagnosticOptions = {}) {
    super("runtime", message, position, options);
    this.name = "LumaRuntimeError";
  }
}

/**
 * Several diagnostics reported together. Thrown by the parser and the resolver,
 * which keep going after the first problem so one run surfaces every mistake.
 */
export class LumaErrorGroup extends Error {
  readonly errors: LumaError[];

  constructor(errors: LumaError[]) {
    const [first] = errors;
    super(
      errors.length === 1
        ? (first?.message ?? "unknown error")
        : `${errors.length} problems found`,
    );
    this.name = "LumaErrorGroup";
    this.errors = errors;
  }

  /** The position of the first diagnostic, so callers can treat a group like an error. */
  get position(): Position {
    return this.errors[0]?.position ?? { line: 1, column: 1 };
  }
}

/** Normalises a thrown value into a flat list of diagnostics. */
export function toDiagnostics(error: unknown): LumaError[] | null {
  if (error instanceof LumaErrorGroup) return error.errors;
  if (error instanceof LumaError) return [error];
  return null;
}

export interface FormatOptions {
  /** File name shown in the `-->` line. */
  file?: string;
  /** Set to false to strip ANSI colours (files, CI logs, the browser). */
  color?: boolean;
  /** Overrides the caret width carried by the diagnostic itself. */
  span?: number;
}

const ESC = String.fromCharCode(27);
const RESET = `${ESC}[0m`;
const RED = `${ESC}[31;1m`;
const YELLOW = `${ESC}[33;1m`;
const BLUE = `${ESC}[34;1m`;
const DIM = `${ESC}[2m`;

/**
 * Render one diagnostic as an annotated source snippet. Never throws: a
 * malformed position degrades gracefully to a single headline line.
 */
export function formatError(
  error: LumaError,
  source: string,
  options: FormatOptions = {},
): string {
  const file = options.file ?? "<input>";
  const color = options.color ?? false;
  const paint = (code: string, text: string) => (color ? code + text + RESET : text);
  const accent = error.severity === "warning" ? YELLOW : RED;

  const { line, column } = error.position;
  const out: string[] = [];
  out.push(`${paint(accent, `${error.severity}[${error.phase}]`)}: ${error.message}`);

  const lines = source.split("\n");
  const target = lines[line - 1];
  if (target === undefined) {
    return out.join("\n");
  }

  const gutter = String(line);
  const pad = " ".repeat(gutter.length);
  const caretOffset = Math.max(0, Math.min(column - 1, target.length));
  const requested = options.span ?? error.span;
  const span = Math.max(1, Math.min(requested, target.length - caretOffset || 1));

  out.push(`${pad}${paint(BLUE, "-->")} ${file}:${line}:${column}`);
  out.push(`${pad} ${paint(BLUE, "|")}`);
  out.push(`${paint(BLUE, gutter)} ${paint(BLUE, "|")} ${target}`);
  out.push(
    `${pad} ${paint(BLUE, "|")} ${" ".repeat(caretOffset)}${paint(accent, "^".repeat(span))}`,
  );

  if (error.hint !== null) {
    out.push(`${pad} ${paint(DIM, `= help: ${error.hint}`)}`);
  }
  for (const frame of error.frames) {
    out.push(`${pad} ${paint(DIM, `= in ${frame}`)}`);
  }

  return out.join("\n");
}

/** Render a group of diagnostics, ordered by position, with a closing tally. */
export function formatErrors(
  errors: LumaError[],
  source: string,
  options: FormatOptions = {},
): string {
  const ordered = [...errors].sort(
    (a, b) => a.position.line - b.position.line || a.position.column - b.position.column,
  );
  const rendered = ordered.map((error) => formatError(error, source, options));

  const failures = ordered.filter((error) => error.severity === "error").length;
  if (failures > 1) {
    rendered.push(`${failures} errors found`);
  }
  return rendered.join("\n\n");
}

/**
 * Levenshtein distance, capped so a long pair short-circuits instead of filling
 * a large matrix. Used to turn a typo into a "did you mean …?" hint.
 */
export function editDistance(a: string, b: string, limit = 3): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + cost,
      );
      current.push(value);
      best = Math.min(best, value);
    }
    if (best > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length]!;
}

/**
 * Pick the closest candidate to `name`, if one is close enough to be worth
 * suggesting. Short names get a tighter threshold so `a` never "means" `b`.
 */
export function suggest(name: string, candidates: Iterable<string>): string | null {
  const limit = name.length <= 3 ? 1 : name.length <= 6 ? 2 : 3;
  let best: string | null = null;
  let bestScore = limit + 1;

  for (const candidate of candidates) {
    if (candidate === name) continue;
    const score = editDistance(name.toLowerCase(), candidate.toLowerCase(), limit);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return bestScore <= limit ? best : null;
}
