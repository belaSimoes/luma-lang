import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { run, trace } from "../src/index.ts";
import type { TraceStep } from "../src/tracer.ts";

function stepsOf(source: string): TraceStep[] {
  return trace(source, { stdout: () => {} }).steps;
}

/** All variables visible at a step, flattened innermost-first. */
function variablesAt(step: TraceStep): Record<string, string> {
  const out: Record<string, string> = {};
  for (const scope of [...step.scopes].reverse()) {
    for (const [name, value] of scope.variables) out[name] = value;
  }
  return out;
}

describe("tracer — recording", () => {
  it("records one step per statement, in execution order", () => {
    const steps = stepsOf("let a = 1;\nlet b = 2;\nlet c = a + b;");
    assert.deepEqual(
      steps.map((step) => step.line),
      [1, 2, 3],
    );
    assert.deepEqual(
      steps.map((step) => step.kind),
      ["statement", "statement", "statement"],
    );
  });

  it("labels a step with its source line", () => {
    const [first] = stepsOf("  let a = 1;  ");
    assert.equal(first!.label, "let a = 1;");
  });

  it("numbers steps consecutively from zero", () => {
    const steps = stepsOf("let a = 1; let b = 2;");
    assert.deepEqual(
      steps.map((step) => step.index),
      [0, 1],
    );
  });

  it("records loop bodies once per iteration", () => {
    const lines = stepsOf("for (i in range(3)) { print(i); }").map((step) => step.line);
    // One step for the `for` itself, then the body three times.
    assert.equal(lines.filter((line) => line === 1).length, 4);
  });

  it("records nothing for a program that fails to analyse", () => {
    assert.deepEqual(stepsOf("print(missing);"), []);
  });
});

describe("tracer — calls", () => {
  const source = "fn double(n) { n * 2 }\nlet result = double(21);";

  it("brackets a call with call and return steps", () => {
    const kinds = stepsOf(source).map((step) => step.kind);
    assert.deepEqual(kinds, ["statement", "statement", "call", "statement", "return"]);
  });

  it("labels a call with its arguments and a return with its value", () => {
    const steps = stepsOf(source);
    assert.equal(steps.find((step) => step.kind === "call")!.label, "double(21)");
    assert.equal(steps.find((step) => step.kind === "return")!.label, "=> 42");
  });

  it("tracks the call stack, innermost first", () => {
    const steps = stepsOf("fn outer() { inner() }\nfn inner() { 1 }\nouter();");
    const deepest = steps.reduce((a, b) => (b.stack.length > a.stack.length ? b : a));
    assert.deepEqual(deepest.stack, ["inner(...)", "outer(...)"]);
  });

  it("records the value of an explicit return", () => {
    const steps = stepsOf("fn f() { return 7; }\nf();");
    assert.equal(steps.find((step) => step.kind === "return")!.label, "=> 7");
  });
});

describe("tracer — snapshots", () => {
  it("captures variables visible at each step", () => {
    const steps = stepsOf("let a = 1;\nlet b = 2;\nlet c = 3;");
    assert.deepEqual(variablesAt(steps[0]!), {});
    assert.deepEqual(variablesAt(steps[1]!), { a: "1" });
    assert.deepEqual(variablesAt(steps[2]!), { a: "1", b: "2" });
  });

  it("snapshots before the step runs, which is what a debugger shows", () => {
    const steps = stepsOf("let a = 1;\na = 2;\nprint(a);");
    assert.equal(variablesAt(steps[1]!)["a"], "1", "the assignment has not run yet");
    assert.equal(variablesAt(steps[2]!)["a"], "2");
  });

  it("freezes values, so a later mutation cannot rewrite history", () => {
    // The array is mutated in place; the earlier snapshot must not follow it.
    const steps = stepsOf("let a = [1];\na[0] = 99;\nprint(a);");
    assert.equal(variablesAt(steps[1]!)["a"], "[1]");
    assert.equal(variablesAt(steps[2]!)["a"], "[99]");
  });

  it("shows a function's parameters inside its frame", () => {
    const steps = stepsOf("fn f(n) { n * 2 }\nf(21);");
    const inside = steps.find((step) => step.kind === "call")!;
    assert.equal(variablesAt(inside)["n"], "21");
  });

  it("hides the builtins so snapshots stay readable", () => {
    const [first] = stepsOf("let a = 1;");
    const names = first!.scopes.flatMap((scope) => scope.variables.map(([name]) => name));
    assert.ok(!names.includes("print"), "builtins should not appear");
    assert.ok(!names.includes("len"));
  });

  it("elides a very long value rather than dumping it", () => {
    const [, second] = stepsOf('let big = "x" * 500;\nprint(1);');
    assert.ok(variablesAt(second!)["big"]!.length < 140);
    assert.match(variablesAt(second!)["big"]!, /…$/);
  });
});

describe("tracer — limits and failures", () => {
  it("stops at the step budget and says so", () => {
    const result = trace("let i = 0;\nwhile (i < 1000) { i += 1; }", {
      stdout: () => {},
      maxSteps: 50,
    });
    assert.equal(result.steps.length, 50);
    assert.equal(result.truncated, true);
  });

  it("does not mark a short program as truncated", () => {
    assert.equal(trace("let a = 1;", { stdout: () => {} }).truncated, false);
  });

  it("keeps everything recorded before a runtime failure", () => {
    const result = trace('let a = 1;\nlet b = 2;\nprint(1 / 0);', { stdout: () => {} });
    assert.equal(result.ok, false);
    assert.match(result.error!, /division by zero/);
    // The timeline still leads right up to the failing line.
    assert.equal(result.steps.at(-1)!.line, 3);
  });

  it("captures printed output alongside the timeline", () => {
    const result = trace('print("a"); print("b");', { stdout: () => {} });
    assert.deepEqual(result.output, ["a", "b"]);
  });
});

describe("tracer — observability", () => {
  const programs = [
    "let a = 1; print(a); a + 1",
    "fn fib(n) { if (n < 2) { n } else { fib(n-1) + fib(n-2) } } print(fib(8));",
    'let out = []; for (n in range(4)) { out = push(out, n * n); } print(out);',
    'match (2) { 1 -> print("one"), n -> print("got {n}") }',
    "let a = [1]; a[0] += 41; print(a);",
  ];

  for (const source of programs) {
    it(`recording does not change what ${JSON.stringify(source.slice(0, 32))}… does`, () => {
      // The recorder must observe, never participate: same output, same result.
      const plain = run(source, { stdout: () => {} });
      const traced = trace(source, { stdout: () => {} });

      assert.deepEqual(traced.output, plain.output);
      assert.equal(traced.ok, plain.ok);
      assert.ok(traced.steps.length > 0);
    });
  }
});
