/**
 * Diagnostics for Luma.
 *
 * Every error carries a source position so the CLI, the REPL and the web
 * playground can all render the same annotated snippet:
 *
 *   error[runtime]: undefined variable 'foo'
 *    --> script.luma:3:11
 *     |
 *   3 |   print(foo);
 *     |         ^^^
 */

import type { Position } from "./token.ts";

export type ErrorPhase = "syntax" | "runtime";

export class LumaError extends Error {
  readonly phase: ErrorPhase;
  readonly position: Position;
  /** How many characters the caret underlines. */
  readonly span: number;
  /** Innermost-first list of call frames, e.g. `["fib(...)", "main(...)"]`. */
  readonly frames: string[];

  constructor(
    phase: ErrorPhase,
    message: string,
    position: Position,
    frames: string[] = [],
    span = 1,
  ) {
    super(message);
    this.name = "LumaError";
    this.phase = phase;
    this.position = position;
    this.frames = frames;
    this.span = span;
  }
}

export class SyntaxError_ extends LumaError {
  constructor(message: string, position: Position, span = 1) {
    super("syntax", message, position, [], span);
    this.name = "LumaSyntaxError";
  }
}

export class RuntimeError extends LumaError {
  constructor(message: string, position: Position, frames: string[] = [], span = 1) {
    super("runtime", message, position, frames, span);
    this.name = "LumaRuntimeError";
  }
}

export interface FormatOptions {
  /** File name shown in the `-->` line. */
  file?: string;
  /** Set to false to strip ANSI colours (files, CI logs, the browser). */
  color?: boolean;
  /** Overrides the caret width carried by the error itself. */
  span?: number;
}

const ESC = String.fromCharCode(27);
const RESET = `${ESC}[0m`;
const RED = `${ESC}[31;1m`;
const BLUE = `${ESC}[34;1m`;
const DIM = `${ESC}[2m`;

/**
 * Render an error as an annotated source snippet. Never throws: a malformed
 * position degrades gracefully to a single headline line.
 */
export function formatError(
  error: LumaError,
  source: string,
  options: FormatOptions = {},
): string {
  const file = options.file ?? "<input>";
  const color = options.color ?? false;
  const paint = (code: string, text: string) => (color ? code + text + RESET : text);

  const { line, column } = error.position;
  const out: string[] = [];
  out.push(`${paint(RED, `error[${error.phase}]`)}: ${error.message}`);

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
    `${pad} ${paint(BLUE, "|")} ${" ".repeat(caretOffset)}${paint(RED, "^".repeat(span))}`,
  );

  for (const frame of error.frames) {
    out.push(`${pad} ${paint(DIM, `= in ${frame}`)}`);
  }

  return out.join("\n");
}
