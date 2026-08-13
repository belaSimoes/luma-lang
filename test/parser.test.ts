import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parse } from "../src/parser.ts";
import type { Expression, ExpressionStatement, Program, Statement } from "../src/ast.ts";

function firstStatement(source: string): Statement {
  const program: Program = parse(source);
  assert.ok(program.body.length > 0, "expected at least one statement");
  return program.body[0]!;
}

function firstExpression(source: string): Expression {
  const statement = firstStatement(source);
  assert.equal(statement.kind, "ExpressionStatement");
  return (statement as ExpressionStatement).expression;
}

/** Fully parenthesised rendering — the classic way to assert precedence. */
function render(node: Expression): string {
  switch (node.kind) {
    case "NumberLiteral":
      return String(node.value);
    case "StringLiteral":
      return JSON.stringify(node.value);
    case "BooleanLiteral":
      return String(node.value);
    case "NilLiteral":
      return "nil";
    case "Identifier":
      return node.name;
    case "PrefixExpression":
      return `(${node.operator}${render(node.right)})`;
    case "InfixExpression":
    case "LogicalExpression":
      return `(${render(node.left)} ${node.operator} ${render(node.right)})`;
    case "AssignExpression":
      return `(${render(node.target)} = ${render(node.value)})`;
    case "CallExpression":
      return `${render(node.callee)}(${node.args.map(render).join(", ")})`;
    case "IndexExpression":
      return `(${render(node.target)}[${render(node.index)}])`;
    case "ArrayLiteral":
      return `[${node.elements.map(render).join(", ")}]`;
    case "HashLiteral":
      return `{${node.pairs.map((p) => `${render(p.key)}: ${render(p.value)}`).join(", ")}}`;
    case "FunctionLiteral":
      return `fn(${node.parameters.join(", ")})`;
    case "IfExpression":
      return `if(${render(node.condition)})`;
  }
}

describe("parser — precedence", () => {
  const cases: Array<[string, string]> = [
    ["1 + 2 * 3", "(1 + (2 * 3))"],
    ["(1 + 2) * 3", "((1 + 2) * 3)"],
    ["1 - 2 - 3", "((1 - 2) - 3)"],
    ["-a * b", "((-a) * b)"],
    ["!-a", "(!(-a))"],
    ["a + b == c * d", "((a + b) == (c * d))"],
    ["a < b != c > d", "((a < b) != (c > d))"],
    ["a && b || c", "((a && b) || c)"],
    ["a || b && c", "(a || (b && c))"],
    ["!a && b", "((!a) && b)"],
    ["a = b = c", "(a = (b = c))"],
    ["x = 1 + 2", "(x = (1 + 2))"],
    ["f(1)(2)", "f(1)(2)"],
    ["-f(x)", "(-f(x))"],
    ["a[0][1]", "((a[0])[1])"],
    ["a.b.c", "((a[\"b\"])[\"c\"])"],
    ["a.b(1)", "(a[\"b\"])(1)"],
    ["a[0] = 5", "((a[0]) = 5)"],
    ["1 + 2 % 3", "(1 + (2 % 3))"],
  ];

  for (const [source, expected] of cases) {
    it(`${source}  =>  ${expected}`, () => {
      assert.equal(render(firstExpression(source)), expected);
    });
  }
});

describe("parser — statements", () => {
  it("parses let bindings", () => {
    const statement = firstStatement("let answer = 42;");
    assert.equal(statement.kind, "LetStatement");
    assert.equal(statement.kind === "LetStatement" && statement.name, "answer");
  });

  it("parses bare and valued returns", () => {
    assert.equal(firstStatement("fn f() { return; }").kind, "FunctionDeclaration");
    const program = parse("return 1;");
    const statement = program.body[0]!;
    assert.equal(statement.kind, "ReturnStatement");
  });

  it("treats `fn name()` as a declaration and `fn()` as an expression", () => {
    assert.equal(firstStatement("fn add(a, b) { a + b }").kind, "FunctionDeclaration");
    assert.equal(firstExpression("fn(a, b) { a + b }").kind, "FunctionLiteral");
  });

  it("parses while and for loops with their control statements", () => {
    const loop = firstStatement("while (true) { break; }");
    assert.equal(loop.kind, "WhileStatement");
    const forLoop = firstStatement("for (item in list) { continue; }");
    assert.equal(forLoop.kind, "ForStatement");
    assert.equal(forLoop.kind === "ForStatement" && forLoop.name, "item");
  });

  it("parses if/else-if/else chains", () => {
    const expression = firstExpression("if (a) { 1 } else if (b) { 2 } else { 3 }");
    assert.equal(expression.kind, "IfExpression");
    assert.equal(
      expression.kind === "IfExpression" && expression.alternative?.kind,
      "IfExpression",
    );
  });

  it("treats a leading brace as a block, but a brace in expression position as a hash", () => {
    assert.equal(firstStatement("{ let a = 1; }").kind, "BlockStatement");
    const binding = firstStatement("let h = {};");
    assert.equal(binding.kind, "LetStatement");
    assert.equal(binding.kind === "LetStatement" && binding.value.kind, "HashLiteral");
  });

  it("makes semicolons optional between statements", () => {
    assert.equal(parse("let a = 1\nlet b = 2\na + b").body.length, 3);
  });

  it("ignores an empty program", () => {
    assert.deepEqual(parse("// just a comment\n").body, []);
  });
});

describe("parser — diagnostics", () => {
  const invalid: Array<[string, RegExp]> = [
    ["let = 1;", /expected a variable name/],
    ["let x 1;", /expected '='/],
    ["1 +", /unexpected end of input|start of an expression/],
    ["if true { 1 }", /expected '\('/],
    ["fn f(a, a) { a }", /duplicate parameter/],
    ["{ let a = 1;", /unclosed block/],
    ["[1, 2", /expected ',' or '\]'/],
    ["[1, 2,", /unexpected end of input/],
    ["1 = 2", /invalid assignment target/],
    ["{ 1 }.x", /expected/],
    ["let h = {1 2};", /expected ':'/],
  ];

  for (const [source, pattern] of invalid) {
    it(`rejects ${JSON.stringify(source)}`, () => {
      assert.throws(() => parse(source), pattern);
    });
  }

  it("points at the offending token", () => {
    try {
      parse("let a = 1;\nlet = 2;");
      assert.fail("expected a syntax error");
    } catch (error) {
      assert.deepEqual((error as { position: unknown }).position, { line: 2, column: 5 });
    }
  });
});
