/**
 * Benchmark harness.
 *
 *   node bench/run.ts                 # run every benchmark
 *   node bench/run.ts fib loop        # run a subset
 *   node bench/run.ts --markdown      # emit the table used in the README
 *   node bench/run.ts --json          # emit machine-readable results
 *
 * Each program is parsed once per iteration together with its evaluation, so
 * the numbers describe the end-to-end cost of running a Luma program — which is
 * what a user actually experiences. Timing uses the best of N runs after a
 * warm-up, which is far more stable than a mean under a JIT.
 */

import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { performance } from "node:perf_hooks";

import { Interpreter } from "../src/interpreter.ts";
import { inspect, type LumaValue } from "../src/values.ts";

const BENCH_DIR = fileURLToPath(new URL(".", import.meta.url));
const WARMUP = 2;
const RUNS = 7;

interface Result {
  name: string;
  best: number;
  median: number;
  result: LumaValue;
}

function programs(filter: string[]): Array<{ name: string; source: string }> {
  return readdirSync(BENCH_DIR)
    .filter((file) => file.endsWith(".luma"))
    .map((file) => ({ name: basename(file, ".luma"), source: readFileSync(join(BENCH_DIR, file), "utf8") }))
    .filter(({ name }) => filter.length === 0 || filter.includes(name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function measure(source: string): Omit<Result, "name"> {
  let result: LumaValue = null;

  const once = (): number => {
    // A fresh interpreter each time: no state leaks between iterations.
    const interpreter = new Interpreter({ stdout: () => {} });
    const started = performance.now();
    result = interpreter.run(source);
    return performance.now() - started;
  };

  for (let i = 0; i < WARMUP; i++) once();

  const samples: number[] = [];
  for (let i = 0; i < RUNS; i++) samples.push(once());
  samples.sort((a, b) => a - b);

  return { best: samples[0]!, median: samples[Math.floor(samples.length / 2)]!, result };
}

function main(): number {
  const args = process.argv.slice(2);
  const markdown = args.includes("--markdown");
  const json = args.includes("--json");
  const filter = args.filter((arg) => !arg.startsWith("--"));

  const selected = programs(filter);
  if (selected.length === 0) {
    process.stderr.write(`no benchmarks matched ${JSON.stringify(filter)}\n`);
    return 1;
  }

  const results: Result[] = [];
  for (const { name, source } of selected) {
    if (!markdown && !json) process.stderr.write(`running ${name}…\r`);
    const { best, median, result } = measure(source);
    results.push({ name, best, median, result });
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(results.map(({ name, best, median }) => ({ name, best, median })), null, 2)}\n`);
    return 0;
  }

  if (markdown) {
    process.stdout.write("| Benchmark | Best | Median |\n| --- | ---: | ---: |\n");
    for (const { name, best, median } of results) {
      process.stdout.write(`| \`${name}\` | ${best.toFixed(1)} ms | ${median.toFixed(1)} ms |\n`);
    }
    return 0;
  }

  const width = Math.max(...results.map((r) => r.name.length));
  process.stdout.write(
    `${"benchmark".padEnd(width)}   ${"best".padStart(9)}   ${"median".padStart(9)}   result\n`,
  );
  for (const { name, best, median, result } of results) {
    const rendered = inspect(result);
    const short = rendered.length > 28 ? `${rendered.slice(0, 27)}…` : rendered;
    process.stdout.write(
      `${name.padEnd(width)}   ${`${best.toFixed(1)} ms`.padStart(9)}   ` +
        `${`${median.toFixed(1)} ms`.padStart(9)}   ${short}\n`,
    );
  }
  process.stdout.write(`\nbest of ${RUNS} runs, after ${WARMUP} warm-up runs\n`);
  return 0;
}

process.exitCode = main();
