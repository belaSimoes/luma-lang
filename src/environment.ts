/**
 * Lexical scope, implemented as a chain of maps.
 *
 * Every function call creates a child of the environment the closure captured
 * (not of the caller), which is what makes closures behave correctly.
 */

import type { LumaValue } from "./values.ts";

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

  /** Look a name up through the scope chain. Returns `undefined` if unbound. */
  get(name: string): LumaValue | undefined {
    let scope: Environment | null = this;
    while (scope !== null) {
      const found = scope.store.get(name);
      if (found !== undefined || scope.store.has(name)) return found;
      scope = scope.parent;
    }
    return undefined;
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
