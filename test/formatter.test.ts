import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { format } from "../src/formatter.ts";
import { parse } from "../src/parser.ts";
import { tokenize } from "../src/lexer.ts";
import type { Node } from "../src/ast.ts";

const EXAMPLES = fileURLToPath(new URL("../examples", import.meta.url));

function examplePrograms(): Array<[name: string, source: string]> {
  return readdirSync(EXAMPLES)
    .filter((name) => name.endsWith(".luma"))
    .map((name) => [name, readFileSync(join(EXAMPLES, name), "utf8")]);
}

/** The AST with every position stripped, so two layouts can be compared. */
function shape(source: string): unknown {
  return strip(parse(source));
}

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value === null || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === "position" || key === "end") continue;
    out[key] = strip(entry);
  }
  return out as unknown as Node;
}

function comments(source: string): string[] {
  // Comments are not tokens, so read them off a fresh lexer via the parser.
  const found: string[] = [];
  for (const line of source.split("\n")) {
    const index = line.indexOf("//");
    if (index !== -1 && !line.slice(0, index).includes('"')) {
      found.push(line.slice(index).trim());
    }
  }
  return found;
}

describe("formatter — properties over every example", () => {
  for (const [name, source] of examplePrograms()) {
    describe(name, () => {
      const formatted = format(source);

      it("is idempotent", () => {
        assert.equal(format(formatted), formatted, "formatting twice changed the output");
      });

      it("preserves meaning", () => {
        // The strongest check available without running the program: the AST
        // must be identical once positions are ignored.
        assert.deepEqual(shape(formatted), shape(source));
      });

      it("keeps every comment", () => {
        const before = comments(source);
        const after = comments(formatted);
        for (const comment of before) {
          assert.ok(after.includes(comment), `lost comment: ${comment}`);
        }
      });

      it("still lexes", () => {
        assert.doesNotThrow(() => tokenize(formatted));
      });

      it("ends with exactly one newline", () => {
        assert.match(formatted, /[^\n]\n$/);
      });
    });
  }
});

describe("formatter — layout", () => {
  const cases: Array<[input: string, expected: string]> = [
    ["let   a=1", "let a = 1;\n"],
    ["let a = 1 ;;", "let a = 1;\n"],
    ["print( 1,2 )", "print(1, 2);\n"],
    ["let a=[1,2 ,3]", "let a = [1, 2, 3];\n"],
    ['let h={"a":1}', 'let h = {"a": 1};\n'],
    ["let a = []", "let a = [];\n"],
    ["let f=fn(a,b){a+b}", "let f = fn(a, b) { a + b };\n"],
    ["fn f(){1}", "fn f() {\n  1\n}\n"],
    ["if(a){b}else{c}", "if (a) { b } else { c }\n"],
    ["while(a){b()}", "while (a) {\n  b();\n}\n"],
    ["for(x in y){z()}", "for (x in y) {\n  z();\n}\n"],
    ["a.b", "a.b;\n"],
    ['a["b"]', "a.b;\n"],
    ['a["not an ident"]', 'a["not an ident"];\n'],
    ["a[0]", "a[0];\n"],
    ["let a = 1 + 2*3", "let a = 1 + 2 * 3;\n"],
    ["let a = (1+2)*3", "let a = (1 + 2) * 3;\n"],
    ["let a = 1-(2-3)", "let a = 1 - (2 - 3);\n"],
    ["let a = 1-2-3", "let a = 1 - 2 - 3;\n"],
    ["let a = -x", "let a = -x;\n"],
    ["let a = !(b&&c)", "let a = !(b && c);\n"],
    ["let a=b+=1", "let a = b += 1;\n"],
    ["let s='hi'", 'let s = "hi";\n'],
    ["let s=\"a\\nb\"", 'let s = "a\\nb";\n'],
    ["let t=\"x{ 1+1 }y\"", 'let t = "x{1 + 1}y";\n'],
  ];

  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      assert.equal(format(input), expected);
    });
  }

  it("normalises indentation to two spaces", () => {
    assert.equal(format("fn f() {\n\t\t\tlet a = 1;\n}"), "fn f() {\n  let a = 1;\n}\n");
  });

  it("takes an indent width", () => {
    assert.equal(format("fn f() { let a = 1; }", { indent: 4 }), "fn f() {\n    let a = 1;\n}\n");
  });

  it("breaks a collection that does not fit", () => {
    const long = `let a = [${Array.from({ length: 20 }, (_, i) => `"item${i}"`).join(",")}]`;
    const formatted = format(long);
    assert.ok(formatted.includes("\n  \"item0\","), "expected one item per line");
    assert.match(formatted, /,\n\];\n$/, "expected a trailing comma");
  });

  it("keeps a short collection on one line", () => {
    assert.equal(format("let a = [1, 2, 3]"), "let a = [1, 2, 3];\n");
  });
});

describe("formatter — semicolons", () => {
  it("omits the semicolon on the expression that gives a block its value", () => {
    assert.equal(format("fn f() { 1 + 2; }"), "fn f() {\n  1 + 2\n}\n");
  });

  it("keeps it on an assignment, which is written for its effect", () => {
    assert.equal(format("fn f() { a = 1 }"), "fn f() {\n  a = 1;\n}\n");
  });

  it("omits it after a block-shaped expression", () => {
    // A single-statement block collapses onto one line, and takes no semicolon.
    assert.equal(format("if (a) { b() };"), "if (a) { b() }\n");
    assert.equal(format("if (a) { b(); c() };"), "if (a) {\n  b();\n  c()\n}\n");
  });

  it("keeps it on statements evaluated for effect", () => {
    assert.equal(format("print(1)\nprint(2)"), "print(1);\nprint(2);\n");
  });
});

describe("formatter — comments", () => {
  it("keeps an own-line comment above the statement it introduces", () => {
    assert.equal(format("// note\nlet a = 1;"), "// note\nlet a = 1;\n");
  });

  it("keeps a trailing comment on its line", () => {
    assert.equal(format("let a = 1; // note"), "let a = 1; // note\n");
  });

  it("keeps comments inside a block", () => {
    assert.equal(
      format("fn f() {\n// inside\nlet a = 1;\n}"),
      "fn f() {\n  // inside\n  let a = 1;\n}\n",
    );
  });

  it("keeps a comment that ends a block", () => {
    assert.match(format("fn f() {\nlet a = 1;\n// last\n}"), /\/\/ last\n}/);
  });

  it("preserves a blank line between comment blocks", () => {
    assert.equal(format("// one\n\n// two\nlet a = 1;"), "// one\n\n// two\nlet a = 1;\n");
  });

  it("keeps block comments", () => {
    assert.match(format("/* note */\nlet a = 1;"), /\/\* note \*\//);
  });
});

describe("formatter — blank lines", () => {
  it("preserves a single blank line between statements", () => {
    assert.equal(format("let a = 1;\n\nlet b = 2;"), "let a = 1;\n\nlet b = 2;\n");
  });

  it("collapses several blank lines into one", () => {
    assert.equal(format("let a = 1;\n\n\n\nlet b = 2;"), "let a = 1;\n\nlet b = 2;\n");
  });

  it("removes blank lines that were not there", () => {
    assert.equal(format("let a = 1;\nlet b = 2;"), "let a = 1;\nlet b = 2;\n");
  });

  it("puts the blank line above an introducing comment, not below it", () => {
    assert.equal(
      format("let a = 1;\n\n// about b\nlet b = 2;"),
      "let a = 1;\n\n// about b\nlet b = 2;\n",
    );
  });
});

describe("formatter — match", () => {
  it("puts one arm per line", () => {
    assert.equal(
      format('match (a) { 1 -> "one", _ -> "other" }'),
      'match (a) {\n  1 -> "one",\n  _ -> "other",\n}\n',
    );
  });

  it("prints every pattern form", () => {
    const source =
      'match (a) { 1|2 -> "x", [h,...t] -> h, {"k": v} -> v, n if n>1 -> n, _ -> nil }';
    assert.equal(
      format(source),
      'match (a) {\n' +
        '  1 | 2 -> "x",\n' +
        "  [h, ...t] -> h,\n" +
        '  {"k": v} -> v,\n' +
        "  n if n > 1 -> n,\n" +
        "  _ -> nil,\n" +
        "}\n",
    );
  });
});

describe("formatter — failures", () => {
  it("reports a syntax error instead of guessing", () => {
    assert.throws(() => format("let = 1;"), /expected a variable name/);
  });

  it("handles an empty program", () => {
    assert.equal(format(""), "");
    assert.equal(format("   \n\n  "), "");
  });

  it("keeps a file that is only a comment", () => {
    assert.equal(format("// just this\n"), "// just this\n");
  });
});
