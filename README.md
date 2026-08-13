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
mutable collections, `break`/`continue`, a REPL, a CLI, structured diagnostics with source
snippets and call stacks, 219 tests, and a browser playground that runs the same code the
CLI does.

## Quick start

Requires **Node 22.6+** (Luma runs its own TypeScript sources directly via type stripping —
there is no build step for development).

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
   ▼  src/lexer.ts        single pass, no regex, tracks line & column
tokens
   │
   ▼  src/parser.ts       Pratt parser — precedence climbing
AST  (src/ast.ts)         plain objects discriminated by `kind`
   │
   ▼  src/interpreter.ts  tree-walking evaluation over a scope chain
value
```

| File | Lines | Responsibility |
| --- | --- | --- |
| `src/lexer.ts` | ~230 | Characters → tokens, with positions for diagnostics |
| `src/parser.ts` | ~430 | Tokens → AST via a Pratt parser |
| `src/ast.ts` | ~160 | The node types, as a discriminated union |
| `src/interpreter.ts` | ~480 | Evaluation, scopes, calls, control flow |
| `src/environment.ts` | ~70 | The scope chain |
| `src/values.ts` | ~150 | Runtime values, equality, formatting |
| `src/builtins.ts` | ~320 | The standard library |
| `src/errors.ts` | ~100 | Positioned errors and snippet rendering |

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

**Why zero dependencies?** The point of the project is that nothing is delegated.
TypeScript appears only as a devDependency, for typechecking and for compiling the browser
build; the interpreter itself runs on Node with no toolchain at all.

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
| [`08_diagnostics.luma`](examples/08_diagnostics.luma) | what a Luma error looks like (fails on purpose) |

## Testing

```bash
npm test          # 219 tests across lexer, parser, interpreter, builtins, errors, examples
npm run typecheck # strict TypeScript, noUncheckedIndexedAccess included
npm run build     # emits dist/ with type declarations
```

The suite runs on Node's built-in test runner — no Jest, no Vitest, no config. It covers
tokenisation and positions, a table of ~20 precedence cases asserted as fully parenthesised
strings, evaluation semantics, every builtin including its failure modes, exact error
positions and rendering, and an end-to-end snapshot of every example program.

## Roadmap

Ideas that would each teach something new, roughly in order of interest:

- [ ] A bytecode VM behind the same front-end, to compare tree-walking against a stack machine
- [ ] Constant folding and a resolver pass that turns name lookups into slot indices
- [ ] `try`/`catch`, or a `Result`-style convention in the standard library
- [ ] Modules (`import`) with a file-based resolver
- [ ] A language server: syntax highlighting, diagnostics and go-to-definition reuse the AST

## License

MIT — see [LICENSE](LICENSE).
