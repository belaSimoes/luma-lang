import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { Interpreter } from "../src/interpreter.ts";
import { parse } from "../src/parser.ts";
import { resolve } from "../src/resolver.ts";
import { createBuiltins } from "../src/builtins.ts";
import type { LumaValue } from "../src/values.ts";

function evaluate(source: string): LumaValue {
  return new Interpreter({ stdout: () => {} }).run(source);
}

/** Match `subject` against a single-arm table, returning the arm's result. */
function match(subject: string, arms: string): LumaValue {
  return evaluate(`match (${subject}) { ${arms} }`);
}

function errorsIn(source: string): string[] {
  return resolve(parse(source), { globals: [...createBuiltins().keys()] }).errors.map(
    (error) => error.message,
  );
}

describe("match — literal patterns", () => {
  const cases: Array<[string, string, LumaValue]> = [
    ["0", '0 -> "zero", _ -> "other"', "zero"],
    ["5", '0 -> "zero", _ -> "other"', "other"],
    ["-1", '-1 -> "minus one", _ -> "other"', "minus one"],
    ["2.5", '2.5 -> "exact", _ -> "other"', "exact"],
    ['"a"', '"a" -> 1, _ -> 2', 1],
    ["true", "true -> 1, false -> 2", 1],
    ["false", "true -> 1, false -> 2", 2],
    ["nil", "nil -> 1, _ -> 2", 1],
    ["0", 'nil -> 1, _ -> 2', 2],
  ];

  for (const [subject, arms, expected] of cases) {
    it(`match (${subject}) { ${arms} }`, () => {
      assert.deepEqual(match(subject, arms), expected);
    });
  }

  it("compares structurally, like ==", () => {
    assert.equal(evaluate('match ([1, [2]]) { [1, [2]] -> "same", _ -> "different" }'), "same");
  });

  it("does not coerce between types", () => {
    assert.equal(match('"1"', '1 -> "number", _ -> "not"'), "not");
  });
});

describe("match — binding and wildcards", () => {
  it("binds the subject to a name", () => {
    assert.equal(evaluate("match (21) { n -> n * 2 }"), 42);
  });

  it("keeps a binding scoped to its arm", () => {
    assert.deepEqual(errorsIn("match (1) { n -> n }; n;"), ["undefined variable 'n'"]);
  });

  it("treats _ as a wildcard that binds nothing", () => {
    assert.equal(match("99", '_ -> "anything"'), "anything");
    assert.deepEqual(errorsIn("match (1) { _ -> _ }"), ["undefined variable '_'"]);
  });

  it("shadows an outer binding without disturbing it", () => {
    assert.deepEqual(evaluate('let n = "outer"; let inner = match (1) { n -> n }; [inner, n]'), [
      1,
      "outer",
    ]);
  });
});

describe("match — array patterns", () => {
  const cases: Array<[string, string, LumaValue]> = [
    ["[]", '[] -> "empty", _ -> "other"', "empty"],
    ["[1]", '[] -> "empty", [x] -> x, _ -> "other"', 1],
    ["[1, 2]", "[a, b] -> a + b, _ -> 0", 3],
    ["[1, 2, 3]", "[a, b] -> a + b, _ -> 0", 0],
    ["[1, 2, 3]", "[first, ...rest] -> rest, _ -> nil", [2, 3]],
    ["[1]", "[first, ...rest] -> rest, _ -> nil", []],
    ["[]", "[first, ...rest] -> rest, _ -> \"no\"", "no"],
    ["[[1, 2]]", "[[a, b]] -> a * b, _ -> 0", 2],
    ["[1, [2, 3]]", "[a, [b, c]] -> a + b + c, _ -> 0", 6],
    ['"ab"', '[a, b] -> "matched", _ -> "not an array"', "not an array"],
  ];

  for (const [subject, arms, expected] of cases) {
    it(`match (${subject}) { ${arms} }`, () => {
      assert.deepEqual(match(subject, arms), expected);
    });
  }

  it("matches a fixed-length pattern only against that exact length", () => {
    assert.equal(match("[1, 2, 3]", '[_, _] -> "two", [_, _, _] -> "three", _ -> "?"'), "three");
  });

  it("lets ...rest match zero remaining elements", () => {
    assert.deepEqual(match("[1, 2]", "[a, b, ...rest] -> rest, _ -> nil"), []);
  });
});

describe("match — hash patterns", () => {
  it("matches on the listed keys and ignores the rest", () => {
    const source = 'match ({"type": "circle", "r": 2, "extra": 1}) { {"type": "circle", "r": r} -> r, _ -> nil }';
    assert.equal(evaluate(source), 2);
  });

  it("fails when a listed key is missing", () => {
    assert.equal(evaluate('match ({"a": 1}) { {"b": _} -> "yes", _ -> "no" }'), "no");
  });

  it("distinguishes a missing key from one holding nil", () => {
    assert.equal(evaluate('match ({"a": nil}) { {"a": nil} -> "present", _ -> "absent" }'), "present");
    assert.equal(evaluate('match ({}) { {"a": nil} -> "present", _ -> "absent" }'), "absent");
  });

  it("binds nested values", () => {
    const source = 'match ({"user": {"name": "Ada"}}) { {"user": {"name": n}} -> n, _ -> nil }';
    assert.equal(evaluate(source), "Ada");
  });

  it("does not match a non-hash", () => {
    assert.equal(evaluate('match ([1]) { {"a": _} -> "hash", _ -> "not" }'), "not");
  });

  it("accepts number and boolean keys", () => {
    assert.equal(evaluate('match ({1: "one"}) { {1: v} -> v, _ -> nil }'), "one");
  });
});

describe("match — alternatives and guards", () => {
  it("tries each alternative", () => {
    assert.equal(match("2", '1 | 2 | 3 -> "small", _ -> "big"'), "small");
    assert.equal(match("9", '1 | 2 | 3 -> "small", _ -> "big"'), "big");
  });

  it("falls through to the next arm when a guard fails", () => {
    assert.equal(evaluate('match (5) { n if n > 10 -> "big", n -> "small" }'), "small");
  });

  it("sees the pattern's bindings inside the guard", () => {
    assert.equal(evaluate('match ([1, 2]) { [a, b] if a < b -> "sorted", _ -> "not" }'), "sorted");
  });

  it("rejects alternatives that bind names", () => {
    assert.throws(
      () => parse("match (1) { a | b -> a }"),
      /alternatives in a pattern may not bind names/,
    );
  });
});

describe("match — arm selection", () => {
  it("takes the first matching arm, in source order", () => {
    assert.equal(match("1", '_ -> "wildcard", 1 -> "literal"'), "wildcard");
    assert.equal(match("1", '1 -> "literal", _ -> "wildcard"'), "literal");
  });

  it("fails at runtime when nothing matches", () => {
    assert.throws(() => evaluate('match (9) { 1 -> "a" }'), /no match arm matched 9/);
    assert.throws(() => evaluate('match ("x") { 1 -> "a" }'), /no match arm matched "x"/);
  });

  it("evaluates the subject exactly once", () => {
    const source = `
      let calls = 0;
      fn subject() { calls += 1; 1 }
      match (subject()) { 1 -> nil, _ -> nil };
      calls
    `;
    assert.equal(evaluate(source), 1);
  });

  it("accepts a block as an arm body", () => {
    assert.equal(evaluate("match (2) { n -> { let doubled = n * 2; doubled + 1 } }"), 5);
  });

  it("is an expression, usable anywhere one is", () => {
    assert.deepEqual(evaluate('map([1, 2], fn(n) { match (n) { 1 -> "one", _ -> "many" } })'), [
      "one",
      "many",
    ]);
  });
});

describe("match — syntax errors", () => {
  const invalid: Array<[string, RegExp]> = [
    ["match 1 { _ -> 1 }", /expected '\('/],
    ["match (1) { }", /at least one arm/],
    ["match (1) { _ 1 }", /expected '->'/],
    ["match (1) { _ -> 1 _ -> 2 }", /',' or '}' between match arms/],
    ["match (1) { [a, ...rest, b] -> 1 }", /'\.\.\.rest' must be the last element/],
    // "end of input" also tells the REPL the snippet is merely unfinished.
    ["match (1) { _ -> 1", /end of input/],
    ["match (1) { 1 -> 1,", /unclosed match/],
    ["match (1) { + -> 1 }", /unexpected '\+' in a pattern/],
  ];

  for (const [source, pattern] of invalid) {
    it(`rejects ${JSON.stringify(source)}`, () => {
      assert.throws(() => parse(source), pattern);
    });
  }
});
