/**
 * Runs every program in `examples/` and prints its output.
 *
 *   node scripts/run-examples.ts            # run and compare against snapshots
 *   node scripts/run-examples.ts --update   # refresh the .expected snapshots
 *
 * The snapshots are what `test/examples.test.ts` asserts against, so the
 * examples quoted in the README can never silently drift away from reality.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { run } from "../src/index.ts";

export const EXAMPLES_DIR = fileURLToPath(new URL("../examples", import.meta.url));

const ESC = String.fromCharCode(27);
const BOLD = `${ESC}[1m`;
const RED = `${ESC}[31m`;
const RESET = `${ESC}[0m`;

export function exampleFiles(): string[] {
  return readdirSync(EXAMPLES_DIR)
    .filter((name) => name.endsWith(".luma"))
    .sort();
}

export function snapshotPath(name: string): string {
  return join(EXAMPLES_DIR, `${name.replace(/\.luma$/, "")}.expected`);
}

/**
 * Run one example and return everything it produced. A failing example keeps
 * its output *and* its diagnostic, so `examples/errors.luma` can demonstrate
 * what a Luma error actually looks like.
 */
export function runExample(name: string): string {
  const source = readFileSync(join(EXAMPLES_DIR, name), "utf8");
  const result = run(source, { file: name });
  const parts = [...result.output];
  if (!result.ok) parts.push(result.error!);
  return parts.join("\n");
}

export function readSnapshot(name: string): string | null {
  try {
    return readFileSync(snapshotPath(name), "utf8").replace(/\n$/, "");
  } catch {
    return null;
  }
}

function main(): number {
  const update = process.argv.includes("--update");
  const color = process.stdout.isTTY === true;
  const paint = (code: string, text: string) => (color ? `${code}${text}${RESET}` : text);
  let failures = 0;

  for (const name of exampleFiles()) {
    const actual = runExample(name);

    if (update) {
      writeFileSync(snapshotPath(name), `${actual}\n`, "utf8");
      process.stdout.write(`updated  ${name}\n`);
      continue;
    }

    const rule = "─".repeat(Math.max(3, 56 - name.length));
    process.stdout.write(`\n${paint(BOLD, `── ${name} ${rule}`)}\n${actual}\n`);

    const expected = readSnapshot(name);
    if (expected !== null && expected !== actual) {
      process.stderr.write(`${paint(RED, "!! output differs from the snapshot")}\n`);
      failures += 1;
    }
  }

  if (!update) {
    process.stdout.write(
      failures === 0
        ? "\nall examples match their snapshots\n"
        : `\n${failures} example(s) drifted from their snapshots\n`,
    );
  }
  return failures === 0 ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  process.exitCode = main();
}
