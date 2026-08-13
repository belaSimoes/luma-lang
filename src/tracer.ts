/**
 * Execution recording — the machinery behind Luma's time-travel debugger.
 *
 * A tree-walking interpreter is a plain recursive function, so *pausing* it
 * would need coroutines or a rewritten evaluator. Recording it does not: the
 * interpreter calls into a recorder at each statement and each call boundary,
 * and the recorder keeps a snapshot of where execution was and what every
 * variable held at that moment.
 *
 * Scrubbing back and forth through that timeline afterwards gives the same
 * thing a stepping debugger does — and rather more, because you can step
 * *backwards*. The cost is that the run must finish first, and that snapshots
 * are rendered eagerly: values are stringified as they are captured, so a later
 * mutation cannot rewrite history.
 */

import type { Position } from "./token.ts";
import { inspect, type LumaValue } from "./values.ts";
import type { Environment } from "./environment.ts";

export type StepKind = "statement" | "call" | "return";

export interface TraceScope {
  /** `"global"`, or the function whose frame this is. */
  name: string;
  variables: Array<[name: string, value: string]>;
}

export interface TraceStep {
  index: number;
  kind: StepKind;
  line: number;
  column: number;
  /** A one-line description: the source line, or `fib(3)`, or `=> 2`. */
  label: string;
  /** Call frames, innermost first. */
  stack: string[];
  /** Scope chain, innermost first, with values rendered at capture time. */
  scopes: TraceScope[];
}

export interface RecorderOptions {
  /** Stop recording past this many steps, so a hot loop cannot exhaust memory. */
  maxSteps?: number;
  /** Names to hide from every snapshot — the builtins, in practice. */
  hide?: Iterable<string>;
}

const DEFAULT_MAX_STEPS = 20_000;
/** Long values are elided; a debugger pane wants a glance, not a dump. */
const MAX_VALUE_LENGTH = 120;

function render(value: LumaValue): string {
  const rendered = inspect(value);
  return rendered.length > MAX_VALUE_LENGTH
    ? `${rendered.slice(0, MAX_VALUE_LENGTH - 1)}…`
    : rendered;
}

export class TraceRecorder {
  readonly steps: TraceStep[] = [];
  /** True when recording stopped early because {@link maxSteps} was reached. */
  truncated = false;

  private readonly lines: string[];
  private readonly maxSteps: number;
  private readonly hide: Set<string>;

  constructor(source: string, options: RecorderOptions = {}) {
    this.lines = source.split("\n");
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.hide = new Set(options.hide ?? []);
  }

  /** Record a statement about to be evaluated. */
  statement(position: Position, stack: string[], env: Environment): void {
    this.record("statement", position, this.sourceLine(position.line), stack, env);
  }

  /** Record a call about to be entered, labelled with its arguments. */
  call(
    name: string,
    args: LumaValue[],
    position: Position,
    stack: string[],
    env: Environment,
  ): void {
    const label = `${name}(${args.map(render).join(", ")})`;
    this.record("call", position, label, stack, env);
  }

  /** Record a call returning, labelled with its result. */
  return_(value: LumaValue, position: Position, stack: string[], env: Environment): void {
    this.record("return", position, `=> ${render(value)}`, stack, env);
  }

  private record(
    kind: StepKind,
    position: Position,
    label: string,
    stack: string[],
    env: Environment,
  ): void {
    if (this.steps.length >= this.maxSteps) {
      this.truncated = true;
      return;
    }

    // The interpreter keeps frames outermost-first; every consumer — the error
    // formatter, the debugger's stack pane, the scope naming below — wants the
    // innermost first, so the flip happens once, here.
    const innermostFirst = [...stack].reverse();

    this.steps.push({
      index: this.steps.length,
      kind,
      line: position.line,
      column: position.column,
      label,
      stack: innermostFirst,
      scopes: this.snapshot(env, innermostFirst),
    });
  }

  /**
   * Freeze the scope chain. Values are rendered now, not held by reference, so
   * stepping back shows what a variable *was*, not what it later became.
   */
  private snapshot(env: Environment, stack: string[]): TraceScope[] {
    const frames = env.chain(this.hide);
    return frames.map((variables, depth) => ({
      name: depth === frames.length - 1 ? "global" : (stack[0] ?? "block"),
      variables: variables.map(([name, value]) => [name, render(value)] as [string, string]),
    }));
  }

  private sourceLine(line: number): string {
    return (this.lines[line - 1] ?? "").trim();
  }
}
