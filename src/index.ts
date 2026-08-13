/**
 * Public API.
 *
 * ```ts
 * import { run } from "luma-lang";
 * const { value, output } = run(`print("hello"); 1 + 1`);
 * ```
 */

export { Lexer, tokenize } from "./lexer.ts";
export { Parser, parse } from "./parser.ts";
export { Interpreter, type InterpreterOptions } from "./interpreter.ts";
export { Environment } from "./environment.ts";
export { LumaError, RuntimeError, SyntaxError_ as LumaSyntaxError, formatError } from "./errors.ts";
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
import { LumaError, formatError } from "./errors.ts";
import { inspect, type LumaValue } from "./values.ts";

export interface RunResult {
  /** Value of the last statement, or `null` when the program failed. */
  value: LumaValue;
  /** Everything `print` wrote, one entry per call. */
  output: string[];
  /** Rendered diagnostic when the program failed, otherwise `null`. */
  error: string | null;
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

  try {
    return { value: interpreter.run(source), output, error: null, ok: true };
  } catch (error) {
    if (error instanceof LumaError) {
      return {
        value: null,
        output,
        error: formatError(error, source, { file: options.file, color: false }),
        ok: false,
      };
    }
    throw error;
  }
}

/** Evaluate a program and return its result rendered the way the REPL shows it. */
export function evaluate(source: string, options: InterpreterOptions = {}): string {
  const result = run(source, options);
  return result.ok ? inspect(result.value) : result.error!;
}
