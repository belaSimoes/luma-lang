/**
 * Token definitions for the Luma language.
 *
 * A string-union is used instead of a TypeScript `enum` so that the source
 * stays "erasable" and can be executed directly by Node's type stripping.
 */

export type TokenType =
  // Meta
  | "EOF"
  // Literals & identifiers
  | "IDENT"
  | "NUMBER"
  | "STRING"
  // Literals with structure
  | "TEMPLATE"
  // Operators
  | "ASSIGN"
  | "PLUS"
  | "MINUS"
  | "BANG"
  | "STAR"
  | "SLASH"
  | "PERCENT"
  // Compound assignment
  | "PLUS_ASSIGN"
  | "MINUS_ASSIGN"
  | "STAR_ASSIGN"
  | "SLASH_ASSIGN"
  | "PERCENT_ASSIGN"
  | "LT"
  | "GT"
  | "LTE"
  | "GTE"
  | "EQ"
  | "NOT_EQ"
  | "AND"
  | "OR"
  // Delimiters
  | "COMMA"
  | "SEMICOLON"
  | "COLON"
  | "DOT"
  | "ARROW"
  | "PIPE"
  | "ELLIPSIS"
  | "LPAREN"
  | "RPAREN"
  | "LBRACE"
  | "RBRACE"
  | "LBRACKET"
  | "RBRACKET"
  // Keywords
  | "FN"
  | "LET"
  | "TRUE"
  | "FALSE"
  | "IF"
  | "ELSE"
  | "RETURN"
  | "WHILE"
  | "FOR"
  | "IN"
  | "BREAK"
  | "CONTINUE"
  | "MATCH"
  | "NIL";

/**
 * One piece of an interpolated string.
 *
 * The lexer records embedded expressions as raw source plus the position they
 * started at, so the parser can re-lex them with absolute positions intact —
 * an error inside `"total: {1 / 0}"` points at the real column.
 */
export type TemplatePart =
  | { kind: "text"; value: string }
  | { kind: "expression"; source: string; position: Position };

/**
 * A comment, kept aside rather than discarded.
 *
 * The parser has no use for these, but a formatter that dropped them would be
 * unusable, so the lexer collects them with enough context to be placed back:
 * `ownLine` distinguishes a comment that sits above a statement from one
 * trailing it.
 */
export interface Comment {
  /** Source text including the `//` or `/* *​/` delimiters. */
  text: string;
  position: Position;
  end: Position;
  /** True when nothing but whitespace precedes it on its line. */
  ownLine: boolean;
}

export interface Position {
  /** 1-based line number. */
  line: number;
  /** 1-based column number. */
  column: number;
}

export interface Token {
  type: TokenType;
  /** Raw lexeme for identifiers/operators, decoded value for strings. */
  literal: string;
  /** Position of the token's first character. */
  position: Position;
  /**
   * Position just past the token's last character.
   *
   * `literal` cannot stand in for the source span — a string token carries its
   * *decoded* value, so `"a\nb"` is 6 characters of source but 3 of literal.
   * Tools that need to map a token back onto the text (syntax highlighting,
   * editor spans) need both ends.
   */
  end: Position;
  /** Present only on `TEMPLATE` tokens: the literal and expression pieces. */
  parts?: TemplatePart[];
}

export const KEYWORDS: Record<string, TokenType> = {
  fn: "FN",
  let: "LET",
  true: "TRUE",
  false: "FALSE",
  if: "IF",
  else: "ELSE",
  return: "RETURN",
  while: "WHILE",
  for: "FOR",
  in: "IN",
  break: "BREAK",
  continue: "CONTINUE",
  match: "MATCH",
  nil: "NIL",
};

/** Human readable name used in parser error messages. */
export function describeToken(token: Token): string {
  switch (token.type) {
    case "EOF":
      return "end of input";
    case "IDENT":
      return `identifier '${token.literal}'`;
    case "NUMBER":
      return `number '${token.literal}'`;
    case "STRING":
      return `string`;
    default:
      return `'${token.literal}'`;
  }
}
