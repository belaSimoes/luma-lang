# Contributing

Thanks for taking a look. This is primarily a learning project, but issues and pull
requests are welcome.

## Getting set up

```bash
npm install
npm test
```

Node 22.18 or newer is required (that is the version where TypeScript type
stripping became the default). The interpreter's TypeScript sources run directly through
Node's type stripping, so there is no build step while developing — `npm run build` exists
only to produce `dist/` for the browser playground and for publishing.

## Before opening a pull request

```bash
npm run typecheck   # strict TypeScript
npm test            # the whole suite
npm run examples    # every example still matches its snapshot
```

## Where things live

| Path | What it is |
| --- | --- |
| `src/` | The implementation: lexer, parser, AST, resolver, interpreter, builtins, CLI, REPL |
| `test/` | Node's built-in test runner, one file per layer |
| `examples/` | Luma programs, each with a committed `.expected` snapshot |
| `bench/` | Benchmark programs plus the harness (`npm run bench`) |
| `docs/LANGUAGE.md` | The language specification |
| `web/` | The browser playground |

A program travels **parse → resolve → evaluate**. When you add a language
feature, ask which of the three needs to know about it — most need all three,
and forgetting the resolver is the usual way a new node type ends up
unchecked.

## Adding a builtin

1. Add a `define(...)` entry in `src/builtins.ts`, declaring its arity once.
   Use `ctx.fail(...)` for argument errors so they get a source position, and
   `return ctx.fail(...)` so TypeScript narrows the types after the guard.
2. Cover it in `test/builtins.test.ts`, including its failure modes.
3. List it in the README's standard-library section.

## Changing the language

Grammar or semantic changes should come with:

- a test in `test/parser.test.ts` (precedence cases are asserted as fully
  parenthesised strings) or `test/interpreter.test.ts`,
- a case in `test/resolver.test.ts` — including one in the `CLEAN` table if the
  new syntax must *not* be flagged, which is how false positives get caught,
- an update to `docs/LANGUAGE.md`,
- and, if it is worth showing off, an example under `examples/` — regenerate the
  snapshots with `node scripts/run-examples.ts --update` and read the diff before
  committing it.

## Style

Two-space indentation, no semicolon-free style, and comments that explain *why*
rather than restating the code. The existing files are the reference.
