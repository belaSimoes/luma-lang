import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { DIAGNOSTIC_CODES, allCodes, explainCode } from "../src/codes.ts";
import { renderErrorDocs, readErrorDocs } from "../scripts/generate-error-docs.ts";
import { check, run } from "../src/index.ts";
import { Interpreter } from "../src/interpreter.ts";
import { toDiagnostics, type LumaError } from "../src/errors.ts";

function diagnosticsOf(source: string): LumaError[] {
  try {
    new Interpreter({ stdout: () => {} }).run(source);
    return [];
  } catch (error) {
    const diagnostics = toDiagnostics(error);
    if (diagnostics === null) throw error;
    return diagnostics;
  }
}

function codeOf(source: string): string | null {
  return diagnosticsOf(source)[0]?.code ?? null;
}

describe("diagnostic codes — the registry", () => {
  it("is not empty and every entry is complete", () => {
    const codes = allCodes();
    assert.ok(codes.length >= 15);

    for (const code of codes) {
      const entry = DIAGNOSTIC_CODES[code];
      assert.match(code, /^[EW]\d{4}$/, `${code} is not a well-formed code`);
      assert.ok(entry.title.length > 0, `${code} has no title`);
      assert.ok(entry.explanation.length > 60, `${code} needs a real explanation`);
      assert.doesNotMatch(entry.title, /^[A-Z]/, `${code}'s title should not be capitalised`);
    }
  });

  it("uses E for errors and W for warnings", () => {
    for (const code of allCodes()) {
      const isWarning = code.startsWith("W");
      assert.equal(
        isWarning,
        code.startsWith("W09"),
        `${code}: warnings live in the 09xx range`,
      );
    }
  });

  it("looks a code up case-insensitively, and rejects unknown ones", () => {
    assert.equal(explainCode("e0301")?.title, "undefined variable");
    assert.equal(explainCode("  E0301 ")?.title, "undefined variable");
    assert.equal(explainCode("E9999"), null);
    assert.equal(explainCode("nonsense"), null);
  });
});

describe("diagnostic codes — what the toolchain emits", () => {
  const expectations: Array<[code: string, source: string]> = [
    ["E0101", "let a = @;"],
    ["E0102", 'let a = "open'],
    ["E0103", String.raw`let a = "\q";`],
    ["E0201", "let = 1;"],
    ["E0202", "1 = 2;"],
    ["E0203", "match (1) { [a, ...r, b] -> 1 }"],
    ["E0301", "print(missing);"],
    ["E0302", "nope = 1;"],
    ["E0401", "break;"],
    ["E0402", "return 1;"],
    ["E0501", "1 + [1];"],
    ["E0502", "let a = 1; a();"],
    ["E0503", "fn f(a) { a } f();"],
    ["E0504", "nil[0];"],
    ["E0602", 'match (9) { 1 -> "a" }'],
  ];

  for (const [code, source] of expectations) {
    it(`${JSON.stringify(source)} reports ${code}`, () => {
      assert.equal(codeOf(source), code);
    });
  }

  it("reports E0601 when a resource limit is hit", () => {
    const interpreter = new Interpreter({ maxCallDepth: 32, stdout: () => {} });
    try {
      interpreter.run("fn loop(n) { loop(n + 1) } loop(0);");
      assert.fail("expected the depth limit to trigger");
    } catch (error) {
      assert.equal(toDiagnostics(error)?.[0]?.code, "E0601");
    }
  });

  it("reports W0901 for unreachable code", () => {
    const interpreter = new Interpreter({ stdout: () => {} });
    interpreter.run("fn f() { return 1; print(2); } f();");
    assert.equal(interpreter.warnings[0]?.code, "W0901");
  });

  it("puts the code in the rendered headline", () => {
    assert.match(run("print(missing);").error!, /^error\[E0301]:/);
  });

  it("every emitted code exists in the registry", () => {
    for (const [, source] of expectations) {
      const code = codeOf(source);
      assert.ok(code !== null && explainCode(code) !== null, `${code} is not registered`);
    }
  });
});

describe("diagnostic codes — JSON output", () => {
  it("emits one machine-readable object per diagnostic", () => {
    const result = check("print(one);\nprint(two);", { file: "x.luma", format: "json" });
    const lines = result.report!.split("\n").map((line) => JSON.parse(line));

    assert.equal(lines.length, 2);
    assert.deepEqual(lines[0], {
      file: "x.luma",
      severity: "error",
      phase: "semantic",
      code: "E0301",
      message: "undefined variable 'one'",
      line: 1,
      column: 7,
      span: 3,
      hint: null,
      frames: [],
    });
  });

  it("includes the hint and the call stack when there are any", () => {
    const result = check("let height = 1; print(hieght);", { format: "json" });
    const [parsed] = result.report!.split("\n").map((line) => JSON.parse(line));
    assert.equal(parsed.hint, "did you mean 'height'?");
  });
});

describe("docs/ERRORS.md", () => {
  it("is committed and matches the registry", () => {
    const committed = readErrorDocs();
    assert.ok(committed !== null, "docs/ERRORS.md is missing");
    assert.equal(
      committed,
      renderErrorDocs(),
      "docs/ERRORS.md is stale — run `node scripts/generate-error-docs.ts --write`",
    );
  });

  it("documents every code exactly once", () => {
    const rendered = renderErrorDocs();
    for (const code of allCodes()) {
      const occurrences = rendered.split(`### ${code}`).length - 1;
      assert.equal(occurrences, 1, `${code} appears ${occurrences} times`);
    }
  });
});

describe("source hygiene", () => {
  const SRC = fileURLToPath(new URL("../src", import.meta.url));

  it("has no leftover debugging statements", () => {
    // `console.log` is legitimate in exactly two places — the interpreter's
    // default output sink and the REPL, which is a console program. Anywhere
    // else it is a leftover.
    const allowed = new Set(["interpreter.ts", "repl.ts"]);

    for (const name of readdirSync(SRC).filter((file) => file.endsWith(".ts"))) {
      const source = readFileSync(join(SRC, name), "utf8");

      assert.doesNotMatch(source, /console\.(debug|dir|trace)\(/, `${name} has debug logging`);
      if (!allowed.has(name)) {
        assert.doesNotMatch(source, /console\.\w+\(/, `${name} writes to the console`);
      }
      assert.doesNotMatch(source, /\bTODO\b|\bFIXME\b|\bXXX\b/, `${name} has an unfinished marker`);
    }
  });

  it("uses no raw control characters in source", () => {
    // Escape sequences must be written as escapes: a literal ESC byte in a file
    // is invisible in review and has bitten this project before. The pattern is
    // built from char codes so this test does not contain one itself.
    const ch = (code: number): string => String.fromCharCode(code);
    const control = new RegExp(
      `[${ch(0)}-${ch(8)}${ch(11)}-${ch(12)}${ch(14)}-${ch(31)}${ch(0xfeff)}]`,
    );

    for (const name of readdirSync(SRC).filter((file) => file.endsWith(".ts"))) {
      const source = readFileSync(join(SRC, name), "utf8");
      assert.doesNotMatch(source, control, `${name} contains a raw control character`);
    }
  });
});
