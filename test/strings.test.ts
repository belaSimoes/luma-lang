import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { Interpreter } from "../src/interpreter.ts";
import { parse } from "../src/parser.ts";
import { tokenize } from "../src/lexer.ts";
import { run } from "../src/index.ts";
import type { LumaValue } from "../src/values.ts";

function evaluate(source: string): LumaValue {
  return new Interpreter({ stdout: () => {} }).run(source);
}

describe("string interpolation — lexing", () => {
  it("leaves a plain string as a STRING token", () => {
    const [token] = tokenize('"no holes"');
    assert.equal(token!.type, "STRING");
    assert.equal(token!.parts, undefined);
  });

  it("splits an interpolated string into parts", () => {
    const [token] = tokenize('"a{x}b"');
    assert.equal(token!.type, "TEMPLATE");
    assert.deepEqual(token!.parts, [
      { kind: "text", value: "a" },
      { kind: "expression", source: "x", position: { line: 1, column: 4 } },
      { kind: "text", value: "b" },
    ]);
  });

  it("handles a hole at either end, and back-to-back holes", () => {
    assert.equal(evaluate('let a = 1; let b = 2; "{a}{b}"'), "12");
    assert.equal(evaluate('let a = 1; "{a} trailing"'), "1 trailing");
    assert.equal(evaluate('let a = 1; "leading {a}"'), "leading 1");
  });

  it("allows braces and strings inside a hole", () => {
    assert.equal(evaluate('"{ {"k": 1}["k"] }"'), "1");
    assert.equal(evaluate(`"{ "inner" }"`), "inner");
    assert.equal(evaluate('"{ if (true) { "yes" } else { "no" } }"'), "yes");
  });

  it("keeps \\{ and \\} as literal braces", () => {
    assert.equal(evaluate(String.raw`"\{not a hole\}"`), "{not a hole}");
  });

  it("rejects an unterminated or empty hole", () => {
    assert.throws(() => parse('"{oops'), /unterminated interpolation/);
    assert.throws(() => parse('"{}"'), /empty interpolation/);
    assert.throws(() => parse('"{   }"'), /empty interpolation/);
    // `"{oops"` is ambiguous — the inner quote reads as a nested string — so
    // the honest complaint is that the outer literal never closed.
    assert.throws(() => parse('"{oops"'), /unterminated string literal/);
  });

  it("rejects more than one expression in a hole", () => {
    assert.throws(() => parse('"{1 2}"'), /each '\{…}' holds a single expression/);
  });
});

describe("string interpolation — evaluation", () => {
  it("stringifies like print, not like inspect", () => {
    // The value is inserted the way `print` shows it: no quotes around strings.
    assert.equal(evaluate('let s = "x"; "[{s}]"'), "[x]");
    assert.equal(evaluate('"{[1, "two"]}"'), '[1, "two"]');
    assert.equal(evaluate('"{nil} {true} {1.5}"'), "nil true 1.5");
  });

  it("evaluates arbitrary expressions", () => {
    assert.equal(evaluate('let n = 3; "{n * n} squared"'), "9 squared");
    assert.equal(evaluate('"{len([1, 2, 3])}"'), "3");
    assert.equal(evaluate('fn f(x) { x + 1 } "{f(1)}"'), "2");
  });

  it("works with single-quoted strings too", () => {
    assert.equal(evaluate("let a = 1; '{a}'"), "1");
  });

  it("nests", () => {
    assert.equal(evaluate('let a = "x"; "outer {"inner {a}"}"'), "outer inner x");
  });
});

describe("string interpolation — diagnostics", () => {
  it("reports an undefined name inside a hole, at its real column", () => {
    const result = run('let a = 1;\nprint("value: {missng}");');
    assert.match(result.error!, /undefined variable 'missng'/);
    assert.match(result.error!, /--> <input>:2:16/);
  });

  it("suggests a correction inside a hole", () => {
    const result = run('let total = 1;\nprint("{totl}");');
    assert.match(result.error!, /did you mean 'total'\?/);
  });

  it("reports a runtime failure inside a hole at its real position", () => {
    const result = run('print("{1 / 0}");');
    assert.match(result.error!, /division by zero/);
    assert.match(result.error!, /:1:11/);
  });
});

describe("compound assignment", () => {
  const cases: Array<[string, LumaValue]> = [
    ["let n = 10; n += 5; n", 15],
    ["let n = 10; n -= 5; n", 5],
    ["let n = 10; n *= 5; n", 50],
    ["let n = 10; n /= 4; n", 2.5],
    ["let n = 10; n %= 3; n", 1],
    ['let s = "a"; s += "b"; s', "ab"],
    ["let a = [1]; a += [2]; a", [1, 2]],
  ];

  for (const [source, expected] of cases) {
    it(source, () => assert.deepEqual(evaluate(source), expected));
  }

  it("returns the stored value, so it chains", () => {
    assert.equal(evaluate("let n = 1; n += 1"), 2);
  });

  it("updates array elements and hash values in place", () => {
    assert.deepEqual(evaluate("let a = [1, 2]; a[1] += 10; a"), [1, 12]);
    assert.equal(evaluate('let h = {"n": 1}; h.n += 41; h.n'), 42);
    assert.deepEqual(evaluate("let a = [1]; a[-1] += 1; a"), [2]);
  });

  it("evaluates the target exactly once", () => {
    // `a[next()] += 1` must not call `next` twice, which is why compound
    // assignment is a node rather than sugar for `a[i] = a[i] + 1`.
    const source = `
      let calls = 0;
      let items = [0, 0];
      fn next() { calls += 1; 0 }
      items[next()] += 5;
      [calls, items]
    `;
    assert.deepEqual(evaluate(source), [1, [5, 0]]);
  });

  it("reports the same errors a plain assignment would", () => {
    assert.throws(() => evaluate("missing += 1;"), /undeclared variable 'missing'/);
    assert.throws(() => evaluate("let a = [1]; a[9] += 1;"), /out of bounds/);
    assert.throws(() => evaluate('let n = 1; n -= "x";'), /operator '-' is not defined/);
  });

  it("inherits the overloads of the operator it applies", () => {
    // `+` concatenates when either side is a string, so `+=` does too.
    assert.equal(evaluate('let n = 1; n += "x"; n'), "1x");
  });

  it("refuses to update a hash key that does not exist", () => {
    // `h.missing += 1` would otherwise silently invent nil + 1.
    assert.throws(
      () => evaluate('let h = {}; h.missing += 1;'),
      /cannot apply '\+=' to a key that is not in the hash/,
    );
  });

  it("binds as loosely as plain assignment", () => {
    assert.equal(evaluate("let n = 1; n += 2 * 3; n"), 7);
  });
});
