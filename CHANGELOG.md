# Changelog

All notable changes to Luma are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/).

## [1.2.0]

Three language features, and a debugger you can run backwards.

### Added

- **Pattern matching.** `match` tries arms in source order, destructuring as it
  goes: literals, bindings, `_`, array patterns with `...rest`, hash patterns
  (a subset test), alternatives with `|`, and `if` guards that see the bindings.
  An arm's body is an expression or a block. No exhaustiveness checking — `_` is
  how a match is made total — and an unmatched value fails with
  `no match arm matched <value>`.

  Alternatives may not bind names: only one of them matches, so the body could
  not tell which binding it got. The parser rejects `a | b` with that reason.

- **String interpolation.** `"Hello, {name}! ({len(name)} chars)"`. Any single
  expression fits in a hole, nested quotes included; `\{` and `\}` are literal
  braces. The lexer captures each hole as raw source plus its absolute position
  and the parser re-lexes it there, so a diagnostic inside an interpolation
  points at the real column rather than at the start of the string.

- **Compound assignment** — `+= -= *= /= %=`, inheriting the overloads of the
  operator they apply, so `s += "!"` concatenates and `a += [1]` appends. Kept
  as an AST node rather than desugared to `a = a + b`, so the target is
  evaluated once: `items[next()] += 1` calls `next` a single time. Applying one
  to a hash key that does not exist is an error rather than an implicit `nil`.

- **A time-travel debugger.** The interpreter can attach a `TraceRecorder` that
  captures, at every statement and call boundary, the position, the call stack
  and the whole scope chain. Values are stringified as they are captured, so
  stepping back shows what a mutable value *was*.
  - `luma trace <file>` prints the timeline, indented by call depth, with the
    variables that changed at each step.
  - The playground gained a **Debug** button: a scrubbable timeline, step
    controls, arrow-key navigation, a current-line marker, and panes for the
    variables in scope and the call stack.
  - `trace(source)` exposes the same thing programmatically.

  Recording, rather than pausing, is what makes stepping *backwards* possible —
  and it costs one null check per statement when the debugger is off.

- `Environment.chain()` exposes the scope chain for debuggers and tooling.

### Fixed

- A UTF-8 byte-order mark at the start of a file is now skipped instead of
  failing to lex. Editors on Windows write one by default.

### Changed

- The playground editor no longer wraps long lines, so the debugger can locate a
  line by its number.

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
