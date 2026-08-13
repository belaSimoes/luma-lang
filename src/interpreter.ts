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
  AssignExpression,
  BlockStatement,
  Expression,
  IfExpression,
  MatchExpression,
  Pattern,
  Program,
  Statement,
} from "./ast.ts";
import { LumaError, LumaErrorGroup, RuntimeError } from "./errors.ts";
import { Environment, UNBOUND } from "./environment.ts";
import { parse } from "./parser.ts";
import { resolve } from "./resolver.ts";
import { createBuiltins } from "./builtins.ts";
import type { TraceRecorder } from "./tracer.ts";
import type { DiagnosticCode } from "./codes.ts";
import type { Position } from "./token.ts";
import {
  LumaBuiltin,
  LumaFunction,
  LumaHash,
  type BuiltinContext,
  type HashKey,
  type LumaValue,
  formatNumber,
  inspect,
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
  /**
   * Attach a recorder to capture an execution timeline for the debugger.
   * When absent, the hooks compile down to a null check per statement.
   */
  recorder?: TraceRecorder;
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
  /** Non-fatal diagnostics from the last {@link run}, e.g. unreachable code. */
  warnings: LumaError[] = [];
  /** Execution recorder, or null when not debugging. */
  private readonly recorder: TraceRecorder | null;

  constructor(options: InterpreterOptions = {}) {
    this.stdout = options.stdout ?? ((line) => console.log(line));
    this.maxCallDepth = options.maxCallDepth ?? DEFAULT_MAX_CALL_DEPTH;
    this.maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    this.recorder = options.recorder ?? null;

    this.globals = new Environment();
    for (const [name, builtin] of createBuiltins()) {
      this.globals.define(name, builtin);
    }
  }

  /**
   * Parse, analyse and evaluate a program, returning the value of its last
   * statement.
   *
   * The resolver runs in between, so undefined variables and stray
   * `break`/`return` are reported before any side effect happens. Warnings it
   * produces are collected in {@link warnings} for the caller to display.
   */
  run(source: string): LumaValue {
    const program = parse(source);
    const { errors, warnings } = resolve(program, { globals: this.globals.names() });

    this.warnings = warnings;
    if (errors.length > 0) throw new LumaErrorGroup(errors);

    return this.evalProgram(program);
  }

  evalProgram(program: Program, env: Environment = this.globals): LumaValue {
    let result: LumaValue = null;
    try {
      for (const statement of program.body) {
        result = this.evalStatement(statement, env);
      }
    } catch (error) {
      // A `return`/`break`/`continue` that escaped every construct that could
      // have caught it. The resolver rejects these statically, but a caller may
      // evaluate a hand-built AST, and an internal object must never surface as
      // an uncaught host exception.
      throw this.describeStraySignal(error);
    }
    return result;
  }

  private describeStraySignal(error: unknown): unknown {
    if (error instanceof ReturnSignal) {
      return new RuntimeError("'return' outside of a function", this.here, {
        code: "E0402",
        frames: [...this.frames].reverse(),
      });
    }
    if (error instanceof BreakSignal) {
      return new RuntimeError("'break' outside of a loop", this.here, {
        code: "E0401",
        frames: [...this.frames].reverse(),
      });
    }
    if (error instanceof ContinueSignal) {
      return new RuntimeError("'continue' outside of a loop", this.here, {
        code: "E0401",
        frames: [...this.frames].reverse(),
      });
    }
    return error;
  }

  // -------------------------------------------------------------- statements

  private evalStatement(node: Statement, env: Environment): LumaValue {
    this.here = node.position;
    if (this.recorder !== null) {
      this.recorder.statement(node.position, this.frames, env);
    }

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
            this.fail("loop exceeded the maximum number of iterations", node.position, 1, "E0601");
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
        const value = env.lookup(node.name);
        if (value === UNBOUND) {
          this.fail(`undefined variable '${node.name}'`, node.position, node.name.length, "E0301");
        }
        return value;
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

      case "TemplateLiteral": {
        let out = "";
        for (const part of node.parts) {
          out +=
            part.kind === "text" ? part.value : stringify(this.evalExpression(part.value, env));
        }
        return out;
      }

      case "MatchExpression":
        return this.evalMatch(node, env);

      case "IndexExpression": {
        const target = this.evalExpression(node.target, env);
        const index = this.evalExpression(node.index, env);
        return this.evalIndex(target, index, node.position);
      }

      case "AssignExpression":
        return this.evalAssign(node, env);

      case "CallExpression": {
        const callee = this.evalExpression(node.callee, env);
        const args = node.args.map((arg) => this.evalExpression(arg, env));
        return this.call(callee, args, node.position, describeCallee(node.callee));
      }
    }
  }

  /**
   * Try each arm in source order: match the pattern, then check the guard.
   * The first arm that passes both wins, with its bindings in scope.
   */
  private evalMatch(node: MatchExpression, env: Environment): LumaValue {
    const subject = this.evalExpression(node.subject, env);

    for (const arm of node.arms) {
      const bindings = new Map<string, LumaValue>();
      if (!this.matches(arm.pattern, subject, bindings)) continue;

      const scope = env.child();
      for (const [name, value] of bindings) scope.define(name, value);

      if (arm.guard !== null && !isTruthy(this.evalExpression(arm.guard, scope))) {
        continue;
      }

      return arm.body.kind === "BlockStatement"
        ? this.evalBlock(arm.body, scope)
        : this.evalExpression(arm.body, scope);
    }

    this.fail(`no match arm matched ${inspect(subject)}`, node.position, 1, "E0602");
  }

  /**
   * Test a pattern against a value, collecting bindings as it goes.
   *
   * Bindings are written into `bindings` even on a partial match; a failed arm
   * simply discards the map, which keeps the matcher a plain recursive
   * predicate with no undo bookkeeping.
   */
  private matches(
    pattern: Pattern,
    value: LumaValue,
    bindings: Map<string, LumaValue>,
  ): boolean {
    switch (pattern.kind) {
      case "WildcardPattern":
        return true;

      case "BindingPattern":
        bindings.set(pattern.name, value);
        return true;

      case "LiteralPattern":
        // Literal patterns contain only literals, so this cannot run user code.
        return valuesEqual(this.evalExpression(pattern.value, this.globals), value);

      case "OrPattern":
        return pattern.options.some((option) => this.matches(option, value, bindings));

      case "ArrayPattern": {
        if (!Array.isArray(value)) return false;

        const fixed = pattern.elements.length;
        if (pattern.rest === null ? value.length !== fixed : value.length < fixed) {
          return false;
        }
        for (const [index, element] of pattern.elements.entries()) {
          if (!this.matches(element, value[index]!, bindings)) return false;
        }
        if (pattern.rest !== null) bindings.set(pattern.rest, value.slice(fixed));
        return true;
      }

      case "HashPattern": {
        if (!(value instanceof LumaHash)) return false;

        for (const entry of pattern.entries) {
          const key = this.asHashKey(
            this.evalExpression(entry.key, this.globals),
            entry.key.position,
          );
          // A hash pattern is a subset test: extra keys in the value are fine,
          // but a listed key must be present, not merely nil.
          if (!value.entries.has(key)) return false;
          if (!this.matches(entry.value, value.entries.get(key)!, bindings)) return false;
        }
        return true;
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
        this.fail(`array indices must be whole numbers, got ${typeOf(index)}`, position, 1, "E0504");
      }
      const resolved = index < 0 ? target.length + index : index;
      return target[resolved] ?? null;
    }

    if (typeof target === "string") {
      if (typeof index !== "number" || !Number.isInteger(index)) {
        this.fail(`string indices must be whole numbers, got ${typeOf(index)}`, position, 1, "E0504");
      }
      const characters = [...target];
      const resolved = index < 0 ? characters.length + index : index;
      return characters[resolved] ?? null;
    }

    if (target instanceof LumaHash) {
      return target.entries.get(this.asHashKey(index, position)) ?? null;
    }

    this.fail(`cannot index into ${typeOf(target)}`, position, 1, "E0504");
  }

  /**
   * Evaluate an assignment, plain or compound.
   *
   * For `a[i] += 1` the container and index are evaluated **once** and reused
   * for both the read and the write, so side effects in the target — say
   * `items[next()] += 1` — happen exactly once.
   */
  private evalAssign(node: AssignExpression, env: Environment): LumaValue {
    const { target, operator } = node;

    if (target.kind === "Identifier") {
      // A plain `=` never reads the old value, so it must not pay for the extra
      // scope-chain walk that a compound operator needs.
      if (operator === null) {
        const value = this.evalExpression(node.value, env);
        if (!env.assign(target.name, this.named(value, target.name))) {
          this.failUndeclared(target.name, target.position);
        }
        return value;
      }

      const current = env.lookup(target.name);
      if (current === UNBOUND) this.failUndeclared(target.name, target.position);

      const value = this.combine(operator, current, node, env);
      env.assign(target.name, this.named(value, target.name));
      return value;
    }

    const container = this.evalExpression(target.target, env);
    const index = this.evalExpression(target.index, env);

    if (Array.isArray(container)) {
      if (typeof index !== "number" || !Number.isInteger(index)) {
        this.fail(`array indices must be whole numbers, got ${typeOf(index)}`, target.position, 1, "E0504");
      }
      const resolved = index < 0 ? container.length + index : index;
      if (resolved < 0 || resolved >= container.length) {
        this.fail(
          `index ${formatNumber(index)} is out of bounds for an array of length ${container.length}`,
          target.position,
          1,
          "E0504",
        );
      }
      const value = this.combine(operator, container[resolved]!, node, env);
      container[resolved] = value;
      return value;
    }

    if (container instanceof LumaHash) {
      const key = this.asHashKey(index, target.position);
      if (operator !== null && !container.entries.has(key)) {
        this.fail(
          `cannot apply '${operator}=' to a key that is not in the hash`,
          target.position,
        );
      }
      const value = this.combine(operator, container.entries.get(key) ?? null, node, env);
      container.entries.set(key, value);
      return value;
    }

    this.fail(`cannot assign into ${typeOf(container)}`, target.position);
  }

  private failUndeclared(name: string, position: Position): never {
    this.fail(
      `cannot assign to undeclared variable '${name}' — use 'let ${name} = ...'`,
      position,
      name.length,
    );
  }

  /** The value an assignment stores: the right-hand side, or `current op rhs`. */
  private combine(
    operator: string | null,
    current: LumaValue,
    node: AssignExpression,
    env: Environment,
  ): LumaValue {
    const right = this.evalExpression(node.value, env);
    return operator === null
      ? right
      : this.evalInfix(operator, current, right, node.position);
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
      this.fail(`${what} is not a function`, position, 1, "E0502");
    }

    if (args.length !== callee.parameters.length) {
      this.fail(
        `${callee.name || "anonymous function"} expects ${callee.parameters.length} ` +
          `argument${callee.parameters.length === 1 ? "" : "s"}, got ${args.length}`,
        position,
        1,
        "E0503",
      );
    }

    if (this.frames.length >= this.maxCallDepth) {
      this.fail(
        `maximum call depth of ${this.maxCallDepth} exceeded (infinite recursion?)`,
        position,
        1,
        "E0601",
      );
    }

    const scope = callee.env.child();
    callee.parameters.forEach((name, index) => scope.define(name, args[index] ?? null));

    const displayName = callee.name || "anonymous function";
    this.frames.push(`${displayName}(...)`);
    if (this.recorder !== null) {
      this.recorder.call(displayName, args, position, this.frames, scope);
    }

    try {
      const result = this.evalBlock(callee.body, scope);
      if (this.recorder !== null) {
        this.recorder.return_(result, position, this.frames, scope);
      }
      return result;
    } catch (error) {
      if (error instanceof ReturnSignal) {
        if (this.recorder !== null) {
          this.recorder.return_(error.value, position, this.frames, scope);
        }
        return error.value;
      }
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
      // rejected — for user functions and for builtins alike, which is what
      // makes `map(words, upper)` work. Direct user-level calls stay strict.
      call: (callee, args) => this.call(callee, trimArguments(callee, args), position),
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
      1,
      "E0503",
    );
  }

  // ------------------------------------------------------------------ helpers

  private asHashKey(value: LumaValue, position: Position): HashKey {
    const type = typeOf(value);
    if (type === "string" || type === "number" || type === "boolean") {
      return value as HashKey;
    }
    this.fail(`${type} cannot be used as a hash key`, position, 1, "E0504");
  }

  /** Give anonymous functions the name they are bound to — nicer stack traces. */
  private named(value: LumaValue, name: string): LumaValue {
    if (value instanceof LumaFunction && value.name === "") {
      return new LumaFunction(name, value.parameters, value.body, value.env);
    }
    return value;
  }

  private fail(
    message: string,
    position: Position,
    span = 1,
    code: DiagnosticCode = "E0501",
  ): never {
    throw new RuntimeError(message, position, {
      code,
      frames: [...this.frames].reverse(),
      span,
    });
  }
}

/**
 * Drop arguments a callback did not ask for.
 *
 * `map` hands its callback `(item, index)`, but most callbacks — including
 * builtins such as `upper` — only want the first. Extra arguments are dropped
 * rather than rejected, so `map(words, upper)` behaves the way it reads.
 */
function trimArguments(callee: LumaValue, args: LumaValue[]): LumaValue[] {
  if (callee instanceof LumaFunction) {
    return args.length > callee.parameters.length
      ? args.slice(0, callee.parameters.length)
      : args;
  }
  if (callee instanceof LumaBuiltin) {
    const [, max] = callee.arity;
    return args.length > max ? args.slice(0, max) : args;
  }
  return args;
}

function describeCallee(callee: Expression): string {
  if (callee.kind === "Identifier") return callee.name;
  if (callee.kind === "IndexExpression" && callee.index.kind === "StringLiteral") {
    return callee.index.value;
  }
  return "";
}
