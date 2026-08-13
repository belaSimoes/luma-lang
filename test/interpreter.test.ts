import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { Interpreter } from "../src/interpreter.ts";
import { LumaHash, inspect, type LumaValue } from "../src/values.ts";

/** Evaluate a program and return the value of its last statement. */
function evaluate(source: string): LumaValue {
  return new Interpreter().run(source);
}

/** Evaluate a program and return everything it printed. */
function outputOf(source: string): string[] {
  const lines: string[] = [];
  new Interpreter({ stdout: (line) => lines.push(line) }).run(source);
  return lines;
}

/** Evaluate and render the result the way the REPL would. */
function show(source: string): string {
  return inspect(evaluate(source));
}

describe("interpreter — expressions", () => {
  const arithmetic: Array<[string, number]> = [
    ["1 + 2", 3],
    ["10 - 4 - 3", 3],
    ["2 * 3 + 4", 10],
    ["2 + 3 * 4", 14],
    ["(2 + 3) * 4", 20],
    ["-5 + 10", 5],
    ["7 % 3", 1],
    ["10 / 4", 2.5],
    ["2 * (3 + 4) % 5", 4],
  ];

  for (const [source, expected] of arithmetic) {
    it(`${source} == ${expected}`, () => assert.equal(evaluate(source), expected));
  }

  it("compares numbers and strings", () => {
    assert.equal(evaluate("1 < 2"), true);
    assert.equal(evaluate("2 <= 2"), true);
    assert.equal(evaluate('"apple" < "banana"'), true);
    assert.equal(evaluate('"b" >= "a"'), true);
  });

  it("uses structural equality", () => {
    assert.equal(evaluate("[1, [2, 3]] == [1, [2, 3]]"), true);
    assert.equal(evaluate("[1, 2] == [2, 1]"), false);
    assert.equal(evaluate('{"a": 1} == {"a": 1}'), true);
    assert.equal(evaluate('{"a": 1} != {"a": 2}'), true);
    assert.equal(evaluate('1 == "1"'), false);
  });

  it("treats only nil and false as falsy", () => {
    assert.equal(evaluate("!0"), false);
    assert.equal(evaluate('!""'), false);
    assert.equal(evaluate("!nil"), true);
    assert.equal(evaluate("!false"), true);
    assert.equal(evaluate("![]"), false);
  });

  it("short-circuits logical operators and returns the deciding operand", () => {
    assert.equal(evaluate("nil || 42"), 42);
    assert.equal(evaluate("1 && 2"), 2);
    // `1 / 0` fails at runtime, so reaching it at all would throw. The operand
    // is deliberately well-formed: an undefined name would be rejected
    // statically by the resolver, before short-circuiting could matter.
    assert.equal(evaluate('"set" || (1 / 0)'), "set");
    assert.equal(evaluate("false && (1 / 0)"), false);
  });

  it("concatenates with + as soon as one side is a string", () => {
    assert.equal(evaluate('"a" + "b"'), "ab");
    assert.equal(evaluate('"count: " + 3'), "count: 3");
    assert.equal(evaluate('1 + " item"'), "1 item");
    assert.equal(evaluate('"ab" * 3'), "ababab");
  });

  it("concatenates arrays with +", () => {
    assert.deepEqual(evaluate("[1, 2] + [3]"), [1, 2, 3]);
  });

  it("evaluates if as an expression, defaulting to nil", () => {
    assert.equal(evaluate("if (true) { 10 }"), 10);
    assert.equal(evaluate("if (false) { 10 }"), null);
    assert.equal(evaluate("if (false) { 1 } else if (true) { 2 } else { 3 }"), 2);
    assert.equal(evaluate("let x = if (1 < 2) { \"yes\" } else { \"no\" }; x"), "yes");
  });
});

describe("interpreter — bindings and scope", () => {
  it("binds and reads variables", () => {
    assert.equal(evaluate("let a = 5; let b = a * 2; a + b"), 15);
  });

  it("reassigns without let and returns the assigned value", () => {
    assert.equal(evaluate("let a = 1; a = a + 1; a"), 2);
    assert.equal(evaluate("let a = 1; a = 9"), 9);
  });

  it("shadows outer bindings inside a block without leaking", () => {
    assert.equal(evaluate("let a = 1; { let a = 2; } a"), 1);
  });

  it("assigns through to an outer scope", () => {
    assert.equal(evaluate("let a = 1; { a = 2; } a"), 2);
  });

  it("refuses to create a variable by assignment", () => {
    assert.throws(() => evaluate("undeclared = 1;"), /undeclared variable/);
  });
});

describe("interpreter — functions", () => {
  it("returns the last expression implicitly", () => {
    assert.equal(evaluate("let double = fn(x) { x * 2 }; double(21)"), 42);
  });

  it("supports explicit early returns", () => {
    assert.equal(evaluate("fn f(x) { if (x > 0) { return \"pos\"; } \"non-pos\" } f(1)"), "pos");
    assert.equal(evaluate("fn f(x) { if (x > 0) { return \"pos\"; } \"non-pos\" } f(-1)"), "non-pos");
  });

  it("returns nil from a bare return", () => {
    assert.equal(evaluate("fn f() { return; 99 } f()"), null);
  });

  it("supports recursion", () => {
    assert.equal(evaluate("fn fact(n) { if (n <= 1) { 1 } else { n * fact(n - 1) } } fact(10)"), 3628800);
  });

  it("supports mutual recursion between declarations", () => {
    const source = `
      fn even(n) { if (n == 0) { true } else { odd(n - 1) } }
      fn odd(n) { if (n == 0) { false } else { even(n - 1) } }
      even(10)
    `;
    assert.equal(evaluate(source), true);
  });

  it("closes over its defining environment", () => {
    const source = `
      fn counter() { let n = 0; fn() { n = n + 1; n } }
      let next = counter();
      next(); next(); next()
    `;
    assert.equal(evaluate(source), 3);
  });

  it("gives each closure its own captured state", () => {
    const source = `
      fn counter() { let n = 0; fn() { n = n + 1; n } }
      let a = counter(); let b = counter();
      a(); a(); [a(), b()]
    `;
    assert.deepEqual(evaluate(source), [3, 1]);
  });

  it("supports higher-order functions and partial application", () => {
    const source = `
      fn adder(x) { fn(y) { x + y } }
      let add5 = adder(5);
      add5(10)
    `;
    assert.equal(evaluate(source), 15);
  });

  it("passes functions as values", () => {
    assert.deepEqual(evaluate("fn sq(n) { n * n } map([1, 2, 3], sq)"), [1, 4, 9]);
  });

  it("enforces arity on direct calls", () => {
    assert.throws(() => evaluate("fn f(a, b) { a } f(1)"), /expects 2 arguments, got 1/);
  });

  it("rejects calling a non-function", () => {
    assert.throws(() => evaluate("let x = 1; x()"), /'x' is not a function/);
  });

  it("names anonymous functions after the variable they are bound to", () => {
    assert.equal(show("let greet = fn(name) { name }; greet"), "<fn greet(name)>");
  });
});

describe("interpreter — collections", () => {
  it("indexes arrays, including from the end", () => {
    assert.equal(evaluate("[1, 2, 3][0]"), 1);
    assert.equal(evaluate("[1, 2, 3][-1]"), 3);
    assert.equal(evaluate("[1, 2, 3][9]"), null);
  });

  it("indexes strings by character", () => {
    assert.equal(evaluate('"luma"[0]'), "l");
    assert.equal(evaluate('"luma"[-1]'), "a");
  });

  it("mutates arrays through index assignment", () => {
    assert.deepEqual(evaluate("let a = [1, 2, 3]; a[1] = 9; a"), [1, 9, 3]);
  });

  it("rejects out-of-bounds writes", () => {
    assert.throws(() => evaluate("let a = [1]; a[5] = 0;"), /out of bounds/);
  });

  it("reads and writes hashes, including via dot access", () => {
    assert.equal(evaluate('let h = {"a": 1}; h["a"]'), 1);
    assert.equal(evaluate('let h = {"a": 1}; h.a'), 1);
    assert.equal(evaluate('let h = {"a": 1}; h.missing'), null);
    assert.equal(evaluate('let h = {"a": 1}; h.a = 5; h.a'), 5);
    assert.equal(evaluate('let h = {}; h.fresh = 7; h.fresh'), 7);
  });

  it("allows numbers and booleans as hash keys", () => {
    const value = evaluate('{1: "one", true: "yes"}');
    assert.ok(value instanceof LumaHash);
    assert.equal((value as LumaHash).entries.get(1), "one");
    assert.equal((value as LumaHash).entries.get(true), "yes");
  });

  it("rejects unhashable keys", () => {
    assert.throws(() => evaluate('let h = {}; h[[1]] = 1;'), /cannot be used as a hash key/);
  });
});

describe("interpreter — control flow", () => {
  it("runs while loops", () => {
    assert.equal(evaluate("let i = 0; let n = 0; while (i < 5) { n = n + i; i = i + 1; } n"), 10);
  });

  it("honours break and continue", () => {
    const source = `
      let total = 0;
      for (n in range(10)) {
        if (n % 2 == 0) { continue; }
        if (n > 7) { break; }
        total = total + n;
      }
      total
    `;
    assert.equal(evaluate(source), 1 + 3 + 5 + 7);
  });

  it("iterates arrays, strings and hashes", () => {
    assert.deepEqual(outputOf("for (n in [1, 2]) { print(n) }"), ["1", "2"]);
    assert.deepEqual(outputOf('for (c in "hi") { print(c) }'), ["h", "i"]);
    assert.deepEqual(outputOf('for (pair in {"a": 1}) { print(pair[0], pair[1]) }'), ["a 1"]);
  });

  it("refuses to iterate a non-iterable", () => {
    assert.throws(() => evaluate("for (x in 42) { }"), /cannot iterate over number/);
  });

  it("stops runaway loops instead of hanging", () => {
    const interpreter = new Interpreter({ maxIterations: 1000, stdout: () => {} });
    assert.throws(() => interpreter.run("while (true) { }"), /maximum number of iterations/);
  });
});

describe("interpreter — printing", () => {
  it("prints values space-separated without quoting strings", () => {
    assert.deepEqual(outputOf('print("a", 1, true, nil)'), ["a 1 true nil"]);
  });

  it("renders collections readably", () => {
    assert.deepEqual(outputOf('print([1, "two", [3]])'), ['[1, "two", [3]]']);
    assert.deepEqual(outputOf('print({"a": [1]})'), ['{"a": [1]}']);
  });

  it("prints integral floats without a decimal point", () => {
    assert.deepEqual(outputOf("print(10 / 2)"), ["5"]);
  });

  it("survives cyclic structures", () => {
    assert.deepEqual(outputOf("let a = [1]; a[0] = a; print(a)"), ["[<cycle>]"]);
  });
});
