import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { run } from "../src/index.ts";
import { Interpreter } from "../src/interpreter.ts";
import { LumaError, formatError } from "../src/errors.ts";
import { parse } from "../src/parser.ts";

function positionOf(source: string): { line: number; column: number } {
  try {
    new Interpreter({ stdout: () => {} }).run(source);
  } catch (error) {
    assert.ok(error instanceof LumaError, "expected a LumaError");
    return error.position;
  }
  return assert.fail("expected the program to fail");
}

describe("errors — runtime failures", () => {
  const failures: Array<[string, RegExp]> = [
    ["1 / 0", /division by zero/],
    ["1 % 0", /modulo by zero/],
    ["missing", /undefined variable 'missing'/],
    ["missing = 1", /undeclared variable 'missing'/],
    ['1 + [1]', /operator '\+' is not defined for number and array/],
    ['-"abc"', /unary '-' is not defined for string/],
    ["nil[0]", /cannot index into nil/],
    ['[1][\"a\"]', /array indices must be whole numbers, got string/],
    ["[1][1.5]", /array indices must be whole numbers/],
    ["let n = 1; n.field = 2", /cannot assign into number/],
    ["true()", /is not a function/],
  ];

  for (const [source, pattern] of failures) {
    it(`${source} fails with ${pattern.source}`, () => {
      assert.throws(() => new Interpreter({ stdout: () => {} }).run(source), pattern);
    });
  }

  it("stops infinite recursion with a Luma error, not a stack overflow", () => {
    const interpreter = new Interpreter({ maxCallDepth: 64, stdout: () => {} });
    assert.throws(
      () => interpreter.run("fn loop(n) { loop(n + 1) } loop(0)"),
      /maximum call depth of 64 exceeded/,
    );
  });

  it("attaches the call stack, innermost first", () => {
    try {
      new Interpreter({ stdout: () => {} }).run(
        "fn outer() { inner() } fn inner() { boom } outer()",
      );
      assert.fail("expected a runtime error");
    } catch (error) {
      assert.ok(error instanceof LumaError);
      assert.deepEqual(error.frames, ["inner(...)", "outer(...)"]);
    }
  });
});

describe("errors — positions", () => {
  it("points at the failing expression, not the statement", () => {
    assert.deepEqual(positionOf("let a = 1;\nlet b = a + missing;"), { line: 2, column: 13 });
  });

  it("points at the operator for a type mismatch", () => {
    assert.deepEqual(positionOf('1 + [1]'), { line: 1, column: 3 });
  });

  it("reports syntax errors at the offending token", () => {
    try {
      parse("let a = ;");
      assert.fail("expected a syntax error");
    } catch (error) {
      assert.ok(error instanceof LumaError);
      assert.equal(error.phase, "syntax");
      assert.deepEqual(error.position, { line: 1, column: 9 });
    }
  });
});

describe("errors — rendering", () => {
  it("renders an annotated snippet", () => {
    const source = 'let a = 1;\nprint(missing);\n';
    const result = run(source, { file: "script.luma" });

    assert.equal(result.ok, false);
    assert.equal(
      result.error,
      [
        "error[runtime]: undefined variable 'missing'",
        " --> script.luma:2:7",
        "  |",
        "2 | print(missing);",
        "  |       ^^^^^^^",
      ].join("\n"),
    );
  });

  it("underlines the whole identifier", () => {
    const result = run("longVariableName");
    assert.match(result.error!, /\^{16}/);
  });

  it("emits ANSI colours only when asked", () => {
    const source = "boom";
    let error: LumaError | null = null;
    try {
      new Interpreter({ stdout: () => {} }).run(source);
    } catch (caught) {
      error = caught as LumaError;
    }
    assert.ok(error);
    const ansi = new RegExp(String.fromCharCode(27) + "\\[\\d");
    assert.doesNotMatch(formatError(error, source, { color: false }), ansi);
    assert.match(formatError(error, source, { color: true }), ansi);
  });

  it("degrades gracefully when the position is out of range", () => {
    const error = new LumaError("runtime", "synthetic", { line: 99, column: 1 });
    assert.equal(formatError(error, "one line only"), "error[runtime]: synthetic");
  });
});

describe("errors — the run() facade", () => {
  it("captures output produced before the failure", () => {
    const result = run('print("before"); boom;');
    assert.equal(result.ok, false);
    assert.deepEqual(result.output, ["before"]);
    assert.equal(result.value, null);
  });

  it("returns the final value on success", () => {
    const result = run('print("hi"); 1 + 1');
    assert.deepEqual(result, { value: 2, output: ["hi"], error: null, ok: true });
  });
});
