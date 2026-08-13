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
  // Operators
  | "ASSIGN"
  | "PLUS"
  | "MINUS"
  | "BANG"
  | "STAR"
  | "SLASH"
  | "PERCENT"
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
  | "NIL";

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
  position: Position;
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
