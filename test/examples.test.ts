import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { exampleFiles, readSnapshot, runExample } from "../scripts/run-examples.ts";

/**
 * Every program in `examples/` is executed and compared against its committed
 * `.expected` snapshot. This is the suite's end-to-end layer: it exercises the
 * lexer, parser, evaluator, builtins and diagnostics through real programs, and
 * guarantees the documentation never drifts from the implementation.
 *
 * Regenerate the snapshots with `node scripts/run-examples.ts --update`.
 */
describe("examples", () => {
  const files = exampleFiles();

  it("finds the example programs", () => {
    assert.ok(files.length >= 8, `expected at least 8 examples, found ${files.length}`);
  });

  for (const name of files) {
    it(`${name} matches its snapshot`, () => {
      const expected = readSnapshot(name);
      assert.ok(expected !== null, `missing snapshot for ${name} — run with --update`);
      assert.equal(runExample(name), expected);
    });
  }
});
