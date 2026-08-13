import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { run } from "../src/index.ts";
import { Interpreter } from "../src/interpreter.ts";
import { LumaError, formatError, toDiagnostics } from "../src/errors.ts";
import { parse } from "../src/parser.ts";

function evaluate(source: string): void {
  new Interpreter({ stdout: () => {} }).run(source);
}

/** Diagnostics produced by running a program, whether static or at runtime. */
function diagnosticsOf(source: string): LumaError[] {
  try {
    evaluate(source);
    return [];
  } catch (error) {
    const diagnostics = toDiagnostics(error);
    if (diagnostics === null) throw error;
    return diagnostics;
  }
}

function positionOf(source: string): { line: number; column: number } {
  const [first] = diagnosticsOf(source);
  assert.ok(first !== undefined, "expected the program to fail");
  return first.position;
}

describe("errors — runtime failures", () => {
  const failures: Array<[string, RegExp]> = [
    ["1 / 0", /division by zero/],
    ["1 % 0", /modulo by zero/],
    ["1 + [1]", /operator '\+' is not defined for number and array/],
    ['-"abc"', /unary '-' is not defined for string/],
    ["nil[0]", /cannot index into nil/],
    ['[1]["a"]', /array indices must be whole numbers, got string/],
    ["[1][1.5]", /array indices must be whole numbers/],
    ["let n = 1; n.field = 2", /cannot assign into number/],
    ["true()", /is not a function/],
  ];

  for (const [source, pattern] of failures) {
    it(`${source} fails with ${pattern.source}`, () => {
      assert.throws(() => evaluate(source), pattern);
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
    const [error] = diagnosticsOf("fn outer() { inner() } fn inner() { 1 / 0 } outer()");
    assert.ok(error !== undefined);
    assert.deepEqual(error.frames, ["inner(...)", "outer(...)"]);
  });

  it("never lets an internal control-flow signal escape as a host exception", () => {
    // `break`/`return` outside their construct are rejected statically, but an
    // interpreter driven with a hand-built AST must still fail gracefully.
    const interpreter = new Interpreter({ stdout: () => {} });
    for (const source of ["break;", "continue;", "return 1;"]) {
      assert.throws(
        () => interpreter.evalProgram(parse(source)),
        (error: unknown) => error instanceof LumaError && /outside of a/.test(error.message),
        `evaluating ${JSON.stringify(source)} should raise a Luma error`,
      );
    }
  });
});

describe("errors — positions", () => {
  it("points at the failing expression, not the statement", () => {
    // The `*` in `nil * 2` is the operator that fails, at column 17.
    assert.deepEqual(positionOf("let a = 1;\nlet b = a + nil * 2;"), { line: 2, column: 17 });
  });

  it("points at the operator for a type mismatch", () => {
    assert.deepEqual(positionOf("1 + [1]"), { line: 1, column: 3 });
  });

  it("reports syntax errors at the offending token", () => {
    const [error] = diagnosticsOf("let a = ;");
    assert.ok(error !== undefined);
    assert.equal(error.phase, "syntax");
    assert.deepEqual(error.position, { line: 1, column: 9 });
  });

  it("reports semantic errors at the offending name", () => {
    const [error] = diagnosticsOf("let a = 1;\nprint(missing);");
    assert.ok(error !== undefined);
    assert.equal(error.phase, "semantic");
    assert.deepEqual(error.position, { line: 2, column: 7 });
  });
});

describe("errors — rendering", () => {
  it("renders an annotated snippet", () => {
    const source = "let a = 1;\nprint(missing);\n";
    const result = run(source, { file: "script.luma" });

    assert.equal(result.ok, false);
    assert.equal(
      result.error,
      [
        "error[semantic]: undefined variable 'missing'",
        " --> script.luma:2:7",
        "  |",
        "2 | print(missing);",
        "  |       ^^^^^^^",
      ].join("\n"),
    );
  });

  it("suggests the name the author probably meant", () => {
    const result = run("let height = 10;\nprint(hieght);");
    assert.match(result.error!, /= help: did you mean 'height'\?/);
  });

  it("does not invent a suggestion for a name unlike anything in scope", () => {
    const result = run("print(zzzzzzzz);");
    assert.doesNotMatch(result.error!, /did you mean/);
  });

  it("underlines the whole identifier", () => {
    const result = run("longVariableName");
    assert.match(result.error!, /\^{16}/);
  });

  it("renders several diagnostics in source order, with a tally", () => {
    const rendered = run("print(one);\nprint(two);").error!;

    assert.ok(
      rendered.indexOf("'one'") < rendered.indexOf("'two'"),
      "diagnostics should be ordered by position",
    );
    assert.match(rendered, /2 errors found/);
  });

  it("emits ANSI colours only when asked", () => {
    const source = "1 / 0";
    const [error] = diagnosticsOf(source);
    assert.ok(error !== undefined);

    const ansi = new RegExp(String.fromCharCode(27) + "\\[\\d");
    assert.doesNotMatch(formatError(error, source, { color: false }), ansi);
    assert.match(formatError(error, source, { color: true }), ansi);
  });

  it("labels warnings differently from errors", () => {
    const result = run("fn f() { return 1; print(2); } f();");
    assert.equal(result.ok, true);
    assert.match(result.warnings!, /^warning\[semantic]: unreachable code/);
  });

  it("degrades gracefully when the position is out of range", () => {
    const error = new LumaError("runtime", "synthetic", { line: 99, column: 1 });
    assert.equal(formatError(error, "one line only"), "error[runtime]: synthetic");
  });
});

describe("errors — the run() facade", () => {
  it("captures output produced before a runtime failure", () => {
    const result = run('print("before"); 1 / 0;');
    assert.equal(result.ok, false);
    assert.deepEqual(result.output, ["before"]);
    assert.equal(result.value, null);
  });

  it("runs nothing at all when the program fails to analyse", () => {
    // The whole point of the resolver: no side effect happens before the
    // program is known to be well-formed.
    const result = run('print("before"); missing;');
    assert.equal(result.ok, false);
    assert.deepEqual(result.output, []);
  });

  it("returns the final value on success", () => {
    assert.deepEqual(run('print("hi"); 1 + 1'), {
      value: 2,
      output: ["hi"],
      error: null,
      warnings: null,
      ok: true,
    });
  });
});
