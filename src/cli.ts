#!/usr/bin/env node
/**
 * Command line entry point.
 *
 *   luma                     start the REPL
 *   luma script.luma         run a file
 *   luma -e "print(1 + 1)"   run a snippet
 *   luma check script.luma   analyse without running it
 *   luma fmt script.luma     rewrite it in the canonical style
 *   luma trace script.luma   run it and print the execution timeline
 *   luma explain E0301       describe a diagnostic code
 */

import { globSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import process from "node:process";

import { Interpreter } from "./interpreter.ts";
import { formatErrors, toDiagnostics } from "./errors.ts";
import { parse } from "./parser.ts";
import { tokenize } from "./lexer.ts";
import { startRepl } from "./repl.ts";
import { inspect } from "./values.ts";
import { check, trace } from "./index.ts";
import { format } from "./formatter.ts";
import { DIAGNOSTIC_CODES, allCodes, explainCode } from "./codes.ts";

const VERSION = "1.3.0";

const ESC = String.fromCharCode(27);
const DIM = process.stdout.isTTY === true ? `${ESC}[2m` : "";
const RESET_ANSI = process.stdout.isTTY === true ? `${ESC}[0m` : "";

const USAGE = `luma ${VERSION} — the Luma programming language

Usage:
  luma                       start the interactive REPL
  luma <file.luma>           run a program
  luma -e, --eval <code>     run a snippet
  luma check <file.luma>     report problems without running the program
  luma check --json <file>   the same, as one JSON object per line
  luma explain <CODE>        describe a diagnostic code, e.g. E0301
  luma fmt <file.luma>...    rewrite files in the canonical style
  luma fmt --check <file>... list files that are not formatted, and exit 1
  luma trace <file.luma>     run and print the execution timeline
  luma ast <file.luma>       print the syntax tree as JSON
  luma tokens <file.luma>    print the token stream
  luma -h, --help            show this message
  luma -v, --version         print the version
`;

function main(argv: string[]): number {
  const args = argv.slice(2);

  if (args.length === 0) {
    startRepl();
    return 0;
  }

  const [first, ...rest] = args;

  switch (first) {
    case "-h":
    case "--help":
      process.stdout.write(USAGE);
      return 0;

    case "-v":
    case "--version":
      process.stdout.write(`${VERSION}\n`);
      return 0;

    case "-e":
    case "--eval": {
      const code = rest.join(" ");
      if (code.trim() === "") {
        process.stderr.write("error: -e requires a snippet of code\n");
        return 2;
      }
      return execute(code, "<eval>", { echo: true });
    }

    case "explain": {
      const code = rest[0];
      if (code === undefined) {
        process.stderr.write(
          `error: 'explain' requires a code, e.g. 'luma explain E0301'\n\n` +
            `known codes:\n${allCodes()
              .map((known) => `  ${known}  ${DIAGNOSTIC_CODES[known].title}`)
              .join("\n")}\n`,
        );
        return 2;
      }

      const entry = explainCode(code);
      if (entry === null) {
        process.stderr.write(`error: unknown diagnostic code '${code}'\n`);
        return 2;
      }
      process.stdout.write(`${code.toUpperCase()}: ${entry.title}\n\n${entry.explanation}\n`);
      return 0;
    }

    case "fmt": {
      const patterns = rest.filter((argument) => !argument.startsWith("-"));
      const check_ = rest.includes("--check");
      if (patterns.length === 0) {
        process.stderr.write("error: 'fmt' requires at least one file\n");
        return 2;
      }

      const files = expandGlobs(patterns);
      if (files.length === 0) {
        process.stderr.write(`error: no files matched ${patterns.join(", ")}\n`);
        return 66;
      }

      let changed = 0;
      for (const file of files) {
        const source = read(file);
        if (source === null) return 66;

        let formatted: string;
        try {
          formatted = format(source);
        } catch (error) {
          return reportError(error, source, basename(file));
        }

        if (formatted === source) continue;
        changed += 1;

        if (check_) {
          process.stdout.write(`${file}\n`);
        } else {
          writeFileSync(file, formatted, "utf8");
          process.stderr.write(`formatted ${file}\n`);
        }
      }

      if (check_ && changed > 0) {
        const suffix = changed === 1 ? " needs" : "s need";
        process.stderr.write(`${changed} file${suffix} formatting\n`);
        return 1;
      }
      return 0;
    }

    case "trace": {
      const file = rest[0];
      if (file === undefined) {
        process.stderr.write("error: 'trace' requires a file\n");
        return 2;
      }
      const source = read(file);
      if (source === null) return 66;
      return printTrace(source, basename(file));
    }

    case "check": {
      const file = rest.find((argument) => !argument.startsWith("-"));
      if (file === undefined) {
        process.stderr.write("error: 'check' requires a file\n");
        return 2;
      }
      const source = read(file);
      if (source === null) return 66;

      const asJson = rest.includes("--json");
      const result = check(source, { file: basename(file), format: asJson ? "json" : "text" });
      if (result.report !== null) {
        process.stderr.write(`${result.report}\n`);
      }
      if (asJson) return result.ok ? 0 : 1;
      if (result.ok) {
        const suffix = result.warningCount === 1 ? "" : "s";
        process.stdout.write(
          result.warningCount === 0
            ? `${basename(file)}: no problems found\n`
            : `${basename(file)}: ${result.warningCount} warning${suffix}, no errors\n`,
        );
      }
      return result.ok ? 0 : 1;
    }

    case "ast":
    case "tokens": {
      const file = rest[0];
      if (file === undefined) {
        process.stderr.write(`error: '${first}' requires a file\n`);
        return 2;
      }
      const source = read(file);
      if (source === null) return 66;
      try {
        const dump = first === "ast" ? parse(source) : tokenize(source);
        process.stdout.write(`${JSON.stringify(dump, null, 2)}\n`);
        return 0;
      } catch (error) {
        return reportError(error, source, basename(file));
      }
    }

    default: {
      if (first!.startsWith("-")) {
        process.stderr.write(`error: unknown option '${first}'\n\n${USAGE}`);
        return 2;
      }
      const source = read(first!);
      if (source === null) return 66;
      return execute(source, basename(first!), { echo: false });
    }
  }
}

/**
 * Expand glob patterns ourselves.
 *
 * npm runs scripts through cmd.exe on Windows, which does not expand globs, so
 * `luma fmt examples/*.luma` would otherwise work on one platform and not the
 * other. Doing it here makes the command behave the same everywhere.
 */
function expandGlobs(patterns: string[]): string[] {
  const files = new Set<string>();
  for (const pattern of patterns) {
    if (!pattern.includes("*")) {
      files.add(pattern);
      continue;
    }
    for (const match of globSync(pattern)) files.add(match);
  }
  return [...files].sort();
}

function read(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    process.stderr.write(`error: cannot read '${file}'\n`);
    return null;
  }
}

function execute(source: string, file: string, options: { echo: boolean }): number {
  const interpreter = new Interpreter();
  try {
    const value = interpreter.run(source);
    if (options.echo && value !== null) process.stdout.write(`${inspect(value)}\n`);
    return 0;
  } catch (error) {
    return reportError(error, source, file);
  } finally {
    if (interpreter.warnings.length > 0) {
      process.stderr.write(`${render(interpreter.warnings, source, file)}\n`);
    }
  }
}

/**
 * Print a recorded execution timeline: one line per step, indented by call
 * depth, with the variables that changed since the previous step.
 */
function printTrace(source: string, file: string): number {
  const result = trace(source, { file, stdout: () => {} });

  let previous = new Map<string, string>();
  for (const step of result.steps) {
    const flat = new Map(step.scopes.flatMap((scope) => scope.variables));
    const changed = [...flat]
      .filter(([name, value]) => previous.get(name) !== value)
      .map(([name, value]) => `${name} = ${value}`);
    previous = flat;

    const marker = step.kind === "call" ? "→" : step.kind === "return" ? "←" : " ";
    const indent = "  ".repeat(step.stack.length);
    const where = `${String(step.line).padStart(4)}`;

    process.stdout.write(
      `${where} ${marker} ${indent}${step.label}` +
        (changed.length > 0 ? `   ${DIM}[${changed.join(", ")}]${RESET_ANSI}` : "") +
        "\n",
    );
  }

  if (result.truncated) {
    process.stdout.write("… recording stopped at the step limit\n");
  }
  for (const line of result.output) {
    process.stdout.write(`stdout: ${line}\n`);
  }
  if (!result.ok) {
    process.stderr.write(`${result.error}\n`);
    return 1;
  }
  return 0;
}

function render(
  diagnostics: Parameters<typeof formatErrors>[0],
  source: string,
  file: string,
): string {
  const color = process.stderr.isTTY === true && process.env["NO_COLOR"] === undefined;
  return formatErrors(diagnostics, source, { file, color });
}

function reportError(error: unknown, source: string, file: string): number {
  const diagnostics = toDiagnostics(error);
  if (diagnostics === null) throw error;
  process.stderr.write(`${render(diagnostics, source, file)}\n`);
  return 1;
}

process.exitCode = main(process.argv);
