/**
 * The standard library.
 *
 * Builtins receive the evaluated arguments plus a {@link BuiltinContext} that
 * lets them print, call back into Luma closures and raise positioned errors.
 * Arity is declared once and enforced centrally by the interpreter.
 */

import {
  LumaBuiltin,
  LumaHash,
  type BuiltinContext,
  type HashKey,
  type LumaValue,
  isCallable,
  isTruthy,
  stringify,
  typeOf,
  valuesEqual,
} from "./values.ts";

const INFINITE = Number.MAX_SAFE_INTEGER;

function define(
  name: string,
  arity: [number, number],
  fn: (args: LumaValue[], ctx: BuiltinContext) => LumaValue,
): [string, LumaBuiltin] {
  return [name, new LumaBuiltin(name, arity, fn)];
}

function expectNumber(ctx: BuiltinContext, name: string, value: LumaValue): number {
  if (typeof value !== "number") {
    ctx.fail(`${name} expects a number, got ${typeOf(value)}`);
  }
  return value;
}

function expectString(ctx: BuiltinContext, name: string, value: LumaValue): string {
  if (typeof value !== "string") {
    ctx.fail(`${name} expects a string, got ${typeOf(value)}`);
  }
  return value;
}

function expectArray(ctx: BuiltinContext, name: string, value: LumaValue): LumaValue[] {
  if (!Array.isArray(value)) {
    ctx.fail(`${name} expects an array, got ${typeOf(value)}`);
  }
  return value;
}

function expectHashKey(ctx: BuiltinContext, name: string, value: LumaValue): HashKey {
  const type = typeOf(value);
  if (type !== "string" && type !== "number" && type !== "boolean") {
    ctx.fail(`${name} expects a string, number or boolean key, got ${type}`);
  }
  return value as HashKey;
}

/** Normalise a possibly negative index against a length, Python-style. */
function resolveIndex(index: number, length: number): number {
  return index < 0 ? length + index : index;
}

function compareValues(ctx: BuiltinContext, a: LumaValue, b: LumaValue): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  ctx.fail(
    `sort cannot compare ${typeOf(a)} with ${typeOf(b)} — pass a comparator function`,
  );
}

export function createBuiltins(): Map<string, LumaBuiltin> {
  return new Map([
    // ------------------------------------------------------------------ io
    define("print", [0, INFINITE], (args, ctx) => {
      ctx.print(args.map(stringify).join(" "));
      return null;
    }),

    // ------------------------------------------------------------- generic
    define("len", [1, 1], (args, ctx) => {
      const value = args[0]!;
      if (typeof value === "string") return [...value].length;
      if (Array.isArray(value)) return value.length;
      if (value instanceof LumaHash) return value.entries.size;
      return ctx.fail(`len is not defined for ${typeOf(value)}`);
    }),

    define("type", [1, 1], (args) => typeOf(args[0]!)),

    define("assert", [1, 2], (args, ctx) => {
      if (!isTruthy(args[0]!)) {
        const message = args.length > 1 ? stringify(args[1]!) : "assertion failed";
        return ctx.fail(message);
      }
      return null;
    }),

    // --------------------------------------------------------- conversions
    define("str", [1, 1], (args) => stringify(args[0]!)),

    define("num", [1, 1], (args, ctx) => {
      const value = args[0]!;
      if (typeof value === "number") return value;
      if (typeof value === "boolean") return value ? 1 : 0;
      if (typeof value === "string") {
        const trimmed = value.trim();
        const parsed = trimmed === "" ? Number.NaN : Number(trimmed);
        if (Number.isNaN(parsed)) return ctx.fail(`cannot convert ${JSON.stringify(value)} to a number`);
        return parsed;
      }
      return ctx.fail(`cannot convert ${typeOf(value)} to a number`);
    }),

    define("bool", [1, 1], (args) => isTruthy(args[0]!)),

    // -------------------------------------------------------------- arrays
    define("push", [2, INFINITE], (args, ctx) => {
      const array = expectArray(ctx, "push", args[0]!);
      return [...array, ...args.slice(1)];
    }),

    define("pop", [1, 1], (args, ctx) => {
      const array = expectArray(ctx, "pop", args[0]!);
      return array.slice(0, -1);
    }),

    define("first", [1, 1], (args, ctx) => {
      const value = args[0]!;
      if (typeof value === "string") return value.length === 0 ? null : value[0]!;
      return expectArray(ctx, "first", value)[0] ?? null;
    }),

    define("last", [1, 1], (args, ctx) => {
      const value = args[0]!;
      if (typeof value === "string") return value.at(-1) ?? null;
      return expectArray(ctx, "last", value).at(-1) ?? null;
    }),

    define("rest", [1, 1], (args, ctx) => expectArray(ctx, "rest", args[0]!).slice(1)),

    define("slice", [2, 3], (args, ctx) => {
      const value = args[0]!;
      const start = resolveIndex(expectNumber(ctx, "slice", args[1]!), lengthOf(ctx, value));
      const end =
        args.length > 2
          ? resolveIndex(expectNumber(ctx, "slice", args[2]!), lengthOf(ctx, value))
          : lengthOf(ctx, value);
      if (typeof value === "string") return value.slice(start, end);
      return expectArray(ctx, "slice", value).slice(start, end);
    }),

    define("reverse", [1, 1], (args, ctx) => {
      const value = args[0]!;
      if (typeof value === "string") return [...value].reverse().join("");
      return [...expectArray(ctx, "reverse", value)].reverse();
    }),

    define("contains", [2, 2], (args, ctx) => {
      const haystack = args[0]!;
      const needle = args[1]!;
      if (typeof haystack === "string") {
        return haystack.includes(expectString(ctx, "contains", needle));
      }
      if (haystack instanceof LumaHash) {
        return haystack.entries.has(expectHashKey(ctx, "contains", needle));
      }
      return expectArray(ctx, "contains", haystack).some((item) =>
        valuesEqual(item, needle),
      );
    }),

    define("index_of", [2, 2], (args, ctx) => {
      const haystack = args[0]!;
      if (typeof haystack === "string") {
        return haystack.indexOf(expectString(ctx, "index_of", args[1]!));
      }
      return expectArray(ctx, "index_of", haystack).findIndex((item) =>
        valuesEqual(item, args[1]!),
      );
    }),

    define("range", [1, 3], (args, ctx) => {
      const a = expectNumber(ctx, "range", args[0]!);
      const start = args.length > 1 ? a : 0;
      const stop = args.length > 1 ? expectNumber(ctx, "range", args[1]!) : a;
      const step = args.length > 2 ? expectNumber(ctx, "range", args[2]!) : 1;
      if (step === 0) return ctx.fail("range step cannot be zero");

      const out: LumaValue[] = [];
      const count = Math.ceil((stop - start) / step);
      if (count > 1_000_000) return ctx.fail("range would produce more than 1,000,000 items");
      for (let i = 0; i < count; i++) out.push(start + i * step);
      return out;
    }),

    define("sort", [1, 2], (args, ctx) => {
      const array = [...expectArray(ctx, "sort", args[0]!)];
      const comparator = args[1];
      if (comparator === undefined || comparator === null) {
        return array.sort((a, b) => compareValues(ctx, a, b));
      }
      if (!isCallable(comparator)) {
        return ctx.fail(`sort expects a function as its second argument, got ${typeOf(comparator)}`);
      }
      return array.sort((a, b) => {
        const result = ctx.call(comparator, [a, b]);
        if (typeof result !== "number") {
          return ctx.fail(`the sort comparator must return a number, got ${typeOf(result)}`);
        }
        return result;
      });
    }),

    // ------------------------------------------------------ higher order
    define("map", [2, 2], (args, ctx) => {
      const array = expectArray(ctx, "map", args[0]!);
      const fn = args[1]!;
      if (!isCallable(fn)) return ctx.fail(`map expects a function, got ${typeOf(fn)}`);
      return array.map((item, index) => ctx.call(fn, [item, index]));
    }),

    define("filter", [2, 2], (args, ctx) => {
      const array = expectArray(ctx, "filter", args[0]!);
      const fn = args[1]!;
      if (!isCallable(fn)) return ctx.fail(`filter expects a function, got ${typeOf(fn)}`);
      return array.filter((item, index) => isTruthy(ctx.call(fn, [item, index])));
    }),

    define("reduce", [3, 3], (args, ctx) => {
      const array = expectArray(ctx, "reduce", args[0]!);
      const fn = args[2]!;
      if (!isCallable(fn)) return ctx.fail(`reduce expects a function, got ${typeOf(fn)}`);
      let accumulator: LumaValue = args[1]!;
      for (const [index, item] of array.entries()) {
        accumulator = ctx.call(fn, [accumulator, item, index]);
      }
      return accumulator;
    }),

    define("each", [2, 2], (args, ctx) => {
      const array = expectArray(ctx, "each", args[0]!);
      const fn = args[1]!;
      if (!isCallable(fn)) return ctx.fail(`each expects a function, got ${typeOf(fn)}`);
      array.forEach((item, index) => ctx.call(fn, [item, index]));
      return null;
    }),

    // -------------------------------------------------------------- hashes
    define("keys", [1, 1], (args, ctx) => {
      const value = args[0]!;
      if (!(value instanceof LumaHash)) {
        return ctx.fail(`keys expects a hash, got ${typeOf(value)}`);
      }
      return [...value.entries.keys()];
    }),

    define("values", [1, 1], (args, ctx) => {
      const value = args[0]!;
      if (!(value instanceof LumaHash)) {
        return ctx.fail(`values expects a hash, got ${typeOf(value)}`);
      }
      return [...value.entries.values()];
    }),

    define("remove", [2, 2], (args, ctx) => {
      const value = args[0]!;
      if (!(value instanceof LumaHash)) {
        return ctx.fail(`remove expects a hash, got ${typeOf(value)}`);
      }
      const copy = new LumaHash(value.entries);
      copy.entries.delete(expectHashKey(ctx, "remove", args[1]!));
      return copy;
    }),

    define("merge", [2, 2], (args, ctx) => {
      const left = args[0]!;
      const right = args[1]!;
      if (!(left instanceof LumaHash) || !(right instanceof LumaHash)) {
        return ctx.fail("merge expects two hashes");
      }
      return new LumaHash([...left.entries, ...right.entries]);
    }),

    // ------------------------------------------------------------- strings
    define("split", [1, 2], (args, ctx) => {
      const text = expectString(ctx, "split", args[0]!);
      const separator = args.length > 1 ? expectString(ctx, "split", args[1]!) : "";
      return separator === "" ? [...text] : text.split(separator);
    }),

    define("join", [1, 2], (args, ctx) => {
      const array = expectArray(ctx, "join", args[0]!);
      const separator = args.length > 1 ? expectString(ctx, "join", args[1]!) : "";
      return array.map(stringify).join(separator);
    }),

    define("upper", [1, 1], (args, ctx) =>
      expectString(ctx, "upper", args[0]!).toUpperCase(),
    ),
    define("lower", [1, 1], (args, ctx) =>
      expectString(ctx, "lower", args[0]!).toLowerCase(),
    ),
    define("trim", [1, 1], (args, ctx) => expectString(ctx, "trim", args[0]!).trim()),

    define("replace", [3, 3], (args, ctx) =>
      expectString(ctx, "replace", args[0]!).replaceAll(
        expectString(ctx, "replace", args[1]!),
        expectString(ctx, "replace", args[2]!),
      ),
    ),

    define("starts_with", [2, 2], (args, ctx) =>
      expectString(ctx, "starts_with", args[0]!).startsWith(
        expectString(ctx, "starts_with", args[1]!),
      ),
    ),

    define("ends_with", [2, 2], (args, ctx) =>
      expectString(ctx, "ends_with", args[0]!).endsWith(
        expectString(ctx, "ends_with", args[1]!),
      ),
    ),

    // ---------------------------------------------------------------- math
    define("abs", [1, 1], (args, ctx) => Math.abs(expectNumber(ctx, "abs", args[0]!))),
    define("floor", [1, 1], (args, ctx) => Math.floor(expectNumber(ctx, "floor", args[0]!))),
    define("ceil", [1, 1], (args, ctx) => Math.ceil(expectNumber(ctx, "ceil", args[0]!))),
    define("round", [1, 1], (args, ctx) => Math.round(expectNumber(ctx, "round", args[0]!))),
    define("sqrt", [1, 1], (args, ctx) => {
      const value = expectNumber(ctx, "sqrt", args[0]!);
      if (value < 0) return ctx.fail("sqrt is not defined for negative numbers");
      return Math.sqrt(value);
    }),
    define("pow", [2, 2], (args, ctx) =>
      expectNumber(ctx, "pow", args[0]!) ** expectNumber(ctx, "pow", args[1]!),
    ),
    define("min", [1, INFINITE], (args, ctx) => reduceNumbers(ctx, "min", args, Math.min)),
    define("max", [1, INFINITE], (args, ctx) => reduceNumbers(ctx, "max", args, Math.max)),
  ]);
}

function lengthOf(ctx: BuiltinContext, value: LumaValue): number {
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) return value.length;
  return ctx.fail(`expected a string or an array, got ${typeOf(value)}`);
}

function reduceNumbers(
  ctx: BuiltinContext,
  name: string,
  args: LumaValue[],
  pick: (a: number, b: number) => number,
): number {
  // Both `min(1, 2, 3)` and `min([1, 2, 3])` are accepted.
  const items = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
  if (items.length === 0) return ctx.fail(`${name} requires at least one value`);
  return items
    .map((item) => expectNumber(ctx, name, item))
    .reduce((a, b) => pick(a, b));
}
