/**
 * Static analysis pass.
 *
 * The resolver walks the AST once, before evaluation, and reports the mistakes
 * that do not need to be discovered the hard way:
 *
 *   - references to variables that were never declared (with a spelling hint)
 *   - assignment to a name that no `let` introduced
 *   - `break` / `continue` outside a loop, `return` outside a function
 *   - code that can never be reached (reported as a warning)
 *
 * It mirrors the interpreter's scoping rules exactly: every block introduces one
 * scope, and a `for` variable or a parameter list shares the scope of the body
 * it belongs to.
 *
 * Function *bodies* are deferred until the enclosing scope has been fully
 * walked. That is what makes mutual recursion resolve — `even` may call `odd`
 * even though `odd` is declared on the following line — while still catching a
 * genuinely undeclared name.
 */

import type {
  BlockStatement,
  Expression,
  Pattern,
  Program,
  Statement,
} from "./ast.ts";
import { LumaError, SemanticError, suggest } from "./errors.ts";
import type { Position } from "./token.ts";

/** A deferred function body, captured together with the scopes it closed over. */
interface PendingBody {
  scopes: Array<Set<string>>;
  parameters: string[];
  body: BlockStatement;
}

export interface ResolveOptions {
  /** Names that already exist before this program runs: builtins, REPL history. */
  globals?: Iterable<string>;
}

export interface ResolveResult {
  errors: LumaError[];
  warnings: LumaError[];
}

class Resolver {
  private readonly globals: Set<string>;
  private readonly diagnostics: LumaError[] = [];
  private readonly pending: PendingBody[] = [];
  private scopes: Array<Set<string>> = [];
  private loopDepth = 0;
  private functionDepth = 0;

  constructor(globals: Iterable<string>) {
    this.globals = new Set(globals);
  }

  resolve(program: Program): ResolveResult {
    this.scopes = [new Set()];
    this.walkStatements(program.body);

    // Function bodies run later, so they are resolved last — by then every name
    // declared in their enclosing scopes is visible.
    while (this.pending.length > 0) {
      const next = this.pending.shift()!;
      this.resolveBody(next);
    }

    return {
      errors: this.diagnostics.filter((d) => d.severity === "error"),
      warnings: this.diagnostics.filter((d) => d.severity === "warning"),
    };
  }

  // ------------------------------------------------------------------ scopes

  private push(): void {
    this.scopes.push(new Set());
  }

  private pop(): void {
    this.scopes.pop();
  }

  private declareName(name: string): void {
    this.scopes.at(-1)?.add(name);
  }

  private errorCount(): number {
    return this.diagnostics.reduce(
      (total, diagnostic) => total + (diagnostic.severity === "error" ? 1 : 0),
      0,
    );
  }

  private isDeclared(name: string): boolean {
    return this.scopes.some((scope) => scope.has(name)) || this.globals.has(name);
  }

  /** Every name a reference at this point could plausibly have meant. */
  private visibleNames(): Set<string> {
    const names = new Set(this.globals);
    for (const scope of this.scopes) {
      for (const name of scope) names.add(name);
    }
    return names;
  }

  private resolveBody({ scopes, parameters, body }: PendingBody): void {
    const outerScopes = this.scopes;
    const outerLoop = this.loopDepth;
    const outerFunction = this.functionDepth;

    // A function body cannot `break` out into an enclosing loop, but it is
    // definitely inside a function.
    this.scopes = [...scopes, new Set(parameters)];
    this.loopDepth = 0;
    this.functionDepth = 1;

    this.walkStatements(body.body);

    this.scopes = outerScopes;
    this.loopDepth = outerLoop;
    this.functionDepth = outerFunction;
  }

  // -------------------------------------------------------------- statements

  private walkStatements(statements: Statement[]): void {
    for (const [index, statement] of statements.entries()) {
      const before = this.errorCount();
      this.walkStatement(statement);

      // A statement that was itself rejected — a `break` outside a loop, say —
      // should not also blame the following line for being unreachable.
      const misplaced = this.errorCount() > before;

      if (!misplaced && index < statements.length - 1 && exits(statement)) {
        const next = statements[index + 1]!;
        this.report(
          `unreachable code: the ${keywordOf(statement)} above always leaves this block`,
          next.position,
          { severity: "warning" },
        );
        // One warning per block is enough; the rest of the statements are still
        // resolved so their own mistakes are not hidden.
      }
    }
  }

  /** Walk a block that owns its scope — a body, a branch, a loop iteration. */
  private walkScopedBlock(block: BlockStatement, predeclare: string[] = []): void {
    this.push();
    for (const name of predeclare) this.declareName(name);
    this.walkStatements(block.body);
    this.pop();
  }

  private walkStatement(node: Statement): void {
    switch (node.kind) {
      case "LetStatement":
        this.walkExpression(node.value);
        this.declareName(node.name);
        return;

      case "FunctionDeclaration":
        // Declared before the body is queued so the function can call itself.
        this.declareName(node.name);
        this.defer(node.parameters, node.body);
        return;

      case "ReturnStatement":
        if (this.functionDepth === 0) {
          this.report("'return' outside of a function", node.position, {
            span: "return".length,
            hint: "return may only appear inside a function body",
          });
        }
        if (node.value !== null) this.walkExpression(node.value);
        return;

      case "ExpressionStatement":
        this.walkExpression(node.expression);
        return;

      case "BlockStatement":
        this.walkScopedBlock(node);
        return;

      case "WhileStatement":
        this.walkExpression(node.condition);
        this.loopDepth += 1;
        this.walkScopedBlock(node.body);
        this.loopDepth -= 1;
        return;

      case "ForStatement":
        this.walkExpression(node.iterable);
        this.loopDepth += 1;
        // The loop variable shares the body's scope, exactly as at runtime.
        this.walkScopedBlock(node.body, [node.name]);
        this.loopDepth -= 1;
        return;

      case "BreakStatement":
      case "ContinueStatement": {
        if (this.loopDepth === 0) {
          const keyword = node.kind === "BreakStatement" ? "break" : "continue";
          this.report(`'${keyword}' outside of a loop`, node.position, {
            span: keyword.length,
            hint: `${keyword} may only appear inside a while or for loop`,
          });
        }
        return;
      }
    }
  }

  // ------------------------------------------------------------- expressions

  private walkExpression(node: Expression): void {
    switch (node.kind) {
      case "NumberLiteral":
      case "StringLiteral":
      case "BooleanLiteral":
      case "NilLiteral":
        return;

      case "Identifier":
        if (!this.isDeclared(node.name)) {
          this.reportUnknownName(`undefined variable '${node.name}'`, node.name, node.position);
        }
        return;

      case "ArrayLiteral":
        for (const element of node.elements) this.walkExpression(element);
        return;

      case "HashLiteral":
        for (const pair of node.pairs) {
          this.walkExpression(pair.key);
          this.walkExpression(pair.value);
        }
        return;

      case "FunctionLiteral":
        // A named function expression can refer to itself from inside its body.
        this.defer(node.parameters, node.body, node.name);
        return;

      case "PrefixExpression":
        this.walkExpression(node.right);
        return;

      case "InfixExpression":
      case "LogicalExpression":
        this.walkExpression(node.left);
        this.walkExpression(node.right);
        return;

      case "IfExpression":
        this.walkExpression(node.condition);
        this.walkScopedBlock(node.consequence);
        if (node.alternative === null) return;
        if (node.alternative.kind === "IfExpression") {
          this.walkExpression(node.alternative);
        } else {
          this.walkScopedBlock(node.alternative);
        }
        return;

      case "TemplateLiteral":
        for (const part of node.parts) {
          if (part.kind === "expression") this.walkExpression(part.value);
        }
        return;

      case "MatchExpression":
        this.walkExpression(node.subject);
        for (const arm of node.arms) {
          // Each arm gets its own scope holding the names its pattern binds;
          // the guard can see them too, which is the point of a guard.
          this.push();
          for (const name of patternBindings(arm.pattern)) this.declareName(name);
          if (arm.guard !== null) this.walkExpression(arm.guard);
          if (arm.body.kind === "BlockStatement") {
            this.walkStatements(arm.body.body);
          } else {
            this.walkExpression(arm.body);
          }
          this.pop();
        }
        return;

      case "CallExpression":
        this.walkExpression(node.callee);
        for (const argument of node.args) this.walkExpression(argument);
        return;

      case "IndexExpression":
        this.walkExpression(node.target);
        this.walkExpression(node.index);
        return;

      case "AssignExpression":
        this.walkExpression(node.value);
        if (node.target.kind === "Identifier") {
          if (!this.isDeclared(node.target.name)) {
            this.reportUnknownName(
              `cannot assign to undeclared variable '${node.target.name}'`,
              node.target.name,
              node.target.position,
              `use 'let ${node.target.name} = ...' to declare it first`,
            );
          }
          return;
        }
        this.walkExpression(node.target);
        return;
    }
  }

  private defer(parameters: string[], body: BlockStatement, selfName?: string | null): void {
    const scopes = [...this.scopes];
    if (selfName) {
      // Give the body one extra scope holding just the function's own name.
      scopes.push(new Set([selfName]));
    }
    this.pending.push({ scopes, parameters, body });
  }

  // ------------------------------------------------------------ diagnostics

  private reportUnknownName(
    message: string,
    name: string,
    position: Position,
    fallbackHint?: string,
  ): void {
    const closest = suggest(name, this.visibleNames());
    this.report(message, position, {
      span: name.length,
      hint: closest !== null ? `did you mean '${closest}'?` : fallbackHint,
    });
  }

  private report(
    message: string,
    position: Position,
    options: { span?: number; hint?: string | undefined; severity?: "error" | "warning" } = {},
  ): void {
    this.diagnostics.push(
      new SemanticError(message, position, {
        span: options.span ?? 1,
        hint: options.hint,
        severity: options.severity ?? "error",
      }),
    );
  }
}

/** Every name a pattern introduces, in source order. */
export function patternBindings(pattern: Pattern): string[] {
  switch (pattern.kind) {
    case "BindingPattern":
      return [pattern.name];
    case "ArrayPattern": {
      const names = pattern.elements.flatMap(patternBindings);
      return pattern.rest === null ? names : [...names, pattern.rest];
    }
    case "HashPattern":
      return pattern.entries.flatMap((entry) => patternBindings(entry.value));
    case "OrPattern":
      // The parser rejects binding alternatives, so this is always empty.
      return pattern.options.flatMap(patternBindings);
    default:
      return [];
  }
}

/** True when a statement always transfers control out of its block. */
function exits(statement: Statement): boolean {
  return (
    statement.kind === "ReturnStatement" ||
    statement.kind === "BreakStatement" ||
    statement.kind === "ContinueStatement"
  );
}

function keywordOf(statement: Statement): string {
  switch (statement.kind) {
    case "ReturnStatement":
      return "'return'";
    case "BreakStatement":
      return "'break'";
    default:
      return "'continue'";
  }
}

/**
 * Analyse a program without running it.
 *
 * Returns errors and warnings separately; callers decide whether warnings are
 * worth printing. Never throws.
 */
export function resolve(program: Program, options: ResolveOptions = {}): ResolveResult {
  return new Resolver(options.globals ?? []).resolve(program);
}
