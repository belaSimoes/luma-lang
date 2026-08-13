import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { tokenize } from "../src/lexer.ts";
import { LumaError } from "../src/errors.ts";
import type { TokenType } from "../src/token.ts";

function types(source: string): TokenType[] {
  return tokenize(source).map((token) => token.type);
}

describe("lexer", () => {
  it("always terminates with EOF", () => {
    assert.deepEqual(types(""), ["EOF"]);
    assert.deepEqual(types("   \n\t "), ["EOF"]);
  });

  it("tokenizes the full operator set", () => {
    assert.deepEqual(types("= + - ! * / % < > <= >= == != && ||"), [
      "ASSIGN", "PLUS", "MINUS", "BANG", "STAR", "SLASH", "PERCENT",
      "LT", "GT", "LTE", "GTE", "EQ", "NOT_EQ", "AND", "OR", "EOF",
    ]);
  });

  it("recognises every keyword", () => {
    assert.deepEqual(types("fn let true false if else return while for in break continue nil"), [
      "FN", "LET", "TRUE", "FALSE", "IF", "ELSE", "RETURN",
      "WHILE", "FOR", "IN", "BREAK", "CONTINUE", "NIL", "EOF",
    ]);
  });

  it("does not mistake identifiers for keywords", () => {
    assert.deepEqual(types("iffy format returned _x1"), [
      "IDENT", "IDENT", "IDENT", "IDENT", "EOF",
    ]);
  });

  it("reads integers, floats, exponents and digit separators", () => {
    const literals = tokenize("42 3.14 1e3 2.5e-2 1_000_000").map((t) => t.literal);
    assert.deepEqual(literals.slice(0, 5), ["42", "3.14", "1e3", "2.5e-2", "1000000"]);
  });

  it("does not swallow a dot that is not part of a number", () => {
    assert.deepEqual(types("1.max"), ["NUMBER", "DOT", "IDENT", "EOF"]);
  });

  it("decodes string escapes and supports both quote styles", () => {
    const [token] = tokenize(String.raw`"a\tb\nc\"d\\e"`);
    assert.equal(token!.literal, 'a\tb\nc"d\\e');
    assert.equal(tokenize("'single'")[0]!.literal, "single");
  });

  it("skips line and block comments", () => {
    assert.deepEqual(types("1 // trailing\n/* block\n comment */ 2"), [
      "NUMBER", "NUMBER", "EOF",
    ]);
  });

  it("records the source span of every token", () => {
    // `end` cannot be derived from `literal`: a string token holds its *decoded*
    // value, so the span is the only way back to the original text.
    const [ident, text] = tokenize(String.raw`abc "a\nb"`);
    assert.deepEqual(ident!.position, { line: 1, column: 1 });
    assert.deepEqual(ident!.end, { line: 1, column: 4 });
    assert.equal(text!.literal, "a\nb");
    assert.deepEqual(text!.position, { line: 1, column: 5 });
    assert.deepEqual(text!.end, { line: 1, column: 11 });
  });

  it("gives spans that reconstruct the source exactly", () => {
    const source = 'let x = "hi"; // note\nprint(x)';
    const lineStarts = [0, source.indexOf("\n") + 1];
    const offset = (p: { line: number; column: number }) => lineStarts[p.line - 1]! + p.column - 1;

    for (const token of tokenize(source)) {
      if (token.type === "EOF") continue;
      const slice = source.slice(offset(token.position), offset(token.end));
      assert.ok(slice.length > 0, `empty span for ${token.type}`);
      if (token.type !== "STRING") assert.equal(slice, token.literal);
    }
  });

  it("tracks line and column for every token", () => {
    const tokens = tokenize("let x =\n  42;");
    assert.deepEqual(tokens[0]!.position, { line: 1, column: 1 });
    assert.deepEqual(tokens[1]!.position, { line: 1, column: 5 });
    assert.deepEqual(tokens[3]!.position, { line: 2, column: 3 });
  });

  it("reports unterminated strings and comments", () => {
    assert.throws(() => tokenize('"open'), LumaError);
    assert.throws(() => tokenize('"line\nbreak"'), LumaError);
    assert.throws(() => tokenize("/* never closed"), LumaError);
  });

  it("rejects unknown characters and escapes", () => {
    assert.throws(() => tokenize("@"), /unexpected character/);
    assert.throws(() => tokenize(String.raw`"\q"`), /unknown escape/);
  });

  it("reports a single '&' rather than silently accepting it", () => {
    assert.throws(() => tokenize("a & b"), /unexpected character/);
  });
});
