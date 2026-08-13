/**
 * Tree-walking evaluator.
 *
 * Design notes:
 *  - `return`, `break` and `continue` are non-local jumps, modelled as thrown
 *    signal objects. They are caught by the construct that owns them, so a
 *    `break` outside a loop is a proper syntax-level error rather than silence.
 *  - A block's value is the value of its last expression statement, which makes
 *    `fn(x) { x * 2 }` and `let y = if (c) { 1 } else { 2 }` work.
 *  - Recursion depth is capped so runaway programs produce a Luma error with a
 *    call stack instead of a JavaScript RangeError.
 */

import type {
  BlockStatement,
  Expression,
  IfExpression,
  IndexExpression,
  Program,
  Statement,
} from "./ast.ts";
import { RuntimeError } from "./errors.ts";
import { Environment } from "./environment.ts";
import { parse } from "./parser.ts";
import { createBuiltins } from "./builtins.ts";
import type { Position } from "./token.ts";
import {
  LumaBuiltin,
  LumaFunction,
  LumaHash,
  type BuiltinContext,
  type HashKey,
  type LumaValue,
  formatNumber,
  isTruthy,
  stringify,
  typeOf,
  valuesEqual,
} from "./values.ts";

class ReturnSignal {
  readonly value: LumaValue;
  constructor(value: LumaValue) {
    this.value = value;
  }
}
class BreakSignal {}
class ContinueSignal {}

export interface InterpreterOptions {
  /** Where `print` writes. Defaults to `process.stdout`. */
  stdout?: (line: string) => void;
  /** Maximum nested Luma calls before bailing out. */
  maxCallDepth?: number;
  /** Upper bound on loop iterations, guarding against accidental infinite loops. */
  maxIterations?: number;
}

const DEFAULT_MAX_CALL_DEPTH = 2_000;
const DEFAULT_MAX_ITERATIONS = 50_000_000;

export class Interpreter {
  readonly globals: Environment;
  private readonly stdout: (line: string) => void;
  private readonly maxCallDepth: number;
  private readonly maxIterations: number;
  private readonly frames: string[] = [];
  /** Position of the node being evaluated, used to position builtin errors. */
  private here: Position = { line: 1, column: 1 };

  constructor(options: InterpreterOptions = {}) {
    this.stdout = options.stdout ?? ((line) => console.log(line));
    this.maxCallDepth = options.maxCallDepth ?? DEFAULT_MAX_CALL_DEPTH;
    this.maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;

    this.globals = new Environment();
    for (const [name, builtin] of createBuiltins()) {
      this.globals.define(name, builtin);
    }
  }

  /** Parse and evaluate a program, returning the value of its last statement. */
  run(source: string): LumaValue {
    return this.evalProgram(parse(source));
  }

  evalProgram(program: Program, env: Environment = this.globals): LumaValue {
    let result: LumaValue = null;
    for (const statement of program.body) {
      result = this.evalStatement(statement, env);
    }
    return result;
  }

  // -------------------------------------------------------------- statements

  private evalStatement(node: Statement, env: Environment): LumaValue {
    switch (node.kind) {
      case "LetStatement": {
        const value = this.evalExpression(node.value, env);
        env.define(node.name, this.named(value, node.name));
        return null;
      }

      case "FunctionDeclaration": {
        const fn = new LumaFunction(node.name, node.parameters, node.body, env);
        env.define(node.name, fn);
        return null;
      }

      case "ReturnStatement": {
        const value = node.value === null ? null : this.evalExpression(node.value, env);
        throw new ReturnSignal(value);
      }

      case "ExpressionStatement":
        return this.evalExpression(node.expression, env);

      case "BlockStatement":
        return this.evalBlock(node, env.child());

      case "WhileStatement": {
        let iterations = 0;
        while (isTruthy(this.evalExpression(node.condition, env))) {
          if (++iterations > this.maxIterations) {
            this.fail("loop exceeded the maximum number of iterations", node.position);
          }
          const signal = this.runLoopBody(node.body, env.child());
          if (signal === "break") break;
        }
        return null;
      }

      case "ForStatement": {
        const iterable = this.evalExpression(node.iterable, env);
        for (const item of this.iterate(iterable, node.position)) {
          const scope = env.child();
          scope.define(node.name, item);
          if (this.runLoopBody(node.body, scope) === "break") break;
        }
        return null;
      }

      case "BreakStatement":
        throw new BreakSignal();

      case "ContinueStatement":
        throw new ContinueSignal();
    }
  }

  /** Runs a loop body and translates `break`/`continue` into a plain verdict. */
  private runLoopBody(body: BlockStatement, env: Environment): "break" | "continue" {
    try {
      this.evalBlock(body, env);
    } catch (error) {
      if (error instanceof BreakSignal) return "break";
      if (!(error instanceof ContinueSignal)) throw error;
    }
    return "continue";
  }

  private evalBlock(block: BlockStatement, env: Environment): LumaValue {
    let result: LumaValue = null;
    for (const statement of block.body) {
      result = this.evalStatement(statement, env);
    }
    return result;
  }

  private *iterate(value: LumaValue, position: Position): Iterable<LumaValue> {
    if (Array.isArray(value)) {
      yield* value;
      return;
    }
    if (typeof value === "string") {
      yield* [...value];
      return;
    }
    if (value instanceof LumaHash) {
      for (const [key, entry] of value.entries) yield [key, entry];
      return;
    }
    this.fail(`cannot iterate over ${typeOf(value)}`, position);
  }

  // ------------------------------------------------------------- expressions

  private evalExpression(node: Expression, env: Environment): LumaValue {
    this.here = node.position;

    switch (node.kind) {
      case "NumberLiteral":
        return node.value;
      case "StringLiteral":
        return node.value;
      case "BooleanLiteral":
        return node.value;
      case "NilLiteral":
        return null;

      case "Identifier": {
        if (!env.has(node.name)) {
          this.fail(`undefined variable '${node.name}'`, node.position, node.name.length);
        }
        return env.get(node.name) ?? null;
      }

      case "ArrayLiteral":
        return node.elements.map((element) => this.evalExpression(element, env));

      case "HashLiteral": {
        const hash = new LumaHash();
        for (const pair of node.pairs) {
          const key = this.evalExpression(pair.key, env);
          hash.entries.set(
            this.asHashKey(key, pair.key.position),
            this.evalExpression(pair.value, env),
          );
        }
        return hash;
      }

      case "FunctionLiteral":
        return new LumaFunction(node.name ?? "", node.parameters, node.body, env);

      case "PrefixExpression":
        return this.evalPrefix(node.operator, this.evalExpression(node.right, env), node.position);

      case "InfixExpression": {
        const left = this.evalExpression(node.left, env);
        const right = this.evalExpression(node.right, env);
        return this.evalInfix(node.operator, left, right, node.position);
      }

      case "LogicalExpression": {
        const left = this.evalExpression(node.left, env);
        if (node.operator === "&&") {
          return isTruthy(left) ? this.evalExpression(node.right, env) : left;
        }
        return isTruthy(left) ? left : this.evalExpression(node.right, env);
      }

      case "IfExpression":
        return this.evalIf(node, env);

      case "IndexExpression": {
        const target = this.evalExpression(node.target, env);
        const index = this.evalExpression(node.index, env);
        return this.evalIndex(target, index, node.position);
      }

      case "AssignExpression":
        return this.evalAssign(node.target, this.evalExpression(node.value, env), env);

      case "CallExpression": {
        const callee = this.evalExpression(node.callee, env);
        const args = node.args.map((arg) => this.evalExpression(arg, env));
        return this.call(callee, args, node.position, describeCallee(node.callee));
      }
    }
  }

  private evalIf(node: IfExpression, env: Environment): LumaValue {
    if (isTruthy(this.evalExpression(node.condition, env))) {
      return this.evalBlock(node.consequence, env.child());
    }
    if (node.alternative === null) return null;
    if (node.alternative.kind === "IfExpression") {
      return this.evalExpression(node.alternative, env);
    }
    return this.evalBlock(node.alternative, env.child());
  }

  private evalPrefix(operator: "-" | "!", right: LumaValue, position: Position): LumaValue {
    if (operator === "!") return !isTruthy(right);
    if (typeof right !== "number") {
      this.fail(`unary '-' is not defined for ${typeOf(right)}`, position);
    }
    return -right;
  }

  private evalInfix(
    operator: string,
    left: LumaValue,
    right: LumaValue,
    position: Position,
  ): LumaValue {
    if (operator === "==") return valuesEqual(left, right);
    if (operator === "!=") return !valuesEqual(left, right);

    if (typeof left === "number" && typeof right === "number") {
      switch (operator) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/":
          if (right === 0) this.fail("division by zero", position);
          return left / right;
        case "%":
          if (right === 0) this.fail("modulo by zero", position);
          return left % right;
        case "<":
          return left < right;
        case ">":
          return left > right;
        case "<=":
          return left <= right;
        case ">=":
          return left >= right;
      }
    }

    if (typeof left === "string" || typeof right === "string") {
      switch (operator) {
        case "+":
          // `+` concatenates as soon as either side is a string.
          return stringify(left) + stringify(right);
        case "*":
          if (typeof left === "string" && typeof right === "number") {
            return this.repeat(left, right, position);
          }
          if (typeof right === "string" && typeof left === "number") {
            return this.repeat(right, left, position);
          }
          break;
        case "<":
        case ">":
        case "<=":
        case ">=":
          if (typeof left === "string" && typeof right === "string") {
            const order = left < right ? -1 : left > right ? 1 : 0;
            return operator === "<"
              ? order < 0
              : operator === ">"
                ? order > 0
                : operator === "<="
                  ? order <= 0
                  : order >= 0;
          }
          break;
      }
    }

    if (Array.isArray(left) && Array.isArray(right) && operator === "+") {
      return [...left, ...right];
    }

    this.fail(
      `operator '${operator}' is not defined for ${typeOf(left)} and ${typeOf(right)}`,
      position,
    );
  }

  private repeat(text: string, times: number, position: Position): string {
    if (!Number.isInteger(times) || times < 0) {
      this.fail("string repetition requires a non-negative whole number", position);
    }
    if (text.length * times > 10_000_000) {
      this.fail("string repetition result is too large", position);
    }
    return text.repeat(times);
  }

  private evalIndex(target: LumaValue, index: LumaValue, position: Position): LumaValue {
    if (Array.isArray(target)) {
      if (typeof index !== "number" || !Number.isInteger(index)) {
        this.fail(`array indices must be whole numbers, got ${typeOf(index)}`, position);
      }
      const resolved = index < 0 ? target.length + index : index;
      return target[resolved] ?? null;
    }

    if (typeof target === "string") {
      if (typeof index !== "number" || !Number.isInteger(index)) {
        this.fail(`string indices must be whole numbers, got ${typeOf(index)}`, position);
      }
      const characters = [...target];
      const resolved = index < 0 ? characters.length + index : index;
      return characters[resolved] ?? null;
    }

    if (target instanceof LumaHash) {
      return target.entries.get(this.asHashKey(index, position)) ?? null;
    }

    this.fail(`cannot index into ${typeOf(target)}`, position);
  }

  private evalAssign(
    target: IndexExpression | { kind: "Identifier"; name: string; position: Position },
    value: LumaValue,
    env: Environment,
  ): LumaValue {
    if (target.kind === "Identifier") {
      if (!env.assign(target.name, this.named(value, target.name))) {
        this.fail(
          `cannot assign to undeclared variable '${target.name}' — use 'let ${target.name} = ...'`,
          target.position,
          target.name.length,
        );
      }
      return value;
    }

    const container = this.evalExpression(target.target, env);
    const index = this.evalExpression(target.index, env);

    if (Array.isArray(container)) {
      if (typeof index !== "number" || !Number.isInteger(index)) {
        this.fail(`array indices must be whole numbers, got ${typeOf(index)}`, target.position);
      }
      const resolved = index < 0 ? container.length + index : index;
      if (resolved < 0 || resolved >= container.length) {
        this.fail(
          `index ${formatNumber(index)} is out of bounds for an array of length ${container.length}`,
          target.position,
        );
      }
      container[resolved] = value;
      return value;
    }

    if (container instanceof LumaHash) {
      container.entries.set(this.asHashKey(index, target.position), value);
      return value;
    }

    this.fail(`cannot assign into ${typeOf(container)}`, target.position);
  }

  // -------------------------------------------------------------------- calls

  /** Invoke a Luma function or a builtin. Public so builtins can call back in. */
  call(
    callee: LumaValue,
    args: LumaValue[],
    position: Position = this.here,
    label = "",
  ): LumaValue {
    if (callee instanceof LumaBuiltin) {
      this.checkArity(callee.name, callee.arity, args.length, position);
      this.here = position;
      return callee.fn(args, this.builtinContext(position));
    }

    if (!(callee instanceof LumaFunction)) {
      const what = label ? `'${label}'` : `a value of type ${typeOf(callee)}`;
      this.fail(`${what} is not a function`, position);
    }

    if (args.length !== callee.parameters.length) {
      this.fail(
        `${callee.name || "anonymous function"} expects ${callee.parameters.length} ` +
          `argument${callee.parameters.length === 1 ? "" : "s"}, got ${args.length}`,
        position,
      );
    }

    if (this.frames.length >= this.maxCallDepth) {
      this.fail(
        `maximum call depth of ${this.maxCallDepth} exceeded (infinite recursion?)`,
        position,
      );
    }

    const scope = callee.env.child();
    callee.parameters.forEach((name, index) => scope.define(name, args[index] ?? null));

    this.frames.push(`${callee.name || "anonymous function"}(...)`);
    try {
      return this.evalBlock(callee.body, scope);
    } catch (error) {
      if (error instanceof ReturnSignal) return error.value;
      throw error;
    } finally {
      this.frames.pop();
    }
  }

  private builtinContext(position: Position): BuiltinContext {
    return {
      print: (text) => this.stdout(text),
      // Builtins offer callbacks more arguments than most callers want
      // (`map` also passes the index), so extra ones are dropped rather than
      // rejected. Direct user-level calls stay strict.
      call: (callee, args) => {
        const trimmed =
          callee instanceof LumaFunction && args.length > callee.parameters.length
            ? args.slice(0, callee.parameters.length)
            : args;
        return this.call(callee, trimmed, position);
      },
      fail: (message) => this.fail(message, position),
    };
  }

  private checkArity(
    name: string,
    [min, max]: [number, number],
    got: number,
    position: Position,
  ): void {
    if (got >= min && got <= max) return;
    const expected =
      min === max
        ? `${min}`
        : max >= Number.MAX_SAFE_INTEGER
          ? `at least ${min}`
          : `between ${min} and ${max}`;
    this.fail(
      `${name} expects ${expected} argument${min === 1 && min === max ? "" : "s"}, got ${got}`,
      position,
    );
  }

  // ------------------------------------------------------------------ helpers

  private asHashKey(value: LumaValue, position: Position): HashKey {
    const type = typeOf(value);
    if (type === "string" || type === "number" || type === "boolean") {
      return value as HashKey;
    }
    this.fail(`${type} cannot be used as a hash key`, position);
  }

  /** Give anonymous functions the name they are bound to — nicer stack traces. */
  private named(value: LumaValue, name: string): LumaValue {
    if (value instanceof LumaFunction && value.name === "") {
      return new LumaFunction(name, value.parameters, value.body, value.env);
    }
    return value;
  }

  private fail(message: string, position: Position, span = 1): never {
    throw new RuntimeError(message, position, [...this.frames].reverse(), span);
  }
}

function describeCallee(callee: Expression): string {
  if (callee.kind === "Identifier") return callee.name;
  if (callee.kind === "IndexExpression" && callee.index.kind === "StringLiteral") {
    return callee.index.value;
  }
  return "";
}
