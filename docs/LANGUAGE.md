# The Luma language specification

This document describes Luma precisely enough to reimplement it. For a friendly
introduction, read the [README](../README.md) or open the
[playground](https://belasimoes.github.io/luma-lang/).

---

## 1. Lexical structure

### 1.1 Encoding and whitespace

Source is UTF-8 text. Spaces, tabs, carriage returns and newlines separate
tokens and are otherwise insignificant — Luma is not whitespace-sensitive.

### 1.2 Comments

```
// to the end of the line
/* block comments, which do not nest */
```

An unterminated block comment is a syntax error reported at its opening `/*`.

### 1.3 Identifiers

```
identifier := (letter | "_") (letter | digit | "_")*
letter     := "a".."z" | "A".."Z"
```

Identifiers are case-sensitive. The following are reserved and may not be used
as identifiers:

```
fn  let  true  false  if  else  return  while  for  in  break  continue  nil
```

### 1.4 Numbers

```
number   := digits ("." digits)? exponent?
digits   := digit (digit | "_")*
exponent := ("e" | "E") ("+" | "-")? digit+
```

All numbers are IEEE-754 doubles; there is no separate integer type. Underscores
are permitted as digit separators (`1_000_000`). A `.` is only consumed as a
decimal point when a digit follows it, so `1.max` lexes as `1` `.` `max`.

### 1.5 Strings

Strings are delimited by `"` or `'` and may not span lines. Supported escapes:

| Escape | Meaning |
| --- | --- |
| `\n` | newline |
| `\t` | tab |
| `\r` | carriage return |
| `\0` | NUL |
| `\"` `\'` | quote |
| `\\` | backslash |
| `\{` `\}` | literal brace, i.e. not an interpolation |

Any other escape is a syntax error.

### 1.6 String interpolation

`{` inside a string opens an interpolation holding exactly one expression:

```luma
let name = "Luma";
print("Hello, {name}! That is {len(name)} characters.");
print("Nested quotes are fine: {upper("shout")}");
print("A literal brace: \{");
```

The expression is inserted the way `print` renders it — strings appear without
quotes. A string with no interpolation is an ordinary string literal; the
distinction is invisible except in the token stream.

Positions inside a hole are absolute, so a diagnostic points at the real column
of the original file rather than at the start of the string.

### 1.7 Operators and punctuation

```
=  +=  -=  *=  /=  %=
+  -  !  *  /  %  <  >  <=  >=  ==  !=  &&  ||
,  ;  :  .  |  ->  ...  (  )  {  }  [  ]
```

A UTF-8 byte-order mark at the start of a file is ignored.

---

## 2. Grammar

Written in EBNF. `{ x }` means zero or more, `[ x ]` means optional.

```ebnf
program     = { statement } ;

statement   = letStmt
            | fnDecl
            | returnStmt
            | whileStmt
            | forStmt
            | breakStmt
            | continueStmt
            | block
            | exprStmt ;

letStmt     = "let" identifier "=" expression [ ";" ] ;
fnDecl      = "fn" identifier params block ;
returnStmt  = "return" [ expression ] [ ";" ] ;
whileStmt   = "while" "(" expression ")" block ;
forStmt     = "for" "(" identifier "in" expression ")" block ;
breakStmt   = "break" [ ";" ] ;
continueStmt= "continue" [ ";" ] ;
block       = "{" { statement } "}" ;
exprStmt    = expression [ ";" ] ;

params      = "(" [ identifier { "," identifier } ] ")" ;

expression  = assignment ;
assignment  = ( identifier | index ) assignOp assignment | logicalOr ;
assignOp    = "=" | "+=" | "-=" | "*=" | "/=" | "%=" ;
logicalOr   = logicalAnd { "||" logicalAnd } ;
logicalAnd  = equality { "&&" equality } ;
equality    = comparison { ( "==" | "!=" ) comparison } ;
comparison  = sum { ( "<" | ">" | "<=" | ">=" ) sum } ;
sum         = product { ( "+" | "-" ) product } ;
product     = unary { ( "*" | "/" | "%" ) unary } ;
unary       = ( "-" | "!" ) unary | postfix ;
postfix     = primary { call | index | member } ;

call        = "(" [ expression { "," expression } ] ")" ;
index       = "[" expression "]" ;
member      = "." identifier ;

primary     = number | string | "true" | "false" | "nil" | identifier
            | array | hash | fnLiteral | ifExpr | matchExpr | "(" expression ")" ;

array       = "[" [ expression { "," expression } ] "]" ;
hash        = "{" [ pair { "," pair } ] "}" ;
pair        = expression ":" expression ;
fnLiteral   = "fn" [ identifier ] params block ;
ifExpr      = "if" "(" expression ")" block [ "else" ( ifExpr | block ) ] ;

matchExpr   = "match" "(" expression ")" "{" arm { "," arm } [ "," ] "}" ;
arm         = pattern [ "if" expression ] "->" ( expression | block ) ;

pattern     = primaryPat { "|" primaryPat } ;
primaryPat  = "_"
            | identifier                          (* binds *)
            | [ "-" ] number | string | "true" | "false" | "nil"
            | "[" [ patElem { "," patElem } ] "]"
            | "{" [ patPair { "," patPair } ] "}" ;
patElem     = pattern | "..." identifier ;
patPair     = literalKey ":" pattern ;
```

### 2.1 Precedence

From loosest to tightest:

| Level | Operators | Associativity |
| --- | --- | --- |
| 1 | `=` | right |
| 2 | `\|\|` | left |
| 3 | `&&` | left |
| 4 | `==` `!=` | left |
| 5 | `<` `>` `<=` `>=` | left |
| 6 | `+` `-` | left |
| 7 | `*` `/` `%` | left |
| 8 | unary `-` `!` | right |
| 9 | call `f(...)` | left |
| 10 | index `a[i]`, member `a.b` | left |

Because calls and indexing bind tighter than unary operators, `-f(x)[0]` parses
as `-((f(x))[0])`.

### 2.2 The `{` ambiguity

At the start of a statement, `{` opens a **block**. In expression position it
opens a **hash literal**. Because no statement can begin with `<atom> :`, the
parser applies a two-token lookahead: `{`, then `}` or `<atom> :`, is read as a
hash literal even in statement position. Anything else stays a block. When in
doubt, wrap the hash in parentheses or bind it with `let`.

---

## 3. Values and types

| Type | Literal | Notes |
| --- | --- | --- |
| `number` | `42`, `3.14`, `1e6` | IEEE-754 double |
| `string` | `"hi"`, `'hi'` | immutable |
| `boolean` | `true`, `false` | |
| `nil` | `nil` | the absence of a value |
| `array` | `[1, 2, 3]` | mutable, heterogeneous, 0-indexed |
| `hash` | `{"k": 1}` | mutable, insertion-ordered |
| `function` | `fn(x) { x }` | closes over its defining scope |

`type(value)` returns one of `"number"`, `"string"`, `"boolean"`, `"nil"`,
`"array"`, `"hash"`, `"function"`.

Hash keys must be strings, numbers or booleans. Keys of different types never
collide: `1` and `"1"` are distinct keys.

### 3.1 Truthiness

Only `nil` and `false` are falsy. **`0`, `""`, `[]` and `{}` are all truthy.**
This is a deliberate choice: emptiness and falsehood are different questions,
and conflating them is a common source of bugs.

### 3.2 Equality

`==` is structural. Arrays and hashes compare by content, recursively; functions
compare by identity. There is no implicit conversion, so `1 == "1"` is `false`.

---

## 4. Expressions

### 4.1 Arithmetic

`+ - * / %` operate on two numbers. Division or modulo by zero is a runtime
error rather than `Infinity`/`NaN`.

### 4.2 Overloaded `+` and `*`

| Expression | Result |
| --- | --- |
| `1 + 2` | `3` |
| `"a" + "b"` | `"ab"` |
| `"n = " + 1` | `"n = 1"` — either side being a string selects concatenation |
| `[1] + [2]` | `[1, 2]` |
| `"ab" * 3` | `"ababab"` |

### 4.3 Comparison

`< > <= >=` compare two numbers or two strings (lexicographically). Mixing types
is a runtime error.

### 4.4 Logical operators

`&&` and `||` short-circuit and return **the deciding operand**, not a boolean:

```luma
nil || "fallback"   // "fallback"
"set" || boom       // "set" — `boom` is never evaluated
false && boom       // false
```

### 4.5 `if` is an expression

```luma
let label = if (n % 2 == 0) { "even" } else { "odd" };
```

A block evaluates to its last *expression* statement. An `if` with no matching
branch evaluates to `nil`.

### 4.6 Indexing

`a[i]` works on arrays, strings and hashes. Negative indices count from the end
(`a[-1]` is the last element). Reading past the end of an array or string, or
reading a missing hash key, yields `nil` — it is not an error. Writing past the
end of an array *is* an error.

`a.b` is exactly `a["b"]`.

### 4.7 Assignment

Assignment is an expression that evaluates to the assigned value. `x = 1`
requires `x` to already exist; use `let` to introduce it. This makes typos
in variable names an error instead of a silent new global.

The compound forms `+= -= *= /= %=` apply the matching operator, inheriting its
overloads — `s += "!"` concatenates, `a += [1]` appends. The target is evaluated
**once**, so `items[next()] += 1` calls `next` a single time. Applying a compound
operator to a hash key that does not exist is an error rather than an implicit
`nil`.

### 4.8 `match`

`match` tries each arm in source order and evaluates the first whose pattern
matches and whose guard passes:

```luma
match (value) {
  0 -> "zero",
  1 | 2 | 3 -> "small",
  [] -> "empty",
  [only] -> "one item: {only}",
  [head, ...rest] -> "{head} and {len(rest)} more",
  {"type": "circle", "radius": r} -> 3.14159 * r * r,
  n if n > 100 -> "big",
  _ -> "anything else"
}
```

| Pattern | Matches |
| --- | --- |
| `_` | anything, binding nothing |
| `name` | anything, binding it to `name` |
| `1`, `-2`, `"s"`, `true`, `nil` | a value structurally equal to the literal |
| `[a, b]` | an array of exactly that length, matching element-wise |
| `[a, ...rest]` | an array of at least that length; `rest` takes the remainder |
| `{"k": p}` | a hash **containing** key `k`, whose value matches `p` |
| `p \| q` | either alternative |

Notes that follow from the table:

- Hash patterns are a subset test: extra keys are ignored, but a listed key must
  be *present* — `{"a": nil}` matches `{"a": nil}` and not `{}`.
- Alternatives may not bind names. Only one of them matches, so the body could
  not tell which binding it got; the parser rejects `a | b` outright.
- Bindings are scoped to their arm, and are visible to that arm's guard.
- A guard is ordinary code: if it raises an error, the error propagates — it does
  not count as "did not match".
- If no arm matches, the program fails with `no match arm matched <value>`. There
  is no exhaustiveness checking; `_` is how you make a match total.

An arm's body is an expression, or a block when it needs several statements.

---

## 5. Statements

### 5.1 Declarations

`let name = value;` binds in the current scope, shadowing any outer binding.
`fn name(params) { ... }` declares a named function, and — unlike `let` — the
name is in scope inside the body, which is what makes recursion work.

Both declarations evaluate to `nil`. To return a function from a block, name it
on the last line:

```luma
fn make_counter() {
  let n = 0;
  fn tick() { n = n + 1; n }
  tick                     // <- the block's value
}
```

### 5.2 Loops

```luma
while (condition) { ... }
for (item in iterable) { ... }
```

`for` iterates arrays (elements), strings (characters) and hashes (`[key, value]`
pairs). `break` and `continue` behave as usual; using either outside a loop is a
runtime error.

### 5.3 Functions and scope

Scope is lexical. A function captures the environment in which it was *defined*,
not the one it is called from. Calls are strict about arity — passing the wrong
number of arguments is an error — except for callbacks invoked by builtins such
as `map`, which offer extra arguments (the index) that a shorter callback may
ignore.

---

## 6. Static analysis

A program passes through three stages: **parse → resolve → evaluate**. The
resolver runs over the complete AST before any statement executes, so a program
that fails analysis produces no output and no side effects at all.

It rejects:

| Problem | Example |
| --- | --- |
| Reference to an undeclared name | `print(total)` with no `let total` |
| Assignment to an undeclared name | `total = 1` with no `let total` |
| `break` / `continue` outside a loop | `if (x) { break; }` at the top level |
| `return` outside a function | `return 1;` at the top level |

and warns about code that can never run:

```luma
fn f() {
  return 1;
  print("unreachable");   // warning[semantic]: unreachable code
}
```

Warnings are printed but do not stop the program.

### 6.1 Scope rules the resolver enforces

A name is visible from the point of its `let`/`fn` to the end of the enclosing
block. Function *bodies* are analysed after the scope that contains them, which
is what makes both of these legal:

```luma
fn even(n) { if (n == 0) { true } else { odd(n - 1) } }   // `odd` comes later
fn odd(n)  { if (n == 0) { false } else { even(n - 1) } }

fn f() { later }      // resolved against the whole enclosing scope
let later = 1;
```

A function never inherits the loop it was defined inside, so this is an error:

```luma
while (true) {
  let f = fn() { break; };   // error: 'break' outside of a loop
}
```

### 6.2 What the resolver deliberately does not do

It is a scope and control-flow checker, not a type checker. `1 + "a"` and
`nil * 2` are decided at runtime, and a missing hash key is `nil` rather than an
error — so `shape.hieght` is a runtime failure, not a static one.

---

## 7. Errors

Every diagnostic carries a **stable code**, a phase (`syntax`, `semantic` or
`runtime`), a severity (`error` or `warning`), a message, a line/column, an
underlined span, an optional `= help:` hint and, for runtime errors, a call
stack. Codes are append-only and never reused; the full reference is
[`ERRORS.md`](ERRORS.md), and `luma explain <CODE>` prints any of them.

The standard rendering is:

```
error[E0501]: operator '*' is not defined for number and nil
 --> shapes.luma:7:9
  |
7 |   width * height
  |         ^
  = in area(...)
  = in describe(...)
```

The parser and the resolver both keep going after the first problem, so a single
run reports every syntax error and every semantic error it can find. Rendered
groups are ordered by position and end with a tally.

There is no user-level exception handling; errors abort the program. Two
resource limits produce ordinary Luma errors rather than crashing the host:
recursion deeper than 2000 frames, and loops exceeding 50,000,000 iterations.
Both are configurable through the `Interpreter` options.

---

## 8. Formatting

`luma fmt` rewrites a program in the canonical style; `luma fmt --check` reports
which files would change without touching them.

The formatter prints from the AST, so the result depends only on the program's
structure. Its rules:

- two-space indentation, one statement per line;
- spaces around binary operators, none around `.`;
- `a["b"]` prints as `a.b` when the key is a plain identifier;
- collection literals and call arguments stay on one line when they fit within
  88 columns, otherwise take one item per line with a trailing comma — except a
  trailing multi-line argument, which stays hugged to its call;
- a block holding one simple expression collapses to `{ … }`;
- `match` takes one arm per line;
- the expression that gives a block its value keeps no semicolon, the way Rust
  writes a tail expression — but an assignment keeps one, since it is written
  for its effect;
- blank lines the author wrote are preserved, collapsed to at most one;
- comments are preserved: an own-line comment stays above the statement it
  introduces, and one sharing a line with code trails that code.

Two things it deliberately does not do: reflow long operator chains, and reorder
anything.

## 9. Debugging

`luma trace <file>` runs a program while recording an execution timeline, and
the playground's **Debug** button scrubs that timeline interactively — in both
directions.

Each recorded step holds the position about to execute, a label (the source
line, `fib(3)`, or `=> 2`), the call stack innermost-first, and the scope chain
with every value rendered at capture time. Because values are stringified when
captured, stepping back shows what a mutable array *held then*, not what it
holds now.

Two consequences worth knowing:

- The program runs to completion before you can scrub it, so a trace of a
  failing program ends at the failure — which is usually where you want to start
  stepping backwards from.
- Recording stops after 20,000 steps by default (`--maxSteps` equivalent in the
  API) so a hot loop cannot exhaust memory. The result reports `truncated`.

---

## 10. Standard library

See the [builtin reference in the README](../README.md#standard-library).

Collection builtins are **non-mutating**: `push`, `pop`, `sort`, `remove` and
`merge` all return new values. In-place mutation is available through index
assignment (`a[0] = 1`, `h.key = 1`).
