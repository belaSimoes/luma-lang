/**
 * Stable diagnostic codes.
 *
 * A message can be reworded; a code cannot. Codes are what let a user search
 * for a problem, an editor filter on it, and `luma explain E0201` say more than
 * fits on one line. They are append-only: a retired code is never reused, so a
 * link to it never comes to mean something else.
 *
 * The registry is also the source of `docs/ERRORS.md`, which a test keeps in
 * sync with this file.
 */

export type DiagnosticCode =
  // 01xx — lexical
  | "E0101"
  | "E0102"
  | "E0103"
  // 02xx — syntax
  | "E0201"
  | "E0202"
  | "E0203"
  // 03xx — names and scope
  | "E0301"
  | "E0302"
  // 04xx — control flow
  | "E0401"
  | "E0402"
  // 05xx — types and operations
  | "E0501"
  | "E0502"
  | "E0503"
  | "E0504"
  // 06xx — limits
  | "E0601"
  | "E0602"
  // 09xx — warnings
  | "W0901";

export interface CodeEntry {
  /** Short title, suitable for an index. */
  title: string;
  /** The long-form explanation printed by `luma explain`. */
  explanation: string;
}

export const DIAGNOSTIC_CODES: Record<DiagnosticCode, CodeEntry> = {
  E0101: {
    title: "unexpected character",
    explanation: `A character appeared that is not part of any Luma token.

Luma's operators are + - * / % = == != < > <= >= && || ! and the punctuation
, ; : . | -> ... ( ) { } [ ]. A single '&' or '|' is not an operator: use '&&'
and '||' for logic, and '|' only to separate alternatives in a match pattern.`,
  },

  E0102: {
    title: "unterminated literal",
    explanation: `A string, block comment or interpolation was opened and never closed.

Strings may not span lines — write a newline as \\n rather than pressing enter.
A block comment runs to the next '*/', and an interpolation to the matching '}'.`,
  },

  E0103: {
    title: "unknown escape sequence",
    explanation: `A backslash was followed by a character that is not an escape.

The escapes Luma understands are \\n \\t \\r \\0 \\" \\' \\\\ and, inside an
interpolated string, \\{ and \\} for literal braces. To write a lone backslash,
double it.`,
  },

  E0201: {
    title: "unexpected token",
    explanation: `The parser found a token that cannot appear where it did.

The message names what was expected. A missing semicolon is rarely the cause —
semicolons are optional between statements — so look for an unbalanced bracket
or a keyword used as a name.`,
  },

  E0202: {
    title: "invalid assignment target",
    explanation: `The left of '=' must be something that can hold a value.

Only a variable ('x = 1') or an index ('a[0] = 1', 'h.key = 1') can be assigned
to. '1 = 2' and 'f() = 2' are not assignable. If you meant to compare, use '=='.`,
  },

  E0203: {
    title: "invalid pattern",
    explanation: `A match pattern is malformed.

Patterns are: '_', a name, a literal, '[a, b]', '[first, ...rest]', '{"k": p}',
and alternatives 'p | q'. Two rules are easy to trip over — '...rest' must come
last in an array pattern, and alternatives may not bind names, because only one
of them matches and the body could not tell which binding it got.`,
  },

  E0301: {
    title: "undefined variable",
    explanation: `A name was used that no 'let', 'fn' or parameter introduced.

Luma resolves every name before running the program, so this is reported even
for a line that would never have executed. Names are visible from their
declaration to the end of the enclosing block; a function body may also use
names declared later in the enclosing scope, which is what makes mutual
recursion work.

If the name is close to one in scope, the diagnostic suggests it.`,
  },

  E0302: {
    title: "assignment to an undeclared variable",
    explanation: `Assignment updates an existing binding; it never creates one.

Write 'let total = 0;' to introduce the name, then 'total = 1;' to change it.
This rule is what turns a misspelled name into an error instead of a silent new
global that nothing ever reads.`,
  },

  E0401: {
    title: "'break' or 'continue' outside a loop",
    explanation: `These statements only mean something inside a 'while' or 'for'.

A function does not inherit the loop it was written inside: it may be called
from anywhere, so it cannot break an enclosing loop. Return a value and let the
loop act on it instead.`,
  },

  E0402: {
    title: "'return' outside a function",
    explanation: `'return' leaves the enclosing function, so it needs one.

At the top level of a program, the value of the last expression is the result —
there is nothing to return from.`,
  },

  E0501: {
    title: "operator is not defined for these types",
    explanation: `An operator was applied to operands it has no meaning for.

Luma does not coerce values. '+' adds two numbers, concatenates when either side
is a string, and joins two arrays; comparisons order two numbers or two strings.
Convert explicitly with str(), num() or bool().`,
  },

  E0502: {
    title: "value is not callable",
    explanation: `Something that is not a function was called.

Check for a name that shadows a function, or a call on the result of an
expression that returned nil — indexing a hash with a missing key yields nil.`,
  },

  E0503: {
    title: "wrong number of arguments",
    explanation: `A function was called with an argument count it does not accept.

User-defined functions are strict. Builtins that take a callback are not: they
offer extra arguments (map passes the index) and a shorter callback simply
ignores them.`,
  },

  E0504: {
    title: "invalid index or key",
    explanation: `An index or key was the wrong type, or out of bounds.

Arrays and strings are indexed by whole numbers, counting from the end when
negative. Reading past the end yields nil; writing past it is an error. Hash keys
must be a string, number or boolean.`,
  },

  E0601: {
    title: "resource limit exceeded",
    explanation: `The program hit an interpreter limit rather than crashing the host.

The defaults are 2000 nested calls and 50,000,000 loop iterations. Reaching
either almost always means unbounded recursion or a loop whose condition never
becomes false. Both limits are configurable through the Interpreter options.`,
  },

  E0602: {
    title: "no match arm matched",
    explanation: `A 'match' ran out of arms without finding one that applies.

Luma does not check exhaustiveness, so a match is total only if you make it one:
add a final '_ -> …' arm, or a binding pattern, to cover everything else.`,
  },

  W0901: {
    title: "unreachable code",
    explanation: `A statement can never be reached.

'return', 'break' and 'continue' leave the block immediately, so anything after
them in the same block is dead. This is a warning: the program still runs.`,
  },
};

/** Look a code up, returning null for an unknown one. */
export function explainCode(code: string): CodeEntry | null {
  const normalised = code.trim().toUpperCase();
  return (DIAGNOSTIC_CODES as Record<string, CodeEntry | undefined>)[normalised] ?? null;
}

export function allCodes(): DiagnosticCode[] {
  return Object.keys(DIAGNOSTIC_CODES) as DiagnosticCode[];
}
