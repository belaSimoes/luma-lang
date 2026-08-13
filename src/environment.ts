/**
 * Lexical scope, implemented as a chain of maps.
 *
 * Every function call creates a child of the environment the closure captured
 * (not of the caller), which is what makes closures behave correctly.
 */

import type { LumaValue } from "./values.ts";

/**
 * Returned by {@link Environment.lookup} when a name is unbound.
 *
 * A dedicated sentinel lets a single walk of the scope chain answer both "does
 * this exist?" and "what is it?" — `nil` is a perfectly valid value, so
 * `undefined` cannot carry that meaning.
 */
export const UNBOUND: unique symbol = Symbol("unbound");

export class Environment {
  private readonly store = new Map<string, LumaValue>();
  private readonly parent: Environment | null;

  constructor(parent: Environment | null = null) {
    this.parent = parent;
  }

  /** Create a scope nested inside this one. */
  child(): Environment {
    return new Environment(this);
  }

  /** Bind a name in *this* scope, shadowing any outer binding. */
  define(name: string, value: LumaValue): void {
    this.store.set(name, value);
  }

  has(name: string): boolean {
    let scope: Environment | null = this;
    while (scope !== null) {
      if (scope.store.has(name)) return true;
      scope = scope.parent;
    }
    return false;
  }

  /**
   * Look a name up through the scope chain in a single walk, returning
   * {@link UNBOUND} when it does not exist. This is the hot path — every
   * variable reference goes through it — so it deliberately avoids the
   * `has()` + `get()` pair that would walk the chain twice.
   */
  lookup(name: string): LumaValue | typeof UNBOUND {
    let scope: Environment | null = this;
    while (scope !== null) {
      // `nil` is stored as `null`, never as `undefined`, so a `undefined` result
      // unambiguously means "not in this scope" — no second `has()` needed.
      const found = scope.store.get(name);
      if (found !== undefined) return found;
      scope = scope.parent;
    }
    return UNBOUND;
  }

  /** Look a name up through the scope chain. Returns `undefined` if unbound. */
  get(name: string): LumaValue | undefined {
    const found = this.lookup(name);
    return found === UNBOUND ? undefined : found;
  }

  /**
   * Assign to an existing binding, walking outwards. Returns false when the
   * name was never declared, so the caller can raise a proper error instead of
   * silently creating a global.
   */
  assign(name: string, value: LumaValue): boolean {
    let scope: Environment | null = this;
    while (scope !== null) {
      if (scope.store.has(name)) {
        scope.store.set(name, value);
        return true;
      }
      scope = scope.parent;
    }
    return false;
  }

  /**
   * The scope chain, innermost first, as name/value pairs.
   *
   * Exposed for the debugger and the REPL. `skip` drops names that would only
   * be noise — the 42 builtins sitting in the global scope, typically.
   */
  chain(skip: ReadonlySet<string> = new Set()): Array<Array<[string, LumaValue]>> {
    const frames: Array<Array<[string, LumaValue]>> = [];
    let scope: Environment | null = this;
    while (scope !== null) {
      frames.push([...scope.store].filter(([name]) => !skip.has(name)));
      scope = scope.parent;
    }
    return frames;
  }

  /** Names visible from this scope — used by the REPL for tab completion. */
  names(): string[] {
    const seen = new Set<string>();
    let scope: Environment | null = this;
    while (scope !== null) {
      for (const key of scope.store.keys()) seen.add(key);
      scope = scope.parent;
    }
    return [...seen].sort();
  }
}
