# Changelog

All notable changes to Luma are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/).

## [1.1.0]

The theme of this release: **find mistakes earlier, report all of them at once,
and prove the performance claims.**

### Added

- **Static analysis pass** (`src/resolver.ts`). Programs are now analysed after
  parsing and before execution. It reports:
  - references to undefined variables, and assignment to a name no `let`
    introduced, each with a *did you mean …?* suggestion computed by edit
    distance over the names actually in scope;
  - `break` / `continue` outside a loop, and `return` outside a function — all
    three of which previously escaped as uncaught internal objects (see Fixed);
  - unreachable code after `return` / `break` / `continue`, as a warning.

  Function bodies are resolved after their enclosing scope, so mutual recursion
  and use-before-declaration keep working.

- **Parser error recovery.** A syntax error no longer stops the parse. The
  parser resynchronises at the next statement boundary and keeps going, so one
  run reports every syntax error rather than one per attempt (capped at 10 to
  avoid cascades).

- **`luma check <file>`** — analyse a program and report its problems without
  running it. Exposed programmatically as `check(source)`.

- **`src/highlight.ts`** — syntax highlighting driven by Luma's own lexer, so
  the colours can never disagree with the parser. Exported as `highlight` /
  `highlightHtml` and covered by tests, including a round-trip property: the
  segments of every example program must reconstruct the file byte for byte.

- **Benchmark suite** (`npm run bench`) covering call-heavy, loop-heavy,
  collection-heavy and string-heavy programs, with `--markdown` and `--json`
  output.

- **Token spans.** Every token now carries `end` alongside `position`. A string
  token's `literal` holds its *decoded* value, so the span is the only way to
  map a token back onto the source — which is what highlighting and future
  editor tooling need.

- The playground gained syntax highlighting, a live problem count as you type,
  and a **Check** button.

### Changed

- Diagnostics grew a `semantic` phase, a `warning` severity, an optional
  `= help:` hint line, and a `LumaErrorGroup` for reporting several at once.
  `formatErrors` renders a group in source order with a closing tally.
- `run()` now returns a `warnings` field alongside `error`.
- A program that fails analysis produces **no output at all** — previously a
  program could print, then die on an undefined name halfway through.
- Passing a builtin where a callback is expected now works: `map(words, upper)`
  used to fail with *"upper expects 1 argument, got 2"*, because `map` also
  passes the index. Extra arguments are dropped for builtins, as they already
  were for user-defined functions.

### Fixed

- **`break`, `continue` and `return` outside their construct crashed the host.**
  They propagated as internal signal objects and surfaced as an uncaught
  `BreakSignal {}` from Node. They are now rejected statically by the resolver,
  and the evaluator converts any that still escape into a proper Luma error.

### Performance

- Variable reads walked the scope chain **twice** — once through `has()` to check
  existence, once through `get()` to fetch the value. `Environment.lookup()`
  returns an `UNBOUND` sentinel instead, collapsing this into a single walk:
  **12% faster on the `loop` benchmark**, 8% on `fib`.

## [1.0.0]

Initial release.

- Lexer, Pratt parser and tree-walking interpreter, written from scratch in
  TypeScript with zero runtime dependencies.
- Closures, first-class functions, arrays, hashes, `if` as an expression,
  `while` / `for..in` with `break` and `continue`, structural equality,
  negative indexing and `a.b` sugar for `a["b"]`.
- 42 builtins, a CLI, a multi-line REPL, and a browser playground.
- Diagnostics with line, column, an underlined span and a call stack.
