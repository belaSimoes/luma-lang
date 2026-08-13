/**
 * Runtime values.
 *
 * Luma piggybacks on JavaScript primitives where the semantics line up exactly
 * (numbers, strings, booleans, arrays) and introduces classes only where it
 * needs its own behaviour. `nil` is represented by `null`.
 */

import type { BlockStatement } from "./ast.ts";
import type { Environment } from "./environment.ts";

export type HashKey = string | number | boolean;

export type LumaValue =
  | number
  | string
  | boolean
  | null
  | LumaValue[]
  | LumaHash
  | LumaFunction
  | LumaBuiltin;

export class LumaHash {
  readonly entries: Map<HashKey, LumaValue>;

  constructor(entries: Iterable<[HashKey, LumaValue]> = []) {
    this.entries = new Map(entries);
  }
}

export class LumaFunction {
  readonly name: string;
  readonly parameters: string[];
  readonly body: BlockStatement;
  readonly env: Environment;

  constructor(
    name: string,
    parameters: string[],
    body: BlockStatement,
    env: Environment,
  ) {
    this.name = name;
    this.parameters = parameters;
    this.body = body;
    this.env = env;
  }
}

export interface BuiltinContext {
  /** Write a line to the host's output stream. */
  print(text: string): void;
  /** Invoke any callable value — lets `map`/`filter`/`sort` accept closures. */
  call(callee: LumaValue, args: LumaValue[]): LumaValue;
  /** Raise a Luma runtime error positioned at the current call site. */
  fail(message: string): never;
}

export class LumaBuiltin {
  readonly name: string;
  readonly arity: [min: number, max: number];
  readonly fn: (args: LumaValue[], ctx: BuiltinContext) => LumaValue;

  constructor(
    name: string,
    arity: [number, number],
    fn: (args: LumaValue[], ctx: BuiltinContext) => LumaValue,
  ) {
    this.name = name;
    this.arity = arity;
    this.fn = fn;
  }
}

export type TypeName =
  | "number"
  | "string"
  | "boolean"
  | "nil"
  | "array"
  | "hash"
  | "function";

export function typeOf(value: LumaValue): TypeName {
  if (value === null) return "nil";
  if (Array.isArray(value)) return "array";
  if (value instanceof LumaHash) return "hash";
  if (value instanceof LumaFunction || value instanceof LumaBuiltin) return "function";
  switch (typeof value) {
    case "number":
      return "number";
    case "string":
      return "string";
    default:
      return "boolean";
  }
}

/** Only `nil` and `false` are falsy — `0` and `""` are truthy. */
export function isTruthy(value: LumaValue): boolean {
  return value !== null && value !== false;
}

export function isCallable(value: LumaValue): value is LumaFunction | LumaBuiltin {
  return value instanceof LumaFunction || value instanceof LumaBuiltin;
}

/** Structural equality: arrays and hashes compare by content, not identity. */
export function valuesEqual(a: LumaValue, b: LumaValue): boolean {
  if (a === b) return true;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => valuesEqual(item, b[index]!));
  }

  if (a instanceof LumaHash && b instanceof LumaHash) {
    if (a.entries.size !== b.entries.size) return false;
    for (const [key, value] of a.entries) {
      if (!b.entries.has(key)) return false;
      if (!valuesEqual(value, b.entries.get(key)!)) return false;
    }
    return true;
  }

  return false;
}

export function formatNumber(value: number): string {
  if (Number.isInteger(value) && Object.is(value, -0)) return "-0";
  if (Number.isInteger(value)) return String(value);
  return String(value);
}

/**
 * `inspect` is the developer-facing representation (strings are quoted);
 * `stringify` is what `print` and string concatenation use.
 */
export function inspect(value: LumaValue): string {
  return render(value, true, new Set());
}

export function stringify(value: LumaValue): string {
  return render(value, false, new Set());
}

function render(value: LumaValue, quoted: boolean, seen: Set<object>): string {
  if (value === null) return "nil";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return quoted ? JSON.stringify(value) : value;

  if (value instanceof LumaFunction) {
    const name = value.name ? ` ${value.name}` : "";
    return `<fn${name}(${value.parameters.join(", ")})>`;
  }
  if (value instanceof LumaBuiltin) return `<builtin ${value.name}>`;

  if (seen.has(value)) return "<cycle>";
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => render(item, true, seen)).join(", ")}]`;
    }
    const pairs = [...value.entries].map(
      ([key, entry]) =>
        `${render(key, true, seen)}: ${render(entry, true, seen)}`,
    );
    return `{${pairs.join(", ")}}`;
  } finally {
    seen.delete(value);
  }
}
