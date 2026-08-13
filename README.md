<div align="center">

# Luma

**A small, expressive programming language — built from scratch in TypeScript.**

Hand-written lexer → Pratt parser → tree-walking interpreter.
No parser generator, no runtime dependencies, no magic.

[**Try it in your browser →**](https://belasimoes.github.io/luma-lang/)

[![CI](https://github.com/belaSimoes/luma-lang/actions/workflows/ci.yml/badge.svg)](https://github.com/belaSimoes/luma-lang/actions/workflows/ci.yml)
[![Playground](https://img.shields.io/badge/playground-live-7aa2f7)](https://belasimoes.github.io/luma-lang/)
[![License: MIT](https://img.shields.io/badge/license-MIT-9ece6a)](LICENSE)
![Runtime dependencies: 0](https://img.shields.io/badge/runtime%20dependencies-0-8b93a7)

</div>

---

```luma
// Functions are values, and they close over their scope.
fn counter(start) {
  let n = start;
  fn() { n = n + 1; n }
}

let tick = counter(0);
print(tick(), tick(), tick());          // 1 2 3

// Collections and a pipeline over them.
let people = [
  {"name": "Ada", "age": 36},
  {"name": "Grace", "age": 45},
  {"name": "Alan", "age": 41}
];

let youngest_first = sort(people, fn(a, b) { a.age - b.age });
print(join(map(youngest_first, fn(p) { p.name }), ", "));
//=> Ada, Alan, Grace
```

## Why this project exists

Most people use languages without ever seeing what happens between typing `1 + 2 * 3`
and getting `7`. Luma is that gap, made readable: every stage is a small file you can
open, and the parts that are usually hidden — precedence climbing, scope chains, closure
capture, error recovery — are the point rather than an implementation detail.

It is deliberately complete rather than minimal: closures, first-class functions,
mutable collections, `break`/`continue`, a REPL, a CLI, a static analysis pass, structured
diagnostics with source snippets and call stacks, 290 tests, and a browser playground that
runs the same code the CLI does.

## Mistakes are caught before anything runs

Luma parses, then *analyses*, then executes. The resolver walks the AST and reports
undefined names, misplaced `break`/`return` and unreachable code — so a typo can never
leave you half-way through a job with the side effects already committed. Everything wrong
is reported in one pass, not one error per run:

```
$ luma check examples/09_static_analysis.luma
error[semantic]: undefined variable 'heigth'
  --> 09_static_analysis.luma:17:11
   |
17 |   width * heigth
   |           ^^^^^^
   = help: did you mean 'height'?

error[semantic]: 'break' outside of a loop
  --> 09_static_analysis.luma:30:1
   |
30 | break;
   | ^^^^^
   = help: break may only appear inside a while or for loop

error[semantic]: cannot assign to undeclared variable 'total'
  --> 09_static_analysis.luma:33:1
   |
33 | total = area();
   | ^^^^^
   = help: use 'let total = ...' to declare it first

3 errors found
```

The parser recovers too: a syntax error does not stop the run, it resynchronises at the
next statement so the rest of the file is still checked.

## Quick start

Requires **Node 22.18+** or **24+** — the version where type stripping became the default,
which is what lets Luma run its own TypeScript sources with no build step for development.
CI covers both.

```bash
git clone https://github.com/belaSimoes/luma-lang.git
cd luma-lang
npm install          # installs TypeScript, used only for typechecking and the browser build

npm start                                # REPL
node src/cli.ts examples/02_fizzbuzz.luma
node src/cli.ts -e 'print(map(range(5), fn(n) { n * n }))'
npm test                                 # 219 tests, zero dependencies
npm run examples                         # run every example against its snapshot
npm run playground                       # build + serve the web playground locally
```

### CLI

| Command | Description |
| --- | --- |
| `luma` | start the interactive REPL |
| `luma file.luma` | run a program |
| `luma -e '<code>'` | run a snippet and echo its value |
| `luma check file.luma` | report problems without running the program |
| `luma ast file.luma` | dump the syntax tree as JSON |
| `luma tokens file.luma` | dump the token stream as JSON |

### As a library

```ts
import { run, parse, Interpreter } from "luma-lang";

const result = run(`print("hi"); 1 + 1`);
// { value: 2, output: ["hi"], error: null, ok: true }

// Or drive the interpreter yourself, capturing output and bounding resources.
const interpreter = new Interpreter({ stdout: console.log, maxCallDepth: 500 });
interpreter.run("fn fib(n) { if (n < 2) { n } else { fib(n-1) + fib(n-2) } } print(fib(20))");
```

## The language in one page

```luma
// ── Bindings ────────────────────────────────────────────────
let name = "Luma";        // declare
name = "Luma 1.0";        // reassign; assigning an undeclared name is an error

// ── Types ───────────────────────────────────────────────────
42  3.14  1_000_000       // number (IEEE-754 double)
"text"  'also text'       // string
true  false  nil          // boolean, nil
[1, "two", [3]]           // array — mutable, heterogeneous
{"key": 1, 2: "two"}      // hash  — string/number/boolean keys

// ── Everything is an expression ─────────────────────────────
let size = if (len(name) > 4) { "long" } else { "short" };

// ── Functions ───────────────────────────────────────────────
fn add(a, b) { a + b }            // declaration (recursion-friendly)
let mul = fn(a, b) { a * b };     // expression
add(1, 2);                        // the last expression is the return value
fn early(n) { if (n < 0) { return "negative"; } "ok" }

// ── Control flow ────────────────────────────────────────────
while (i < 10) { i = i + 1; }
for (item in [1, 2, 3]) { print(item); }
for (pair in {"a": 1}) { print(pair[0], pair[1]); }   // [key, value]
break;  continue;

// ── Access ──────────────────────────────────────────────────
list[0];  list[-1];       // negative indices count from the end
hash["key"];  hash.key;   // `.key` is sugar for ["key"]
hash.key = 9;             // in-place write

// ── Operators ───────────────────────────────────────────────
+  -  *  /  %             // arithmetic (÷0 is an error, not Infinity)
==  !=  <  >  <=  >=      // == is structural: [1,[2]] == [1,[2]]
&&  ||  !                 // short-circuit, returning the deciding operand
"a" + 1                   // "a1" — + concatenates if either side is a string
"ab" * 3                  // "ababab"
[1] + [2]                 // [1, 2]
```

Two decisions worth calling out:

- **Only `nil` and `false` are falsy.** `0`, `""` and `[]` are truthy, because
  "is it empty?" and "is it false?" are different questions.
- **Assignment requires a prior `let`.** A misspelled name is an error instead of a
  brand-new global that silently does nothing.

The full grammar, semantics and precedence table live in
[`docs/LANGUAGE.md`](docs/LANGUAGE.md).

## Error messages

Diagnostics are treated as a feature, not an afterthought. Every error knows its exact
position, underlines the offending span, and unwinds the call stack:

```
$ luma examples/08_diagnostics.luma
rectangle: 12
error[runtime]: operator '*' is not defined for number and nil
 --> 08_diagnostics.luma:7:9
  |
7 |   width * height
  |         ^
  = in area(...)
  = in describe(...)
```

Runaway programs fail politely too: infinite recursion becomes
`maximum call depth of 2000 exceeded (infinite recursion?)` rather than a host
stack overflow, and an unbounded loop hits a configurable iteration ceiling.

## How it works

```
source text
   │
   ▼  src/lexer.ts        single pass, no regex, tracks spans
tokens
   │
   ▼  src/parser.ts       Pratt parser — precedence climbing, error recovery
AST  (src/ast.ts)         plain objects discriminated by `kind`
   │
   ▼  src/resolver.ts     static checks: names, control flow, reachability
   │                      ── stops here if anything is wrong ──
   ▼  src/interpreter.ts  tree-walking evaluation over a scope chain
value
```

| File | Lines | Responsibility |
| --- | --- | --- |
| `src/lexer.ts` | ~235 | Characters → tokens, with spans for diagnostics and tooling |
| `src/parser.ts` | ~480 | Tokens → AST via a Pratt parser, recovering from errors |
| `src/ast.ts` | ~160 | The node types, as a discriminated union |
| `src/resolver.ts` | ~315 | Static analysis: scopes, control flow, reachability |
| `src/interpreter.ts` | ~540 | Evaluation, scopes, calls, control flow |
| `src/environment.ts` | ~85 | The scope chain |
| `src/values.ts` | ~150 | Runtime values, equality, formatting |
| `src/builtins.ts` | ~320 | The standard library |
| `src/errors.ts` | ~205 | Positioned diagnostics, snippet rendering, spelling hints |
| `src/highlight.ts` | ~125 | Syntax highlighting, driven by the real lexer |

### Design notes

**Why a Pratt parser?** Precedence climbing replaces the usual tower of mutually
recursive grammar functions (`parseEquality` → `parseComparison` → `parseSum` → …) with a
single loop plus a table of binding powers. Adding an operator is one table entry, and
expressions like `-f(x)[0].y` fall out without special cases.

**Why signals for `return`/`break`/`continue`?** They are non-local jumps, so they are
thrown and caught by the construct that owns them. The alternative — threading a
"completion reason" through every evaluation — pollutes every return type to handle three
rare cases. As a bonus, `break` outside a loop is a real error instead of silence.

**Why do blocks evaluate to their last expression?** It makes `if` an expression, makes
`fn(x) { x * 2 }` read the way you'd expect, and removes a whole category of missing-`return`
bugs. Declarations (`let`, `fn`) deliberately evaluate to `nil` so their value is never
mistaken for a result.

**Why a separate resolver pass?** Two reasons. Correctness: a program that references an
undefined name is broken whether or not that line happens to execute, and finding out
*after* half the work has already been done is the worst time to learn it. And honesty
about scope — deciding statically whether `break` belongs to a loop, or whether a name is
visible, forces the scoping rules to be written down rather than implied by whatever the
evaluator happens to do.

**Why is the highlighter part of the language?** `src/highlight.ts` colours source by
running the actual lexer, so it cannot drift from the parser the way a hand-written
editor grammar does. It is a library module with its own tests — the playground just
renders what it returns.

**Why zero dependencies?** The point of the project is that nothing is delegated.
TypeScript appears only as a devDependency, for typechecking and for compiling the browser
build; the interpreter itself runs on Node with no toolchain at all.

## Benchmarks

```bash
npm run bench              # all benchmarks
npm run bench -- fib loop  # a subset
```

Best of 7 runs after 2 warm-ups, measuring parse + analyse + evaluate end to end
(Node 24, Windows 11, i-class laptop — treat as relative, not absolute):

| Benchmark | Time | What it stresses |
| --- | ---: | --- |
| `strings` | 5.7 ms | concatenation, `split`/`join`/`map` |
| `collections` | 60.5 ms | a 50k-element pipeline plus hash writes |
| `fib` | 73.4 ms | `fib(24)` — calls, scope creation, recursion |
| `loop` | 195.8 ms | 400k iterations of read-modify-write |

The suite exists to make optimisation claims checkable. It immediately earned its keep:
variable reads used to walk the scope chain twice — once to ask whether a name existed,
once to fetch it — which a single `lookup` returning a sentinel collapsed into one walk,
worth **12% on `loop`** and 8% on `fib`.

## Standard library

<details>
<summary><strong>42 builtins</strong> (click to expand)</summary>

**General** — `print(…)`, `len(x)`, `type(x)`, `assert(cond, msg?)`

**Conversion** — `str(x)`, `num(x)`, `bool(x)`

**Arrays** — `push(a, …)`, `pop(a)`, `first(a)`, `last(a)`, `rest(a)`,
`slice(a, start, end?)`, `reverse(a)`, `contains(a, x)`, `index_of(a, x)`,
`range(stop)` / `range(start, stop, step?)`, `sort(a, cmp?)`

**Higher-order** — `map(a, fn)`, `filter(a, fn)`, `reduce(a, init, fn)`, `each(a, fn)`

**Hashes** — `keys(h)`, `values(h)`, `remove(h, k)`, `merge(a, b)`

**Strings** — `split(s, sep?)`, `join(a, sep?)`, `upper(s)`, `lower(s)`, `trim(s)`,
`replace(s, from, to)`, `starts_with(s, p)`, `ends_with(s, p)`

**Math** — `abs`, `floor`, `ceil`, `round`, `sqrt`, `pow`, `min`, `max`

Collection builtins never mutate their arguments; they return new values. Use index
assignment (`a[0] = 1`) when you want mutation.

</details>

## Examples

Each program in [`examples/`](examples) is executed by the test-suite and compared against
a committed snapshot, so nothing here can drift out of date.

| Example | Shows |
| --- | --- |
| [`01_hello.luma`](examples/01_hello.luma) | bindings, string building, `if` as an expression |
| [`02_fizzbuzz.luma`](examples/02_fizzbuzz.luma) | the same problem imperatively and as a pipeline |
| [`03_fibonacci.luma`](examples/03_fibonacci.luma) | naive vs iterative vs memoised — a closure as a cache |
| [`04_closures.luma`](examples/04_closures.luma) | captured state, partial application, composition, objects from closures |
| [`05_sorting.luma`](examples/05_sorting.luma) | quicksort and mergesort written in Luma |
| [`06_word_count.luma`](examples/06_word_count.luma) | a text pipeline: tokenise, count, rank |
| [`07_interpreter_in_luma.luma`](examples/07_interpreter_in_luma.luma) | a recursive-descent arithmetic parser — written *in* Luma |
| [`08_diagnostics.luma`](examples/08_diagnostics.luma) | what a runtime error looks like (fails on purpose) |
| [`09_static_analysis.luma`](examples/09_static_analysis.luma) | everything the resolver catches before running (fails on purpose) |

## Testing

```bash
npm test          # 290 tests across every layer
npm run typecheck # strict TypeScript, noUncheckedIndexedAccess included
npm run build     # emits dist/ with type declarations
```

The suite runs on Node's built-in test runner — no Jest, no Vitest, no config. It covers
tokenisation and source spans, a table of ~20 precedence cases asserted as fully
parenthesised strings, parser error recovery, every static check the resolver makes
(including a table of programs that must *not* be flagged), evaluation semantics, every
builtin and its failure modes, exact diagnostic positions and rendering, and an end-to-end
snapshot of every example program.

Two properties are worth calling out, because they catch whole classes of bug at once:

- highlighting every example program and concatenating the segments must reproduce the
  file byte for byte — a highlighter that drops or duplicates source fails instantly;
- the resolver must report *nothing* for a table of valid programs, which is what keeps
  static analysis from becoming a nuisance.

## Roadmap

Ideas that would each teach something new, roughly in order of interest:

- [x] A resolver pass with static diagnostics and spelling suggestions
- [x] Parser error recovery, so one run reports every syntax error
- [x] A benchmark suite to keep performance claims honest
- [ ] Turn the resolver's scope walk into slot indices, so lookups become array reads
- [ ] A bytecode VM behind the same front-end, to compare tree-walking against a stack machine
- [ ] Constant folding over the AST
- [ ] `try`/`catch`, or a `Result`-style convention in the standard library
- [ ] Modules (`import`) with a file-based resolver
- [ ] A language server — the resolver and `src/highlight.ts` are already most of one

## License

MIT — see [LICENSE](LICENSE).
