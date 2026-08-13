/**
 * Public API.
 *
 * ```ts
 * import { run } from "luma-lang";
 * const { value, output } = run(`print("hello"); 1 + 1`);
 * ```
 */

export { Lexer, tokenize } from "./lexer.ts";
export {
  escapeHtml,
  highlight,
  highlightHtml,
  type HighlightOptions,
  type Segment,
  type TokenKind,
} from "./highlight.ts";
export { Parser, parse } from "./parser.ts";
export { Interpreter, type InterpreterOptions } from "./interpreter.ts";
export { Environment, UNBOUND } from "./environment.ts";
export {
  resolve,
  type ResolveOptions,
  type ResolveResult,
} from "./resolver.ts";
export {
  TraceRecorder,
  type RecorderOptions,
  type StepKind,
  type TraceScope,
  type TraceStep,
} from "./tracer.ts";
export {
  DIAGNOSTIC_CODES,
  allCodes,
  explainCode,
  type CodeEntry,
  type DiagnosticCode,
} from "./codes.ts";
export { format, type FormatOptions as FormatterOptions } from "./formatter.ts";
export {
  LumaError,
  LumaErrorGroup,
  RuntimeError,
  SemanticError,
  SyntaxError_ as LumaSyntaxError,
  formatError,
  formatErrors,
  formatErrorsJson,
  suggest,
  toDiagnostics,
  type Severity,
} from "./errors.ts";
export {
  LumaBuiltin,
  LumaFunction,
  LumaHash,
  inspect,
  stringify,
  typeOf,
  type LumaValue,
} from "./values.ts";
export type * from "./ast.ts";
export type { Position, Token, TokenType } from "./token.ts";

import { Interpreter, type InterpreterOptions } from "./interpreter.ts";
import { formatErrors, formatErrorsJson, toDiagnostics, type LumaError } from "./errors.ts";
import { parse } from "./parser.ts";
import { resolve } from "./resolver.ts";
import { createBuiltins } from "./builtins.ts";
import { TraceRecorder, type TraceStep } from "./tracer.ts";
import { inspect, type LumaValue } from "./values.ts";

export interface RunResult {
  /** Value of the last statement, or `null` when the program failed. */
  value: LumaValue;
  /** Everything `print` wrote, one entry per call. */
  output: string[];
  /** Rendered diagnostics when the program failed, otherwise `null`. */
  error: string | null;
  /** Rendered non-fatal diagnostics, such as unreachable code. */
  warnings: string | null;
  /** `true` when the program ran to completion. */
  ok: boolean;
}

/**
 * Evaluate a program and capture its output instead of throwing — the shape the
 * web playground and the test-suite both want.
 */
export function run(
  source: string,
  options: InterpreterOptions & { file?: string } = {},
): RunResult {
  const output: string[] = [];
  const interpreter = new Interpreter({
    ...options,
    stdout: (line) => {
      output.push(line);
      options.stdout?.(line);
    },
  });

  const render = (errors: Parameters<typeof formatErrors>[0]) =>
    formatErrors(errors, source, { file: options.file, color: false });

  try {
    const value = interpreter.run(source);
    return {
      value,
      output,
      error: null,
      warnings: interpreter.warnings.length > 0 ? render(interpreter.warnings) : null,
      ok: true,
    };
  } catch (error) {
    const diagnostics = toDiagnostics(error);
    if (diagnostics === null) throw error;
    return {
      value: null,
      output,
      error: render(diagnostics),
      warnings: interpreter.warnings.length > 0 ? render(interpreter.warnings) : null,
      ok: false,
    };
  }
}

export interface CheckResult {
  /** Rendered diagnostics, or `null` when the program is clean. */
  report: string | null;
  errorCount: number;
  warningCount: number;
  ok: boolean;
}

/**
 * Analyse a program without running it: parse it, then resolve it. This is what
 * `luma check` and the playground's inline diagnostics use.
 */
export function check(
  source: string,
  options: { file?: string; format?: "text" | "json" } = {},
): CheckResult {
  const globals = [...createBuiltins().keys()];

  let errors: LumaError[] = [];
  let warnings: LumaError[] = [];

  try {
    const result = resolve(parse(source), { globals });
    errors = result.errors;
    warnings = result.warnings;
  } catch (error) {
    const diagnostics = toDiagnostics(error);
    if (diagnostics === null) throw error;
    errors = diagnostics;
  }

  const all = [...errors, ...warnings];
  const render = (): string =>
    options.format === "json"
      ? formatErrorsJson(all, options.file)
      : formatErrors(all, source, { file: options.file, color: false });

  return {
    report: all.length > 0 ? render() : null,
    errorCount: errors.length,
    warningCount: warnings.length,
    ok: errors.length === 0,
  };
}

export interface TraceResult {
  /** The recorded timeline, in execution order. */
  steps: TraceStep[];
  /** Everything `print` wrote. */
  output: string[];
  /** Rendered diagnostics if the program failed, otherwise `null`. */
  error: string | null;
  /** True when recording stopped early because the step budget ran out. */
  truncated: boolean;
  ok: boolean;
}

/**
 * Run a program while recording an execution timeline.
 *
 * A failing program still returns everything recorded up to the failure, which
 * is usually the interesting part — you can step back from the error and watch
 * how the state got there.
 */
export function trace(
  source: string,
  options: InterpreterOptions & { file?: string; maxSteps?: number } = {},
): TraceResult {
  const recorder = new TraceRecorder(source, {
    maxSteps: options.maxSteps,
    // Builtins live in the global scope and would drown every snapshot.
    hide: builtinNames(),
  });

  const output: string[] = [];
  const interpreter = new Interpreter({
    ...options,
    recorder,
    stdout: (line) => {
      output.push(line);
      options.stdout?.(line);
    },
  });

  try {
    interpreter.run(source);
    return { steps: recorder.steps, output, error: null, truncated: recorder.truncated, ok: true };
  } catch (error) {
    const diagnostics = toDiagnostics(error);
    if (diagnostics === null) throw error;
    return {
      steps: recorder.steps,
      output,
      error: formatErrors(diagnostics, source, { file: options.file, color: false }),
      truncated: recorder.truncated,
      ok: false,
    };
  }
}

/**
 * Every name the standard library defines.
 *
 * Exposed for tooling — the playground's syntax highlighter uses it to colour
 * builtins differently from user-defined names.
 */
export function builtinNames(): string[] {
  return [...createBuiltins().keys()];
}

/** Evaluate a program and return its result rendered the way the REPL shows it. */
export function evaluate(source: string, options: InterpreterOptions = {}): string {
  const result = run(source, options);
  return result.ok ? inspect(result.value) : result.error!;
}
