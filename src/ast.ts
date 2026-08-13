/**
 * Abstract syntax tree.
 *
 * Nodes are plain data objects discriminated by `kind`, which keeps them cheap
 * to allocate, trivially serialisable (`luma ast file.luma` dumps JSON) and
 * exhaustively checkable by TypeScript in the evaluator's switch.
 */

import type { Position } from "./token.ts";

export interface NodeBase {
  position: Position;
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
}

export type Expression =
  | Identifier
  | NumberLiteral
  | StringLiteral
  | BooleanLiteral
  | NilLiteral
  | ArrayLiteral
  | HashLiteral
  | FunctionLiteral
  | PrefixExpression
  | InfixExpression
  | LogicalExpression
  | IfExpression
  | CallExpression
  | IndexExpression
  | AssignExpression;

export type Node = Program | Statement | Expression;
