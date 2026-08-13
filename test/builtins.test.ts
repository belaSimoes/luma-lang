import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { Interpreter } from "../src/interpreter.ts";
import { LumaHash, type LumaValue } from "../src/values.ts";

function evaluate(source: string): LumaValue {
  return new Interpreter({ stdout: () => {} }).run(source);
}

/** Table-driven helper: every entry is `[program, expected value]`. */
function check(cases: Array<[string, LumaValue]>): void {
  for (const [source, expected] of cases) {
    it(source, () => assert.deepEqual(evaluate(source), expected));
  }
}

describe("builtins — generic", () => {
  check([
    ['len("hello")', 5],
    ["len([1, 2, 3])", 3],
    ['len({"a": 1, "b": 2})', 2],
    ['type(1)', "number"],
    ['type("a")', "string"],
    ["type([])", "array"],
    ["type({})", "hash"],
    ["type(nil)", "nil"],
    ["type(len)", "function"],
    ["type(fn() { })", "function"],
  ]);

  it("len rejects types without a length", () => {
    assert.throws(() => evaluate("len(1)"), /len is not defined for number/);
  });

  it("assert passes silently and fails loudly", () => {
    assert.equal(evaluate("assert(1 < 2)"), null);
    assert.throws(() => evaluate("assert(false)"), /assertion failed/);
    assert.throws(() => evaluate('assert(false, "custom message")'), /custom message/);
  });
});

describe("builtins — conversions", () => {
  check([
    ["str(42)", "42"],
    ["str([1, 2])", "[1, 2]"],
    ['num("42")', 42],
    ['num("  3.5 ")', 3.5],
    ["num(true)", 1],
    ['bool("")', true],
    ["bool(nil)", false],
  ]);

  it("num rejects garbage", () => {
    assert.throws(() => evaluate('num("banana")'), /cannot convert/);
    assert.throws(() => evaluate('num("")'), /cannot convert/);
  });
});

describe("builtins — arrays", () => {
  check([
    ["push([1], 2, 3)", [1, 2, 3]],
    ["pop([1, 2, 3])", [1, 2]],
    ["first([1, 2])", 1],
    ["last([1, 2])", 2],
    ["first([])", null],
    ["rest([1, 2, 3])", [2, 3]],
    ["slice([1, 2, 3, 4], 1, 3)", [2, 3]],
    ["slice([1, 2, 3, 4], -2)", [3, 4]],
    ['slice("abcdef", 2, 4)', "cd"],
    ["reverse([1, 2, 3])", [3, 2, 1]],
    ['reverse("abc")', "cba"],
    ["contains([1, 2], 2)", true],
    ["contains([[1]], [1])", true],
    ['contains("hello", "ell")', true],
    ['contains({"a": 1}, "a")', true],
    ["index_of([10, 20], 20)", 1],
    ["index_of([10], 99)", -1],
    ["range(4)", [0, 1, 2, 3]],
    ["range(2, 5)", [2, 3, 4]],
    ["range(0, 10, 3)", [0, 3, 6, 9]],
    ["range(3, 0, -1)", [3, 2, 1]],
    ["range(5, 0)", []],
  ]);

  it("push does not mutate its input", () => {
    assert.deepEqual(evaluate("let a = [1]; push(a, 2); a"), [1]);
  });

  it("range rejects a zero step and absurd sizes", () => {
    assert.throws(() => evaluate("range(0, 10, 0)"), /step cannot be zero/);
    assert.throws(() => evaluate("range(99999999)"), /1,000,000 items/);
  });
});

describe("builtins — sorting", () => {
  check([
    ["sort([3, 1, 2])", [1, 2, 3]],
    ['sort(["pear", "apple"])', ["apple", "pear"]],
    ["sort([3, 1, 2], fn(a, b) { b - a })", [3, 2, 1]],
  ]);

  it("does not mutate its input", () => {
    assert.deepEqual(evaluate("let a = [2, 1]; sort(a); a"), [2, 1]);
  });

  it("refuses to compare mixed types without a comparator", () => {
    assert.throws(() => evaluate('sort([1, "a"])'), /cannot compare/);
  });

  it("rejects a comparator that does not return a number", () => {
    assert.throws(() => evaluate("sort([2, 1], fn(a, b) { true })"), /must return a number/);
  });
});

describe("builtins — higher order", () => {
  check([
    ["map([1, 2, 3], fn(n) { n * n })", [1, 4, 9]],
    ["map([1, 2], fn(n, i) { [i, n] })", [[0, 1], [1, 2]]],
    ["filter([1, 2, 3, 4], fn(n) { n % 2 == 0 })", [2, 4]],
    ["reduce([1, 2, 3], 0, fn(acc, n) { acc + n })", 6],
    ['reduce(["a", "b"], "", fn(acc, s) { acc + s })', "ab"],
  ]);

  it("each runs for its side effects and returns nil", () => {
    const lines: string[] = [];
    new Interpreter({ stdout: (line) => lines.push(line) }).run(
      "each([1, 2], fn(n) { print(n) })",
    );
    assert.deepEqual(lines, ["1", "2"]);
  });

  it("lets a callback declare fewer parameters than it is offered", () => {
    assert.deepEqual(evaluate("map([1, 2], fn(n) { n })"), [1, 2]);
    assert.equal(evaluate("reduce([1, 2], 0, fn(a, b) { a + b })"), 3);
  });

  it("rejects non-functions", () => {
    assert.throws(() => evaluate("map([1], 2)"), /map expects a function, got number/);
  });
});

describe("builtins — hashes", () => {
  check([
    ['keys({"a": 1, "b": 2})', ["a", "b"]],
    ['values({"a": 1, "b": 2})', [1, 2]],
  ]);

  it("remove and merge return new hashes", () => {
    const removed = evaluate('let h = {"a": 1, "b": 2}; let r = remove(h, "a"); [len(h), len(r)]');
    assert.deepEqual(removed, [2, 1]);

    const merged = evaluate('merge({"a": 1}, {"b": 2})');
    assert.ok(merged instanceof LumaHash);
    assert.deepEqual([...(merged as LumaHash).entries], [["a", 1], ["b", 2]]);
  });

  it("later keys win when merging", () => {
    assert.equal(evaluate('merge({"a": 1}, {"a": 9})["a"]'), 9);
  });

  it("rejects non-hash arguments", () => {
    assert.throws(() => evaluate("keys([1])"), /keys expects a hash, got array/);
  });
});

describe("builtins — strings", () => {
  check([
    ['split("a,b,c", ",")', ["a", "b", "c"]],
    ['split("abc")', ["a", "b", "c"]],
    ['join(["a", "b"], "-")', "a-b"],
    ['join([1, 2])', "12"],
    ['upper("abc")', "ABC"],
    ['lower("ABC")', "abc"],
    ['trim("  hi  ")', "hi"],
    ['replace("a-b-c", "-", "+")', "a+b+c"],
    ['starts_with("luma", "lu")', true],
    ['ends_with("luma", "ma")', true],
  ]);

  it("reports the offending type", () => {
    assert.throws(() => evaluate("upper(1)"), /upper expects a string, got number/);
  });
});

describe("builtins — math", () => {
  check([
    ["abs(-3)", 3],
    ["floor(3.7)", 3],
    ["ceil(3.2)", 4],
    ["round(3.5)", 4],
    ["sqrt(16)", 4],
    ["pow(2, 10)", 1024],
    ["min(3, 1, 2)", 1],
    ["max([3, 1, 2])", 3],
  ]);

  it("rejects the square root of a negative number", () => {
    assert.throws(() => evaluate("sqrt(-1)"), /not defined for negative/);
  });

  it("requires at least one value", () => {
    assert.throws(() => evaluate("min([])"), /at least one value/);
  });
});

describe("builtins — arity", () => {
  it("reports a fixed arity", () => {
    assert.throws(() => evaluate("len()"), /len expects 1 argument, got 0/);
    assert.throws(() => evaluate("len([], [])"), /len expects 1 argument, got 2/);
  });

  it("reports a range", () => {
    assert.throws(() => evaluate("range()"), /range expects between 1 and 3 arguments, got 0/);
  });

  it("reports an open-ended arity", () => {
    assert.throws(() => evaluate("push([])"), /push expects at least 2 arguments, got 1/);
  });

  it("accepts print with any number of arguments", () => {
    assert.equal(evaluate("print()"), null);
    assert.equal(evaluate("print(1, 2, 3, 4, 5)"), null);
  });
});
