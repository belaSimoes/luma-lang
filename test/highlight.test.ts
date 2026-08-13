import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { escapeHtml, highlight, highlightHtml, type TokenKind } from "../src/highlight.ts";
import { builtinNames } from "../src/index.ts";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BUILTINS = builtinNames();

function kinds(source: string): TokenKind[] {
  return highlight(source, { builtins: BUILTINS })
    .filter((segment) => segment.kind !== "whitespace")
    .map((segment) => segment.kind);
}

function text(source: string): string {
  return highlight(source).map((segment) => segment.text).join("");
}

describe("highlight — losslessness", () => {
  const samples = [
    "",
    "   ",
    "let a = 1;",
    "// only a comment\n",
    "/* block */ let a = 1; // trailing\n\n",
    'let s = "a\\nb\\tc";',
    "fn f(a, b) {\n  a + b\n}\n",
    "let h = {\"k\": [1, 2.5, 1e3]};",
    "a.b[0](1) // call\n",
  ];

  for (const sample of samples) {
    it(`reproduces ${JSON.stringify(sample)} exactly`, () => {
      assert.equal(text(sample), sample);
    });
  }

  it("reproduces every example program byte for byte", () => {
    // The strongest form of the property: real programs, not toy snippets.
    const dir = fileURLToPath(new URL("../examples", import.meta.url));
    const files = readdirSync(dir).filter((name) => name.endsWith(".luma"));
    assert.ok(files.length > 0);

    for (const name of files) {
      const source = readFileSync(join(dir, name), "utf8");
      assert.equal(text(source), source, `${name} did not round-trip`);
    }
  });

  it("survives source that does not lex, without losing any of it", () => {
    const broken = 'let a = "unterminated';
    assert.equal(text(broken), broken);
    assert.deepEqual(highlight(broken), [{ text: broken, kind: "unknown" }]);
  });
});

describe("highlight — classification", () => {
  it("separates keywords, identifiers and builtins", () => {
    assert.deepEqual(kinds("let x = len"), ["keyword", "identifier", "operator", "builtin"]);
  });

  it("classifies literals", () => {
    assert.deepEqual(kinds('1 2.5 "s" true nil'), [
      "number",
      "number",
      "string",
      "keyword",
      "keyword",
    ]);
  });

  it("classifies comments, including block comments", () => {
    assert.deepEqual(kinds("// line\n1"), ["comment", "number"]);
    assert.deepEqual(kinds("/* block */ 1"), ["comment", "number"]);
    assert.deepEqual(kinds("1 // trailing"), ["number", "comment"]);
  });

  it("keeps the whole string literal together, escapes and all", () => {
    const [segment] = highlight('"a\\nb"');
    assert.deepEqual(segment, { text: '"a\\nb"', kind: "string" });
  });

  it("separates operators from punctuation", () => {
    // Adjacent segments of the same kind are merged — `);` is one run — which
    // keeps the rendered markup small.
    assert.deepEqual(kinds("f(a + b);"), [
      "identifier",
      "punctuation",
      "identifier",
      "operator",
      "identifier",
      "punctuation",
    ]);
    assert.deepEqual(
      highlight("f(a + b);").filter((s) => s.kind === "punctuation").map((s) => s.text),
      ["(", ");"],
    );
  });

  it("only marks a name as a builtin when it really is one", () => {
    assert.deepEqual(kinds("len"), ["builtin"]);
    assert.deepEqual(kinds("lenght"), ["identifier"]);
    assert.deepEqual(
      highlight("len").map((segment) => segment.kind),
      ["identifier"],
      "without a builtin list, everything is a plain identifier",
    );
  });
});

describe("highlight — HTML rendering", () => {
  it("escapes markup so source can never inject into the page", () => {
    assert.equal(escapeHtml('<script>&"'), "&lt;script&gt;&amp;&quot;");
    const html = highlightHtml('let a = "<img onerror=x>";', { builtins: BUILTINS });
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img/);
  });

  it("wraps tokens in classed spans and leaves whitespace bare", () => {
    assert.equal(
      highlightHtml("let a"),
      '<span class="tok-keyword">let</span> <span class="tok-identifier">a</span>',
    );
  });

  it("produces text that still round-trips once the tags are stripped", () => {
    const source = 'fn f(n) { // double\n  n * 2\n}';
    const stripped = highlightHtml(source, { builtins: BUILTINS })
      .replace(/<[^>]+>/g, "")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&amp;", "&");
    assert.equal(stripped, source);
  });
});
