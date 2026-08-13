import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parse } from "../src/parser.ts";
import { resolve } from "../src/resolver.ts";
import { createBuiltins } from "../src/builtins.ts";
import { check } from "../src/index.ts";

const GLOBALS = [...createBuiltins().keys()];

function analyse(source: string): { errors: string[]; warnings: string[] } {
  const result = resolve(parse(source), { globals: GLOBALS });
  return {
    errors: result.errors.map((error) => error.message),
    warnings: result.warnings.map((warning) => warning.message),
  };
}

function errorsIn(source: string): string[] {
  return analyse(source).errors;
}

/** Programs that must analyse cleanly — the resolver's false-positive guard. */
const CLEAN: Array<[string, string]> = [
  ["a plain binding", "let a = 1; print(a);"],
  ["a builtin", "print(len([1]));"],
  ["shadowing in a block", "let a = 1; { let a = 2; print(a); } print(a);"],
  ["a parameter", "fn f(x) { x + 1 } f(1);"],
  ["a closure over an outer binding", "let n = 1; fn f() { n } f();"],
  ["self recursion", "fn fact(n) { if (n < 2) { 1 } else { n * fact(n - 1) } } fact(3);"],
  [
    "mutual recursion declared out of order",
    "fn even(n) { if (n == 0) { true } else { odd(n - 1) } }\n" +
      "fn odd(n) { if (n == 0) { false } else { even(n - 1) } }\n" +
      "even(4);",
  ],
  ["a name declared after the function that uses it", "fn f() { later } let later = 1; f();"],
  ["a named function expression calling itself", "let f = fn me(n) { if (n > 0) { me(n - 1) } }; f(2);"],
  ["a for-loop variable", "for (item in [1, 2]) { print(item); }"],
  ["break and continue inside a loop", "while (true) { if (true) { break; } continue; }"],
  ["break inside a for loop", "for (n in [1]) { break; }"],
  ["return inside a function", "fn f() { return 1; }"],
  ["return inside a nested block of a function", "fn f() { if (true) { return 1; } 2 }"],
  ["return inside a closure inside a loop", "while (true) { let f = fn() { return 1; }; break; }"],
  ["assignment to a declared name", "let a = 1; a = 2;"],
  ["assignment to an outer name from a block", "let a = 1; { a = 2; }"],
  ["index assignment", "let a = [1]; a[0] = 2;"],
];

describe("resolver — accepts valid programs", () => {
  for (const [label, source] of CLEAN) {
    it(label, () => {
      assert.deepEqual(analyse(source), { errors: [], warnings: [] });
    });
  }
});

describe("resolver — undefined names", () => {
  it("rejects a reference to a name that was never declared", () => {
    assert.deepEqual(errorsIn("print(missing);"), ["undefined variable 'missing'"]);
  });

  it("rejects a name that has gone out of scope", () => {
    assert.deepEqual(errorsIn("{ let inner = 1; } print(inner);"), [
      "undefined variable 'inner'",
    ]);
  });

  it("rejects a parameter used outside its function", () => {
    assert.deepEqual(errorsIn("fn f(x) { x } print(x);"), ["undefined variable 'x'"]);
  });

  it("rejects a loop variable used after the loop", () => {
    assert.deepEqual(errorsIn("for (item in [1]) { } print(item);"), [
      "undefined variable 'item'",
    ]);
  });

  it("rejects assignment to an undeclared name", () => {
    assert.deepEqual(errorsIn("nope = 1;"), [
      "cannot assign to undeclared variable 'nope'",
    ]);
  });

  it("finds mistakes inside function bodies, not just at the top level", () => {
    assert.deepEqual(errorsIn("fn f() { oops }"), ["undefined variable 'oops'"]);
  });

  it("reports every undefined name rather than only the first", () => {
    assert.deepEqual(errorsIn("print(one); print(two); print(three);"), [
      "undefined variable 'one'",
      "undefined variable 'two'",
      "undefined variable 'three'",
    ]);
  });

  it("does not treat a hash key written with dot access as a variable", () => {
    assert.deepEqual(errorsIn('let h = {"a": 1}; h.a;'), []);
  });
});

describe("resolver — misplaced control flow", () => {
  it("rejects break and continue outside a loop", () => {
    assert.deepEqual(errorsIn("break;"), ["'break' outside of a loop"]);
    assert.deepEqual(errorsIn("continue;"), ["'continue' outside of a loop"]);
    assert.deepEqual(errorsIn("if (true) { break; }"), ["'break' outside of a loop"]);
  });

  it("rejects break inside a function nested in a loop", () => {
    // The function may be called anywhere, so it cannot break the enclosing loop.
    assert.deepEqual(errorsIn("while (true) { let f = fn() { break; }; }"), [
      "'break' outside of a loop",
    ]);
  });

  it("rejects return outside a function", () => {
    assert.deepEqual(errorsIn("return 1;"), ["'return' outside of a function"]);
    assert.deepEqual(errorsIn("while (true) { return 1; }"), [
      "'return' outside of a function",
    ]);
  });
});

describe("resolver — warnings", () => {
  it("flags code after a return", () => {
    const { errors, warnings } = analyse("fn f() { return 1; print(2); }");
    assert.deepEqual(errors, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /unreachable code: the 'return' above/);
  });

  it("flags code after a break or continue", () => {
    assert.equal(analyse("while (true) { break; print(1); }").warnings.length, 1);
    assert.equal(analyse("while (true) { continue; print(1); }").warnings.length, 1);
  });

  it("does not flag a trailing return", () => {
    assert.deepEqual(analyse("fn f() { print(1); return 2; }").warnings, []);
  });

  it("keeps analysing the unreachable statements so their own bugs still surface", () => {
    const { errors, warnings } = analyse("fn f() { return 1; print(missing); }");
    assert.deepEqual(errors, ["undefined variable 'missing'"]);
    assert.equal(warnings.length, 1);
  });
});

describe("check() — analysis without execution", () => {
  it("reports a clean program as ok", () => {
    assert.deepEqual(check("let a = 1; print(a);"), {
      report: null,
      errorCount: 0,
      warningCount: 0,
      ok: true,
    });
  });

  it("surfaces syntax errors as well as semantic ones", () => {
    const result = check("let = 1;");
    assert.equal(result.ok, false);
    assert.equal(result.errorCount, 1);
    assert.match(result.report!, /error\[syntax]/);
  });

  it("counts warnings without failing the program", () => {
    const result = check("fn f() { return 1; print(2); }");
    assert.equal(result.ok, true);
    assert.equal(result.warningCount, 1);
    assert.match(result.report!, /warning\[semantic]/);
  });

  it("never executes the program it is checking", () => {
    // If `check` ran anything, this would loop forever instead of returning.
    assert.equal(check("while (true) { }").ok, true);
  });
});
