/**
 * Hand-written lexer.
 *
 * Single pass, no regular expressions, O(n) over the source. Every token keeps
 * the position of its *first* character so diagnostics can point at it.
 */

import {
  KEYWORDS,
  type Position,
  type TemplatePart,
  type Token,
  type TokenType,
} from "./token.ts";
import { SyntaxError_ } from "./errors.ts";

/** Byte-order mark: editors on Windows prepend one to UTF-8 files. */
const BOM = String.fromCharCode(0xfeff);

const ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  "0": "\0",
  '"': '"',
  "'": "'",
  "\\": "\\",
  // Escape hatches for interpolation: `"\{"` is a literal brace.
  "{": "{",
  "}": "}",
};

export class Lexer {
  private readonly source: string;
  private index = 0;
  private line: number;
  private column: number;

  /**
   * @param source text to tokenize
   * @param origin position the text starts at in the *original* file. Sub-lexing
   *   an interpolated expression passes its real position so every diagnostic
   *   inside `"total: {1 / 0}"` lands on the right line and column.
   */
  constructor(source: string, origin: Position = { line: 1, column: 1 }) {
    this.source = source;
    this.line = origin.line;
    this.column = origin.column;
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

  /**
   * Read a string literal, splitting it into parts at `{…}` interpolations.
   *
   * A string with no interpolation lexes to a plain `STRING`, so the common
   * case stays as cheap as it was. Otherwise a `TEMPLATE` token carries the
   * pieces, and each embedded expression keeps the absolute position it started
   * at so diagnostics inside it point at the right column.
   */
  private readString(position: Position): Token {
    const quote = this.advance();
    const parts: TemplatePart[] = [];
    let value = "";

    const flush = (): void => {
      if (value !== "") {
        parts.push({ kind: "text", value });
        value = "";
      }
    };

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

      if (ch === "{") {
        flush();
        parts.push(this.readInterpolation());
        continue;
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

    if (parts.length === 0) return this.token("STRING", value, position);

    flush();
    const token = this.token("TEMPLATE", "", position);
    token.parts = parts;
    return token;
  }

  /**
   * Consume a `{ … }` hole inside a string literal.
   *
   * The contents are captured as raw source rather than tokenized here: the
   * parser re-lexes them, which keeps interpolation from having to duplicate
   * the whole expression grammar. Braces, strings and comments are tracked only
   * closely enough to find the matching `}`.
   */
  private readInterpolation(): TemplatePart {
    const opened = this.position();
    this.advance(); // `{`

    const start = this.index;
    const startPosition = this.position();
    let depth = 1;

    for (;;) {
      const ch = this.peek();
      if (ch === "" || ch === "\n") {
        throw new SyntaxError_("unterminated interpolation: expected '}'", opened);
      }
      if (ch === '"' || ch === "'") {
        this.skipNestedString(ch);
        continue;
      }
      if (ch === "{") depth += 1;
      if (ch === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
      this.advance();
    }

    const source = this.source.slice(start, this.index);
    this.advance(); // `}`

    if (source.trim() === "") {
      throw new SyntaxError_("empty interpolation: expected an expression", opened);
    }
    return { kind: "expression", source, position: startPosition };
  }

  /** Skip over a string nested inside an interpolation, escapes included. */
  private skipNestedString(quote: string): void {
    this.advance(); // opening quote
    for (;;) {
      const ch = this.peek();
      if (ch === "" || ch === "\n") {
        throw new SyntaxError_("unterminated string literal", this.position());
      }
      this.advance();
      if (ch === "\\") {
        this.advance();
        continue;
      }
      if (ch === quote) return;
    }
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
        // A single `|` separates alternatives in a match pattern.
        return nextCh === "|" ? two("OR") : this.token("PIPE", ch, position);
      case "+":
        return nextCh === "=" ? two("PLUS_ASSIGN") : this.token("PLUS", ch, position);
      case "-":
        if (nextCh === "=") return two("MINUS_ASSIGN");
        if (nextCh === ">") return two("ARROW");
        return this.token("MINUS", ch, position);
      case "*":
        return nextCh === "=" ? two("STAR_ASSIGN") : this.token("STAR", ch, position);
      case "/":
        return nextCh === "=" ? two("SLASH_ASSIGN") : this.token("SLASH", ch, position);
      case "%":
        return nextCh === "=" ? two("PERCENT_ASSIGN") : this.token("PERCENT", ch, position);
      case ",":
        return this.token("COMMA", ch, position);
      case ";":
        return this.token("SEMICOLON", ch, position);
      case ":":
        return this.token("COLON", ch, position);
      case ".":
        if (nextCh === "." && this.peek(1) === ".") {
          this.advance();
          this.advance();
          return this.token("ELLIPSIS", "...", position);
        }
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
      // U+FEFF is the byte-order mark. Editors on Windows write one at the
      // start of a UTF-8 file, and refusing to lex those would be a papercut
      // with no upside.
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === BOM) {
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
export function tokenize(source: string, origin?: Position): Token[] {
  return new Lexer(source, origin).tokenize();
}
