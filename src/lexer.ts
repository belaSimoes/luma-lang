/**
 * Hand-written lexer.
 *
 * Single pass, no regular expressions, O(n) over the source. Every token keeps
 * the position of its *first* character so diagnostics can point at it.
 */

import { KEYWORDS, type Position, type Token, type TokenType } from "./token.ts";
import { SyntaxError_ } from "./errors.ts";

const ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  "0": "\0",
  '"': '"',
  "'": "'",
  "\\": "\\",
};

export class Lexer {
  private readonly source: string;
  private index = 0;
  private line = 1;
  private column = 1;

  constructor(source: string) {
    this.source = source;
  }

  /** Tokenize the whole input, always terminated by a single EOF token. */
  tokenize(): Token[] {
    const tokens: Token[] = [];
    for (;;) {
      const token = this.next();
      tokens.push(token);
      if (token.type === "EOF") return tokens;
    }
  }

  next(): Token {
    this.skipTrivia();
    const position = this.position();
    const ch = this.peek();

    if (ch === "") return this.token("EOF", "", position);

    if (isDigit(ch)) return this.readNumber(position);
    if (isIdentStart(ch)) return this.readIdentifier(position);
    if (ch === '"' || ch === "'") return this.readString(position);

    return this.readOperator(position);
  }

  // ---------------------------------------------------------------- scanning

  private readNumber(position: Position): Token {
    const start = this.index;
    while (isDigit(this.peek()) || this.peek() === "_") this.advance();

    // Fractional part — only when followed by a digit so that `1.method` and
    // range-like syntax stay unambiguous.
    if (this.peek() === "." && isDigit(this.peek(1))) {
      this.advance();
      while (isDigit(this.peek()) || this.peek() === "_") this.advance();
    }

    // Exponent.
    if (this.peek() === "e" || this.peek() === "E") {
      const sign = this.peek(1);
      const offset = sign === "+" || sign === "-" ? 2 : 1;
      if (isDigit(this.peek(offset))) {
        for (let i = 0; i < offset; i++) this.advance();
        while (isDigit(this.peek())) this.advance();
      }
    }

    const raw = this.source.slice(start, this.index).replaceAll("_", "");
    if (!Number.isFinite(Number(raw))) {
      throw new SyntaxError_(`invalid number literal '${raw}'`, position);
    }
    return this.token("NUMBER", raw, position);
  }

  private readIdentifier(position: Position): Token {
    const start = this.index;
    while (isIdentPart(this.peek())) this.advance();
    const raw = this.source.slice(start, this.index);
    return this.token(KEYWORDS[raw] ?? "IDENT", raw, position);
  }

  private readString(position: Position): Token {
    const quote = this.advance();
    let value = "";
    for (;;) {
      const ch = this.peek();
      if (ch === "") {
        throw new SyntaxError_("unterminated string literal", position);
      }
      if (ch === "\n") {
        throw new SyntaxError_(
          "unterminated string literal (newlines must be written as \\n)",
          position,
        );
      }
      this.advance();
      if (ch === quote) break;
      if (ch !== "\\") {
        value += ch;
        continue;
      }
      const escape = this.peek();
      if (escape === "") {
        throw new SyntaxError_("unterminated escape sequence", this.position());
      }
      const decoded = ESCAPES[escape];
      if (decoded === undefined) {
        throw new SyntaxError_(`unknown escape sequence '\\${escape}'`, this.position());
      }
      this.advance();
      value += decoded;
    }
    return this.token("STRING", value, position);
  }

  private readOperator(position: Position): Token {
    const ch = this.advance();
    const nextCh = this.peek();

    const two = (type: TokenType): Token => {
      this.advance();
      return this.token(type, ch + nextCh, position);
    };

    switch (ch) {
      case "=":
        return nextCh === "=" ? two("EQ") : this.token("ASSIGN", ch, position);
      case "!":
        return nextCh === "=" ? two("NOT_EQ") : this.token("BANG", ch, position);
      case "<":
        return nextCh === "=" ? two("LTE") : this.token("LT", ch, position);
      case ">":
        return nextCh === "=" ? two("GTE") : this.token("GT", ch, position);
      case "&":
        if (nextCh === "&") return two("AND");
        break;
      case "|":
        if (nextCh === "|") return two("OR");
        break;
      case "+":
        return this.token("PLUS", ch, position);
      case "-":
        return this.token("MINUS", ch, position);
      case "*":
        return this.token("STAR", ch, position);
      case "/":
        return this.token("SLASH", ch, position);
      case "%":
        return this.token("PERCENT", ch, position);
      case ",":
        return this.token("COMMA", ch, position);
      case ";":
        return this.token("SEMICOLON", ch, position);
      case ":":
        return this.token("COLON", ch, position);
      case ".":
        return this.token("DOT", ch, position);
      case "(":
        return this.token("LPAREN", ch, position);
      case ")":
        return this.token("RPAREN", ch, position);
      case "{":
        return this.token("LBRACE", ch, position);
      case "}":
        return this.token("RBRACE", ch, position);
      case "[":
        return this.token("LBRACKET", ch, position);
      case "]":
        return this.token("RBRACKET", ch, position);
    }

    throw new SyntaxError_(`unexpected character '${ch}'`, position);
  }

  private skipTrivia(): void {
    for (;;) {
      const ch = this.peek();
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        this.advance();
        continue;
      }
      if (ch === "/" && this.peek(1) === "/") {
        while (this.peek() !== "" && this.peek() !== "\n") this.advance();
        continue;
      }
      if (ch === "/" && this.peek(1) === "*") {
        const opened = this.position();
        this.advance();
        this.advance();
        for (;;) {
          if (this.peek() === "") {
            throw new SyntaxError_("unterminated block comment", opened);
          }
          if (this.peek() === "*" && this.peek(1) === "/") {
            this.advance();
            this.advance();
            break;
          }
          this.advance();
        }
        continue;
      }
      return;
    }
  }

  // ----------------------------------------------------------------- cursor

  private peek(offset = 0): string {
    return this.source[this.index + offset] ?? "";
  }

  private advance(): string {
    const ch = this.source[this.index] ?? "";
    this.index += 1;
    if (ch === "\n") {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
    return ch;
  }

  private position(): Position {
    return { line: this.line, column: this.column };
  }

  /**
   * Build a token. Called once the lexeme has been consumed, so the cursor is
   * sitting exactly at the token's end.
   */
  private token(type: TokenType, literal: string, position: Position): Token {
    return { type, literal, position, end: this.position() };
  }
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isIdentStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch);
}

/** Convenience helper used by tests and tooling. */
export function tokenize(source: string): Token[] {
  return new Lexer(source).tokenize();
}
