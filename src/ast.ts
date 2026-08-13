/**
 * Abstract syntax tree.
 *
 * Nodes are plain data objects discriminated by `kind`, which keeps them cheap
 * to allocate, trivially serialisable (`luma ast file.luma` dumps JSON) and
 * exhaustively checkable by TypeScript in the evaluator's switch.
 */

import type { Position } from "./token.ts";

export interface NodeBase {
  /** Position of the node's first token. */
  position: Position;
  /**
   * Position just past the node's last token.
   *
   * Populated for **statements** only, which is what tooling needs to know how
   * many source lines a construct occupied — the formatter uses it to tell a
   * blank line the author wrote from the newline after a closing brace.
   */
  end?: Position;
}

// ------------------------------------------------------------------ program

export interface Program extends NodeBase {
  kind: "Program";
  body: Statement[];
}

// --------------------------------------------------------------- statements

export interface LetStatement extends NodeBase {
  kind: "LetStatement";
  name: string;
  value: Expression;
}

export interface ReturnStatement extends NodeBase {
  kind: "ReturnStatement";
  value: Expression | null;
}

export interface ExpressionStatement extends NodeBase {
  kind: "ExpressionStatement";
  expression: Expression;
}

export interface BlockStatement extends NodeBase {
  kind: "BlockStatement";
  body: Statement[];
}

export interface WhileStatement extends NodeBase {
  kind: "WhileStatement";
  condition: Expression;
  body: BlockStatement;
}

export interface ForStatement extends NodeBase {
  kind: "ForStatement";
  /** Loop variable, e.g. `for (item in list)`. */
  name: string;
  iterable: Expression;
  body: BlockStatement;
}

export interface BreakStatement extends NodeBase {
  kind: "BreakStatement";
}

export interface ContinueStatement extends NodeBase {
  kind: "ContinueStatement";
}

export interface FunctionDeclaration extends NodeBase {
  kind: "FunctionDeclaration";
  name: string;
  parameters: string[];
  body: BlockStatement;
}

export type Statement =
  | LetStatement
  | ReturnStatement
  | ExpressionStatement
  | BlockStatement
  | WhileStatement
  | ForStatement
  | BreakStatement
  | ContinueStatement
  | FunctionDeclaration;

// -------------------------------------------------------------- expressions

export interface Identifier extends NodeBase {
  kind: "Identifier";
  name: string;
}

export interface NumberLiteral extends NodeBase {
  kind: "NumberLiteral";
  value: number;
}

export interface StringLiteral extends NodeBase {
  kind: "StringLiteral";
  value: string;
}

export interface BooleanLiteral extends NodeBase {
  kind: "BooleanLiteral";
  value: boolean;
}

export interface NilLiteral extends NodeBase {
  kind: "NilLiteral";
}

export interface ArrayLiteral extends NodeBase {
  kind: "ArrayLiteral";
  elements: Expression[];
}

export interface HashLiteral extends NodeBase {
  kind: "HashLiteral";
  pairs: Array<{ key: Expression; value: Expression }>;
}

export interface FunctionLiteral extends NodeBase {
  kind: "FunctionLiteral";
  name: string | null;
  parameters: string[];
  body: BlockStatement;
}

export interface PrefixExpression extends NodeBase {
  kind: "PrefixExpression";
  operator: "-" | "!";
  right: Expression;
}

export interface InfixExpression extends NodeBase {
  kind: "InfixExpression";
  operator: string;
  left: Expression;
  right: Expression;
}

export interface LogicalExpression extends NodeBase {
  kind: "LogicalExpression";
  operator: "&&" | "||";
  left: Expression;
  right: Expression;
}

export interface IfExpression extends NodeBase {
  kind: "IfExpression";
  condition: Expression;
  consequence: BlockStatement;
  alternative: BlockStatement | IfExpression | null;
}

export interface CallExpression extends NodeBase {
  kind: "CallExpression";
  callee: Expression;
  args: Expression[];
}

export interface IndexExpression extends NodeBase {
  kind: "IndexExpression";
  target: Expression;
  index: Expression;
}

export interface AssignExpression extends NodeBase {
  kind: "AssignExpression";
  target: Identifier | IndexExpression;
  value: Expression;
  /**
   * Set for compound assignment: `a += 1` carries `"+"`.
   *
   * Kept as an operator rather than desugared to `a = a + 1` so the target is
   * evaluated exactly once — `items[next()] += 1` must not call `next` twice.
   */
  operator: string | null;
}

/** An interpolated string: `"hi, {name}"`. */
export interface TemplateLiteral extends NodeBase {
  kind: "TemplateLiteral";
  /** Alternating literal text and embedded expressions, in source order. */
  parts: Array<{ kind: "text"; value: string } | { kind: "expression"; value: Expression }>;
}

// ----------------------------------------------------------------- patterns

export interface WildcardPattern extends NodeBase {
  kind: "WildcardPattern";
}

/** Matches a value equal to a literal: `0`, `"circle"`, `true`, `nil`. */
export interface LiteralPattern extends NodeBase {
  kind: "LiteralPattern";
  value: Expression;
}

/** Always matches, binding the value to a name for the arm's body. */
export interface BindingPattern extends NodeBase {
  kind: "BindingPattern";
  name: string;
}

export interface ArrayPattern extends NodeBase {
  kind: "ArrayPattern";
  elements: Pattern[];
  /** Name bound to the remaining elements by a trailing `...rest`, if present. */
  rest: string | null;
}

export interface HashPattern extends NodeBase {
  kind: "HashPattern";
  /** Only the listed keys need to be present; extra keys are ignored. */
  entries: Array<{ key: Expression; value: Pattern }>;
}

/** `1 | 2 | 3` — alternatives, none of which may bind a name. */
export interface OrPattern extends NodeBase {
  kind: "OrPattern";
  options: Pattern[];
}

export type Pattern =
  | WildcardPattern
  | LiteralPattern
  | BindingPattern
  | ArrayPattern
  | HashPattern
  | OrPattern;

export interface MatchArm {
  pattern: Pattern;
  /** Optional `if` guard, evaluated with the pattern's bindings in scope. */
  guard: Expression | null;
  body: Expression | BlockStatement;
}

export interface MatchExpression extends NodeBase {
  kind: "MatchExpression";
  subject: Expression;
  arms: MatchArm[];
}

export type Expression =
  | Identifier
  | NumberLiteral
  | StringLiteral
  | TemplateLiteral
  | BooleanLiteral
  | NilLiteral
  | ArrayLiteral
  | HashLiteral
  | FunctionLiteral
  | PrefixExpression
  | InfixExpression
  | LogicalExpression
  | IfExpression
  | MatchExpression
  | CallExpression
  | IndexExpression
  | AssignExpression;

export type Node = Program | Statement | Expression | Pattern;
