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

Any other escape is a syntax error.

### 1.6 Operators and punctuation

```
=  +  -  !  *  /  %  <  >  <=  >=  ==  !=  &&  ||
,  ;  :  .  (  )  {  }  [  ]
```

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
assignment  = ( identifier | index ) "=" assignment | logicalOr ;
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
            | array | hash | fnLiteral | ifExpr | "(" expression ")" ;

array       = "[" [ expression { "," expression } ] "]" ;
hash        = "{" [ pair { "," pair } ] "}" ;
pair        = expression ":" expression ;
fnLiteral   = "fn" [ identifier ] params block ;
ifExpr      = "if" "(" expression ")" block [ "else" ( ifExpr | block ) ] ;
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

## 6. Errors

Every error carries a phase (`syntax` or `runtime`), a message, a line/column
and, for runtime errors, a call stack. The standard rendering is:

```
error[runtime]: operator '*' is not defined for number and nil
 --> shapes.luma:7:9
  |
7 |   width * height
  |         ^
  = in area(...)
  = in describe(...)
```

There is no user-level exception handling; errors abort the program. Two
resource limits produce ordinary Luma errors rather than crashing the host:
recursion deeper than 2000 frames, and loops exceeding 50,000,000 iterations.
Both are configurable through the `Interpreter` options.

---

## 7. Standard library

See the [builtin reference in the README](../README.md#standard-library).

Collection builtins are **non-mutating**: `push`, `pop`, `sort`, `remove` and
`merge` all return new values. In-place mutation is available through index
assignment (`a[0] = 1`, `h.key = 1`).
