/**
 * Syntax highlighting, driven by Luma's own lexer.
 *
 * Reusing the real lexer means the highlighter can never disagree with the
 * parser about what a token is — no second, approximate grammar to keep in
 * sync. Anything sitting *between* two tokens is whitespace or a comment, which
 * is the only thing the lexer discards, so gaps are classified by inspection.
 *
 * The output is a flat list of segments that concatenate back into the exact
 * input, which makes it trivial to render as HTML, ANSI, or anything else.
 */

import { tokenize } from "./lexer.ts";
import type { Position, Token, TokenType } from "./token.ts";

export type TokenKind =
  | "keyword"
  | "number"
  | "string"
  | "comment"
  | "builtin"
  | "identifier"
  | "operator"
  | "punctuation"
  | "whitespace"
  | "unknown";

export interface Segment {
  text: string;
  kind: TokenKind;
}

const KEYWORDS = new Set<TokenType>([
  "FN", "LET", "TRUE", "FALSE", "IF", "ELSE", "RETURN",
  "WHILE", "FOR", "IN", "BREAK", "CONTINUE", "NIL",
]);

const OPERATORS = new Set<TokenType>([
  "ASSIGN", "PLUS", "MINUS", "BANG", "STAR", "SLASH", "PERCENT",
  "LT", "GT", "LTE", "GTE", "EQ", "NOT_EQ", "AND", "OR",
]);

export interface HighlightOptions {
  /** Names to mark as `builtin` rather than plain identifiers. */
  builtins?: Iterable<string>;
}

function kindOf(token: Token, builtins: Set<string>): TokenKind {
  if (KEYWORDS.has(token.type)) return "keyword";
  if (OPERATORS.has(token.type)) return "operator";
  switch (token.type) {
    case "NUMBER":
      return "number";
    case "STRING":
      return "string";
    case "IDENT":
      return builtins.has(token.literal) ? "builtin" : "identifier";
    default:
      return "punctuation";
  }
}

/** Byte offset of the start of each line, turning positions into indices. */
function lineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

/**
 * Split source into classified segments.
 *
 * Never throws. Source that does not lex — an unclosed string mid-edit, say —
 * yields a single `unknown` segment so an editor can keep rendering.
 */
export function highlight(source: string, options: HighlightOptions = {}): Segment[] {
  const builtins = new Set(options.builtins ?? []);

  let tokens: Token[];
  try {
    tokens = tokenize(source);
  } catch {
    return source === "" ? [] : [{ text: source, kind: "unknown" }];
  }

  const starts = lineStarts(source);
  const offset = (position: Position): number =>
    (starts[position.line - 1] ?? 0) + position.column - 1;

  const segments: Segment[] = [];
  const push = (text: string, kind: TokenKind): void => {
    if (text === "") return;
    const last = segments.at(-1);
    if (last?.kind === kind) last.text += text;
    else segments.push({ text, kind });
  };

  let cursor = 0;
  for (const token of tokens) {
    if (token.type === "EOF") break;

    const from = offset(token.position);
    if (from > cursor) {
      // Only whitespace and comments survive between two tokens.
      const gap = source.slice(cursor, from);
      push(gap, gap.trim() === "" ? "whitespace" : "comment");
    }

    const to = offset(token.end);
    push(source.slice(from, to), kindOf(token, builtins));
    cursor = Math.max(cursor, to);
  }

  push(source.slice(cursor), source.slice(cursor).trim() === "" ? "whitespace" : "comment");
  return segments;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (character) => HTML_ESCAPES[character]!);
}

/**
 * Render highlighted source as HTML, one `<span class="tok-…">` per segment.
 * Whitespace is emitted bare so the markup stays small.
 */
export function highlightHtml(source: string, options: HighlightOptions = {}): string {
  return highlight(source, options)
    .map(({ text, kind }) =>
      kind === "whitespace" || kind === "unknown"
        ? escapeHtml(text)
        : `<span class="tok-${kind}">${escapeHtml(text)}</span>`,
    )
    .join("");
}
