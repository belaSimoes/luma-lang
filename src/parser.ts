/**
 * Pratt (top-down operator precedence) parser.
 *
 * Each token type may register a prefix and/or infix parse rule; the core loop
 * in `parseExpression` keeps consuming infix operators while the next one binds
 * more tightly than the current context. This is what makes `a + b * c[0].d`
 * fall out without a stack of mutually recursive grammar functions.
 */

import type {
  ArrayLiteral,
  BlockStatement,
  Expression,
  FunctionLiteral,
  HashLiteral,
  Identifier,
  IfExpression,
  IndexExpression,
  Program,
  Statement,
} from "./ast.ts";
import { LumaError, LumaErrorGroup, SyntaxError_ } from "./errors.ts";
import { Lexer } from "./lexer.ts";
import { describeToken, type Position, type Token, type TokenType } from "./token.ts";

const LOWEST = 0;
const ASSIGNMENT = 1;
const PREFIX = 8;

/** Beyond this many syntax errors, later ones are almost certainly cascades. */
const MAX_SYNTAX_ERRORS = 10;

/** Binding power of each infix/postfix operator. */
const PRECEDENCE: Partial<Record<TokenType, number>> = {
  ASSIGN: ASSIGNMENT,
  OR: 2,
  AND: 3,
  EQ: 4,
  NOT_EQ: 4,
  LT: 5,
  GT: 5,
  LTE: 5,
  GTE: 5,
  PLUS: 6,
  MINUS: 6,
  STAR: 7,
  SLASH: 7,
  PERCENT: 7,
  // Calls and indexing bind tighter than unary `-`/`!` so that `-f(x)[0]`
  // parses as `-((f(x))[0])`.
  LPAREN: 9,
  LBRACKET: 10,
  DOT: 10,
};

export class Parser {
  private readonly tokens: Token[];
  private cursor = 0;

  constructor(source: string) {
    this.tokens = new Lexer(source).tokenize();
  }

  /**
   * Parse the whole program, recovering after each failed statement so that one
   * run reports every syntax error instead of only the first.
   *
   * Recovery is classic panic mode: record the error, then skip tokens until a
   * point where a new statement can plausibly begin. Cascading nonsense is
   * capped by {@link MAX_SYNTAX_ERRORS}.
   */
  parseProgram(): Program {
    const position = this.current().position;
    const body: Statement[] = [];
    const errors: LumaError[] = [];

    while (!this.currentIs("EOF")) {
      const before = this.cursor;
      try {
        body.push(this.parseStatement());
      } catch (error) {
        if (!(error instanceof LumaError)) throw error;
        errors.push(error);
        if (errors.length >= MAX_SYNTAX_ERRORS) break;
        this.synchronize(before);
      }
    }

    if (errors.length > 0) throw new LumaErrorGroup(errors);
    return { kind: "Program", body, position };
  }

  /**
   * Skip to the next likely statement boundary. Always consumes at least one
   * token — `startedAt` guards against a rule that failed without advancing,
   * which would otherwise spin forever.
   */
  private synchronize(startedAt: number): void {
    if (this.cursor === startedAt) this.advance();

    while (!this.currentIs("EOF")) {
      if (this.tokens[this.cursor - 1]?.type === "SEMICOLON") return;
      switch (this.current().type) {
        case "LET":
        case "FN":
        case "IF":
        case "WHILE":
        case "FOR":
        case "RETURN":
        case "BREAK":
        case "CONTINUE":
          return;
        case "RBRACE":
          this.advance();
          return;
        default:
          this.advance();
      }
    }
  }

  // --------------------------------------------------------------- statements

  private parseStatement(): Statement {
    switch (this.current().type) {
      case "LET":
        return this.parseLetStatement();
      case "RETURN":
        return this.parseReturnStatement();
      case "WHILE":
        return this.parseWhileStatement();
      case "FOR":
        return this.parseForStatement();
      case "BREAK":
      case "CONTINUE":
        return this.parseLoopControl();
      case "LBRACE":
        // `{` is ambiguous at the start of a statement, exactly as in
        // JavaScript. A block wins by default, but `{ key: ... }` can only ever
        // be a hash literal — no statement may start with `<literal> :` — so a
        // two-token lookahead removes the wart for the common shapes.
        return this.looksLikeHashLiteral() ? this.parseExpressionStatement() : this.parseBlock();
      case "FN":
        // `fn name(...) {...}` is a declaration; bare `fn(...) {...}` is an
        // expression, so only commit when an identifier follows.
        if (this.peek().type === "IDENT") return this.parseFunctionDeclaration();
        break;
    }
    return this.parseExpressionStatement();
  }

  /** True for `{}` and for `{ <atom> : ... }`, both unambiguously hashes. */
  private looksLikeHashLiteral(): boolean {
    const after = this.peekAt(1).type;
    if (after === "RBRACE") return true;
    const isAtom =
      after === "STRING" || after === "NUMBER" || after === "IDENT" ||
      after === "TRUE" || after === "FALSE";
    return isAtom && this.peekAt(2).type === "COLON";
  }

  private parseLetStatement(): Statement {
    const position = this.advance().position; // `let`
    const name = this.expect("IDENT", "a variable name after 'let'").literal;
    this.expect("ASSIGN", "'=' after the variable name");
    const value = this.parseExpression(LOWEST);
    this.consumeSemicolon();
    return { kind: "LetStatement", name, value, position };
  }

  private parseReturnStatement(): Statement {
    const position = this.advance().position; // `return`
    if (this.currentIs("SEMICOLON") || this.currentIs("RBRACE") || this.currentIs("EOF")) {
      this.consumeSemicolon();
      return { kind: "ReturnStatement", value: null, position };
    }
    const value = this.parseExpression(LOWEST);
    this.consumeSemicolon();
    return { kind: "ReturnStatement", value, position };
  }

  private parseWhileStatement(): Statement {
    const position = this.advance().position; // `while`
    this.expect("LPAREN", "'(' after 'while'");
    const condition = this.parseExpression(LOWEST);
    this.expect("RPAREN", "')' after the loop condition");
    const body = this.parseBlock();
    return { kind: "WhileStatement", condition, body, position };
  }

  private parseForStatement(): Statement {
    const position = this.advance().position; // `for`
    this.expect("LPAREN", "'(' after 'for'");
    const name = this.expect("IDENT", "a loop variable, as in 'for (item in list)'").literal;
    this.expect("IN", "'in' after the loop variable");
    const iterable = this.parseExpression(LOWEST);
    this.expect("RPAREN", "')' after the iterable");
    const body = this.parseBlock();
    return { kind: "ForStatement", name, iterable, body, position };
  }

  private parseLoopControl(): Statement {
    const token = this.advance();
    this.consumeSemicolon();
    return token.type === "BREAK"
      ? { kind: "BreakStatement", position: token.position }
      : { kind: "ContinueStatement", position: token.position };
  }

  private parseFunctionDeclaration(): Statement {
    const position = this.advance().position; // `fn`
    const name = this.advance().literal; // IDENT, checked by the caller
    const parameters = this.parseParameters();
    const body = this.parseBlock();
    return { kind: "FunctionDeclaration", name, parameters, body, position };
  }

  private parseExpressionStatement(): Statement {
    const position = this.current().position;
    const expression = this.parseExpression(LOWEST);
    this.consumeSemicolon();
    return { kind: "ExpressionStatement", expression, position };
  }

  private parseBlock(): BlockStatement {
    const position = this.expect("LBRACE", "'{' to open a block").position;
    const body: Statement[] = [];
    while (!this.currentIs("RBRACE")) {
      if (this.currentIs("EOF")) {
        throw new SyntaxError_("unclosed block: expected '}'", position);
      }
      body.push(this.parseStatement());
    }
    this.advance(); // `}`
    return { kind: "BlockStatement", body, position };
  }

  // -------------------------------------------------------------- expressions

  private parseExpression(precedence: number): Expression {
    let left = this.parsePrefix();

    while (precedence < this.precedenceOf(this.current().type)) {
      left = this.parseInfix(left);
    }

    return left;
  }

  private parsePrefix(): Expression {
    const token = this.current();
    switch (token.type) {
      case "IDENT":
        this.advance();
        return { kind: "Identifier", name: token.literal, position: token.position };
      case "NUMBER":
        this.advance();
        return {
          kind: "NumberLiteral",
          value: Number(token.literal),
          position: token.position,
        };
      case "STRING":
        this.advance();
        return { kind: "StringLiteral", value: token.literal, position: token.position };
      case "TRUE":
      case "FALSE":
        this.advance();
        return {
          kind: "BooleanLiteral",
          value: token.type === "TRUE",
          position: token.position,
        };
      case "NIL":
        this.advance();
        return { kind: "NilLiteral", position: token.position };
      case "BANG":
      case "MINUS": {
        this.advance();
        const right = this.parseExpression(PREFIX);
        return {
          kind: "PrefixExpression",
          operator: token.type === "BANG" ? "!" : "-",
          right,
          position: token.position,
        };
      }
      case "LPAREN": {
        this.advance();
        const inner = this.parseExpression(LOWEST);
        this.expect("RPAREN", "')' to close the group");
        return inner;
      }
      case "LBRACKET":
        return this.parseArrayLiteral();
      case "LBRACE":
        return this.parseHashLiteral();
      case "IF":
        return this.parseIfExpression();
      case "FN":
        return this.parseFunctionLiteral();
      default:
        throw new SyntaxError_(
          `unexpected ${describeToken(token)} at the start of an expression`,
          token.position,
        );
    }
  }

  private parseInfix(left: Expression): Expression {
    const token = this.current();

    switch (token.type) {
      case "LPAREN":
        return this.parseCall(left);
      case "LBRACKET":
        return this.parseIndex(left);
      case "DOT":
        return this.parseMember(left);
      case "ASSIGN":
        return this.parseAssignment(left);
      case "AND":
      case "OR": {
        this.advance();
        const right = this.parseExpression(this.precedenceOf(token.type));
        return {
          kind: "LogicalExpression",
          operator: token.type === "AND" ? "&&" : "||",
          left,
          right,
          position: token.position,
        };
      }
      default: {
        this.advance();
        const right = this.parseExpression(this.precedenceOf(token.type));
        return {
          kind: "InfixExpression",
          operator: token.literal,
          left,
          right,
          position: token.position,
        };
      }
    }
  }

  private parseAssignment(left: Expression): Expression {
    const token = this.advance(); // `=`
    if (left.kind !== "Identifier" && left.kind !== "IndexExpression") {
      throw new SyntaxError_(
        "invalid assignment target: expected a variable or an index expression",
        left.position,
      );
    }
    // Right-associative: `a = b = c` parses as `a = (b = c)`.
    const value = this.parseExpression(ASSIGNMENT - 1);
    return {
      kind: "AssignExpression",
      target: left as Identifier | IndexExpression,
      value,
      position: token.position,
    };
  }

  private parseCall(callee: Expression): Expression {
    const position = this.advance().position; // `(`
    const args = this.parseExpressionList("RPAREN");
    return { kind: "CallExpression", callee, args, position };
  }

  private parseIndex(target: Expression): Expression {
    const position = this.advance().position; // `[`
    const index = this.parseExpression(LOWEST);
    this.expect("RBRACKET", "']' to close the index");
    return { kind: "IndexExpression", target, index, position };
  }

  /** `value.key` is sugar for `value["key"]`. */
  private parseMember(target: Expression): Expression {
    const position = this.advance().position; // `.`
    const name = this.expect("IDENT", "a property name after '.'");
    return {
      kind: "IndexExpression",
      target,
      index: { kind: "StringLiteral", value: name.literal, position: name.position },
      position,
    };
  }

  private parseArrayLiteral(): ArrayLiteral {
    const position = this.advance().position; // `[`
    const elements = this.parseExpressionList("RBRACKET");
    return { kind: "ArrayLiteral", elements, position };
  }

  private parseHashLiteral(): HashLiteral {
    const position = this.advance().position; // `{`
    const pairs: HashLiteral["pairs"] = [];
    while (!this.currentIs("RBRACE")) {
      const key = this.parseExpression(LOWEST);
      this.expect("COLON", "':' between a hash key and its value");
      const value = this.parseExpression(LOWEST);
      pairs.push({ key, value });
      if (!this.currentIs("RBRACE")) {
        this.expect("COMMA", "',' or '}' in the hash literal");
      }
    }
    this.expect("RBRACE", "'}' to close the hash literal");
    return { kind: "HashLiteral", pairs, position };
  }

  private parseIfExpression(): IfExpression {
    const position = this.advance().position; // `if`
    this.expect("LPAREN", "'(' after 'if'");
    const condition = this.parseExpression(LOWEST);
    this.expect("RPAREN", "')' after the condition");
    const consequence = this.parseBlock();

    let alternative: IfExpression | BlockStatement | null = null;
    if (this.currentIs("ELSE")) {
      this.advance();
      alternative = this.currentIs("IF") ? this.parseIfExpression() : this.parseBlock();
    }

    return { kind: "IfExpression", condition, consequence, alternative, position };
  }

  private parseFunctionLiteral(): FunctionLiteral {
    const position = this.advance().position; // `fn`
    const name = this.currentIs("IDENT") ? this.advance().literal : null;
    const parameters = this.parseParameters();
    const body = this.parseBlock();
    return { kind: "FunctionLiteral", name, parameters, body, position };
  }

  private parseParameters(): string[] {
    this.expect("LPAREN", "'(' to open the parameter list");
    const parameters: string[] = [];
    const seen = new Set<string>();
    while (!this.currentIs("RPAREN")) {
      const token = this.expect("IDENT", "a parameter name");
      if (seen.has(token.literal)) {
        throw new SyntaxError_(
          `duplicate parameter '${token.literal}'`,
          token.position,
        );
      }
      seen.add(token.literal);
      parameters.push(token.literal);
      if (!this.currentIs("RPAREN")) {
        this.expect("COMMA", "',' or ')' in the parameter list");
      }
    }
    this.advance(); // `)`
    return parameters;
  }

  private parseExpressionList(terminator: TokenType): Expression[] {
    const closer = terminator === "RPAREN" ? ")" : "]";
    const items: Expression[] = [];
    while (!this.currentIs(terminator)) {
      if (this.currentIs("EOF")) {
        throw new SyntaxError_(
          `unexpected end of input: expected '${closer}'`,
          this.current().position,
        );
      }
      items.push(this.parseExpression(LOWEST));
      if (!this.currentIs(terminator)) {
        this.expect("COMMA", `',' or '${closer}'`);
      }
    }
    this.advance(); // terminator
    return items;
  }

  // ------------------------------------------------------------------ cursor

  private current(): Token {
    return this.tokens[Math.min(this.cursor, this.tokens.length - 1)]!;
  }

  private peek(): Token {
    return this.peekAt(1);
  }

  private peekAt(offset: number): Token {
    return this.tokens[Math.min(this.cursor + offset, this.tokens.length - 1)]!;
  }

  private currentIs(type: TokenType): boolean {
    return this.current().type === type;
  }

  private advance(): Token {
    const token = this.current();
    if (this.cursor < this.tokens.length - 1) this.cursor += 1;
    return token;
  }

  private expect(type: TokenType, what: string): Token {
    if (!this.currentIs(type)) {
      const token = this.current();
      throw new SyntaxError_(
        `expected ${what}, found ${describeToken(token)}`,
        token.position,
      );
    }
    return this.advance();
  }

  private consumeSemicolon(): void {
    if (this.currentIs("SEMICOLON")) this.advance();
  }

  private precedenceOf(type: TokenType): number {
    return PRECEDENCE[type] ?? LOWEST;
  }
}

/** Parse a complete program. Throws {@link SyntaxError_} on the first error. */
export function parse(source: string): Program {
  return new Parser(source).parseProgram();
}

export type { Position };
