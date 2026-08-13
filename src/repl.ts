/**
 * Interactive REPL.
 *
 * Keeps one long-lived {@link Interpreter} so bindings persist across lines,
 * and buffers input until the snippet parses, which makes pasting a multi-line
 * function definition work naturally.
 */

import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";

import { Interpreter } from "./interpreter.ts";
import { LumaError, formatError } from "./errors.ts";
import { parse } from "./parser.ts";
import { inspect } from "./values.ts";

const BANNER = `Luma REPL — type :help for commands, :quit to exit`;

const HELP = `
  :help          show this message
  :env           list the names currently in scope
  :ast <code>    print the parsed syntax tree as JSON
  :clear         forget every binding
  :quit          leave the REPL

  Expressions are echoed automatically; statements evaluate silently.
  An unfinished line (open brace, bracket or string) continues on the next one.
`;

/** Heuristic: does this snippet fail only because the user is still typing? */
function isIncomplete(error: LumaError): boolean {
  return /end of input|unclosed|unterminated/i.test(error.message);
}

export function startRepl(): void {
  // Held in a box so `:clear` can swap in a pristine interpreter.
  const state = { interpreter: new Interpreter() };
  const rl = createInterface({ input: stdin, output: stdout, prompt: "luma> " });

  let buffer = "";
  const setPrompt = () => rl.setPrompt(buffer === "" ? "luma> " : "  ... ");

  console.log(BANNER);
  rl.prompt();

  rl.on("line", (line) => {
    const trimmed = line.trim();

    if (buffer === "" && trimmed.startsWith(":")) {
      if (handleCommand(trimmed, state, rl)) return;
      setPrompt();
      rl.prompt();
      return;
    }

    buffer = buffer === "" ? line : `${buffer}\n${line}`;
    const source = buffer;

    try {
      parse(source);
    } catch (error) {
      if (error instanceof LumaError && isIncomplete(error) && trimmed !== "") {
        setPrompt();
        rl.prompt();
        return;
      }
      buffer = "";
      report(error, source);
      setPrompt();
      rl.prompt();
      return;
    }

    buffer = "";
    try {
      const value = state.interpreter.run(source);
      if (value !== null) console.log(inspect(value));
    } catch (error) {
      report(error, source);
    }
    setPrompt();
    rl.prompt();
  });

  rl.on("close", () => {
    console.log();
    process.exit(0);
  });
}

function report(error: unknown, source: string): void {
  if (error instanceof LumaError) {
    console.error(formatError(error, source, { file: "repl", color: stdout.isTTY === true }));
    return;
  }
  throw error;
}

/** Returns true when the command already re-prompted (or ended the session). */
function handleCommand(
  input: string,
  state: { interpreter: Interpreter },
  rl: ReturnType<typeof createInterface>,
): boolean {
  const [command, ...rest] = input.split(" ");
  const argument = rest.join(" ").trim();

  switch (command) {
    case ":quit":
    case ":exit":
      rl.close();
      return true;

    case ":help":
      console.log(HELP);
      return false;

    case ":env":
      console.log(state.interpreter.globals.names().join("  "));
      return false;

    case ":clear":
      state.interpreter = new Interpreter();
      console.log("session reset");
      return false;

    case ":ast": {
      if (argument === "") {
        console.log("usage: :ast <code>");
        return false;
      }
      try {
        console.log(JSON.stringify(parse(argument), null, 2));
      } catch (error) {
        report(error, argument);
      }
      return false;
    }

    default:
      console.log(`unknown command '${command}' — try :help`);
      return false;
  }
}
