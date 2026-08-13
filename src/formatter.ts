/**
 * The Luma source formatter — `luma fmt`.
 *
 * It prints from the AST rather than editing text, so the output is canonical:
 * whatever spacing the input had, the result depends only on the program's
 * structure. Two properties keep that honest, and both are asserted by the
 * test-suite over every example in the repository:
 *
 *   - **Idempotent** — formatting formatted code changes nothing.
 *   - **Meaning-preserving** — re-parsing the output yields the same AST.
 *
 * Comments are the reason a printer like this is more than a pretty-printer:
 * the AST does not contain them, so they are re-inserted by position. A comment
 * on its own line stays above the statement that follows it; one sharing a line
 * with code trails that code.
 */

import type {
  BlockStatement,
  Expression,
  IfExpression,
  MatchArm,
  Pattern,
  Program,
  Statement,
} from "./ast.ts";
import { Parser } from "./parser.ts";
import type { Comment, Position } from "./token.ts";

export interface FormatOptions {
  /** Spaces per indentation level. Defaults to 2. */
  indent?: number;
  /** Column to wrap collection literals at. Defaults to 88. */
  width?: number;
}

const DEFAULT_INDENT = 2;
const DEFAULT_WIDTH = 88;

/** Operators that never take surrounding spaces. */
const TIGHT = new Set(["."]);

class Printer {
  private readonly out: string[] = [];
  private readonly comments: Comment[];
  private readonly indentWidth: number;
  private readonly width: number;
  private depth = 0;
  /** Index of the next comment not yet emitted. */
  private nextComment = 0;

  constructor(comments: Comment[], options: FormatOptions) {
    this.comments = comments;
    this.indentWidth = options.indent ?? DEFAULT_INDENT;
    this.width = options.width ?? DEFAULT_WIDTH;
  }

  print(program: Program): string {
    this.statements(program.body, { blankLines: true });
    this.flushComments(Number.POSITIVE_INFINITY);

    // Collapse runs of blank lines and guarantee exactly one trailing newline.
    const text = this.out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "");
    return text === "" ? "" : `${text}\n`;
  }

  // ------------------------------------------------------------- statements

  /**
   * Print a list of statements, optionally preserving the author's blank lines
   * between them — those carry intent that the AST does not record.
   */
  private statements(
    list: Statement[],
    options: { blankLines: boolean; tail?: boolean },
  ): void {
    let previousLine = 0;
    for (const [index, statement] of list.entries()) {
      // A blank line belongs *above* any comment introducing the statement, so
      // the decision has to be made before the comments are emitted.
      if (options.blankLines && index > 0 && previousLine > 0) {
        const nextLine = this.pendingCommentLine(statement.position.line) ?? statement.position.line;
        if (nextLine - previousLine > 1) this.blank();
      }

      const lastComment = this.flushComments(statement.position.line);
      // A blank line between an introducing comment and its statement is the
      // author separating them deliberately.
      if (options.blankLines && lastComment !== null && statement.position.line - lastComment > 1) {
        this.blank();
      }

      this.statement(statement, index === list.length - 1 && options.tail === true);
      previousLine = this.lineAfter(statement);
      this.trailingComment(statement.position.line);
    }
  }

  /**
   * Print a statement.
   *
   * `isTail` marks the last statement of a block, whose value is the block's
   * value. Luma omits the semicolon there, the way Rust does, so the expression
   * that produces a result reads differently from one evaluated for effect.
   */
  private statement(node: Statement, isTail = false): void {
    switch (node.kind) {
      case "LetStatement":
        // `let ` + name + ` = ` is the text preceding the value.
        this.line(
          `let ${node.name} = ${this.expression(node.value, this.column(7 + node.name.length))};`,
        );
        return;

      case "FunctionDeclaration":
        this.line(`fn ${node.name}(${node.parameters.join(", ")}) {`);
        this.body(node.body);
        this.line("}");
        return;

      case "ReturnStatement":
        this.line(node.value === null ? "return;" : `return ${this.expression(node.value)};`);
        return;

      case "ExpressionStatement": {
        const text = this.expression(node.expression, this.column(0));
        // No semicolon on a block-shaped expression, nor on the expression that
        // gives a block its value — except an assignment, which is written for
        // its effect and reads wrong without one.
        const valuePosition = isTail && node.expression.kind !== "AssignExpression";
        this.line(valuePosition || text.endsWith("}") ? text : `${text};`);
        return;
      }

      case "BlockStatement":
        this.line("{");
        this.body(node);
        this.line("}");
        return;

      // A loop body's value is discarded, so its last statement is not in value
      // position and keeps its semicolon.
      case "WhileStatement":
        this.line(`while (${this.expression(node.condition)}) {`);
        this.body(node.body, { valuePosition: false });
        this.line("}");
        return;

      case "ForStatement":
        this.line(`for (${node.name} in ${this.expression(node.iterable)}) {`);
        this.body(node.body, { valuePosition: false });
        this.line("}");
        return;

      case "BreakStatement":
        this.line("break;");
        return;

      case "ContinueStatement":
        this.line("continue;");
        return;
    }
  }

  private body(block: BlockStatement, options: { valuePosition?: boolean } = {}): void {
    this.depth += 1;
    this.statements(block.body, {
      blankLines: true,
      tail: options.valuePosition ?? true,
    });
    // Comments sitting just before the closing brace belong inside the block.
    this.flushComments(this.lineAfter(block));
    this.depth -= 1;
  }

  // ------------------------------------------------------------ expressions

  /**
   * Render an expression.
   *
   * `column` is where the text will start, so a collection literal can tell
   * whether it fits on the remaining line. Nested expressions fall back to the
   * indentation level, which is a conservative estimate rather than exact
   * tracking — it only ever wraps something that would have been borderline.
   */
  private expression(node: Expression, column = this.depth * this.indentWidth): string {
    switch (node.kind) {
      case "NumberLiteral":
        return formatNumberLiteral(node.value);
      case "StringLiteral":
        return quote(node.value);
      case "BooleanLiteral":
        return node.value ? "true" : "false";
      case "NilLiteral":
        return "nil";
      case "Identifier":
        return node.name;

      case "TemplateLiteral": {
        const inner = node.parts
          .map((part) =>
            part.kind === "text"
              ? escapeInto(part.value)
              : `{${this.expression(part.value)}}`,
          )
          .join("");
        return `"${inner}"`;
      }

      case "ArrayLiteral":
        return this.collection(
          "[",
          node.elements.map((element) => this.expression(element)),
          "]",
          column,
        );

      case "HashLiteral":
        return this.collection(
          "{",
          node.pairs.map((pair) => `${this.expression(pair.key)}: ${this.expression(pair.value)}`),
          "}",
          column,
        );

      case "FunctionLiteral": {
        const name = node.name === null ? "" : ` ${node.name}`;
        const inline = this.inlineBlock(node.body);
        const head = `fn${name}(${node.parameters.join(", ")})`;
        return inline === null
          ? `${head} ${this.nestedBlock(node.body)}`
          : `${head} { ${inline} }`;
      }

      case "PrefixExpression":
        return `${node.operator}${this.parenthesise(node.right, node, "right")}`;

      case "InfixExpression":
      case "LogicalExpression": {
        const left = this.parenthesise(node.left, node, "left");
        const right = this.parenthesise(node.right, node, "right");
        return TIGHT.has(node.operator)
          ? `${left}${node.operator}${right}`
          : `${left} ${node.operator} ${right}`;
      }

      case "IfExpression": {
        // Try the compact form first; if the whole chain overflows the line,
        // render it again with every branch on its own lines. The rollback is
        // what makes the retry safe — the first attempt may have consumed
        // comments into the output buffer.
        const compact = this.attempt(
          () => this.ifChain(node, true),
          (text) => column + firstLineLength(text) <= this.width,
        );
        return compact ?? this.ifChain(node, false);
      }

      case "MatchExpression":
        return this.match(node.subject, node.arms);

      case "CallExpression": {
        const callee = this.parenthesise(node.callee, node, "left");
        const args = node.args.map((argument) => this.expression(argument));
        return `${callee}${this.collection("(", args, ")", column + callee.length, true)}`;
      }

      case "IndexExpression": {
        const target = this.parenthesise(node.target, node, "left");
        // `a["b"]` prints as `a.b` when the key is a plain identifier.
        return node.index.kind === "StringLiteral" && isIdentifier(node.index.value)
          ? `${target}.${node.index.value}`
          : `${target}[${this.expression(node.index)}]`;
      }

      case "AssignExpression":
        return `${this.expression(node.target)} ${node.operator ?? ""}= ${this.expression(node.value)}`;
    }
  }

  /**
   * Print `[a, b]` on one line when it fits, otherwise one item per line with a
   * trailing comma — the shape that produces clean diffs when items are added.
   */
  /**
   * Print `[a, b]` on one line when it fits, otherwise one item per line with a
   * trailing comma — the shape that produces clean diffs when items are added.
   *
   * `hugLast` keeps a trailing multi-line argument attached to its call —
   * `each(items, fn(x) { … })` reads far better than the same call exploded one
   * argument per line.
   */
  private collection(
    open: string,
    items: string[],
    close: string,
    column: number,
    hugLast = false,
  ): string {
    if (items.length === 0) return `${open}${close}`;

    const inline = `${open}${items.join(", ")}${close}`;
    const multiline = inline.includes("\n");

    if (hugLast && multiline && items.slice(0, -1).every((item) => !item.includes("\n"))) {
      return inline;
    }
    if (column + inline.length <= this.width && !multiline) return inline;

    // Items were rendered for the current depth; sitting them one level deeper
    // means every continuation line of a multi-line item shifts with them.
    const shift = " ".repeat(this.indentWidth);
    const inner = this.pad(this.depth + 1);
    const closing = this.pad(this.depth);
    const rendered = items
      .map((item) => `${inner}${item.split("\n").join(`\n${shift}`)},`)
      .join("\n");

    return `${open}\n${rendered}\n${closing}${close}`;
  }

  private match(subject: Expression, arms: MatchArm[]): string {
    const inner = this.pad(this.depth + 1);
    const closing = this.pad(this.depth);

    this.depth += 1;
    const rendered = arms.map((arm) => {
      const guard = arm.guard === null ? "" : ` if ${this.expression(arm.guard)}`;
      const body =
        arm.body.kind === "BlockStatement"
          ? this.nestedBlock(arm.body)
          : this.expression(arm.body);
      return `${inner}${this.pattern(arm.pattern)}${guard} -> ${body},`;
    });
    this.depth -= 1;

    return `match (${this.expression(subject)}) {\n${rendered.join("\n")}\n${closing}}`;
  }

  private pattern(node: Pattern): string {
    switch (node.kind) {
      case "WildcardPattern":
        return "_";
      case "BindingPattern":
        return node.name;
      case "LiteralPattern":
        return this.expression(node.value);
      case "OrPattern":
        return node.options.map((option) => this.pattern(option)).join(" | ");
      case "ArrayPattern": {
        const items = node.elements.map((element) => this.pattern(element));
        if (node.rest !== null) items.push(`...${node.rest}`);
        return `[${items.join(", ")}]`;
      }
      case "HashPattern":
        return `{${node.entries
          .map((entry) => `${this.expression(entry.key)}: ${this.pattern(entry.value)}`)
          .join(", ")}}`;
    }
  }

  private ifChain(node: IfExpression, allowInline: boolean): string {
    const head =
      `if (${this.expression(node.condition)}) ` +
      this.nestedBlock(node.consequence, allowInline);

    if (node.alternative === null) return head;
    return node.alternative.kind === "IfExpression"
      ? `${head} else ${this.ifChain(node.alternative, allowInline)}`
      : `${head} else ${this.nestedBlock(node.alternative, allowInline)}`;
  }

  /**
   * Render, and keep the result only if it passes `fits`. On rejection the
   * printer is rewound — both the output buffer and the comment cursor — so a
   * second attempt starts from exactly the same state.
   */
  private attempt(render: () => string, fits: (text: string) => boolean): string | null {
    const savedComment = this.nextComment;
    const savedOut = this.out.length;

    const text = render();
    if (fits(text)) return text;

    this.nextComment = savedComment;
    this.out.length = savedOut;
    return null;
  }

  /**
   * A block rendered inside an expression, indented relative to the current
   * line. It routes through {@link statements} so nested blocks keep their
   * comments and blank lines like any other.
   */
  private nestedBlock(block: BlockStatement, allowInline = true): string {
    const inline = allowInline ? this.inlineBlock(block) : null;
    if (inline !== null) return `{ ${inline} }`;

    const before = this.out.length;
    this.depth += 1;
    this.statements(block.body, { blankLines: true, tail: true });
    this.flushComments(this.lineAfter(block));
    this.depth -= 1;

    const lines = this.out.splice(before);
    return `{\n${lines.join("\n")}\n${this.pad(this.depth)}}`;
  }

  /** The single-statement text of a block, or null when it needs several lines. */
  private inlineBlock(block: BlockStatement): string | null {
    if (block.body.length !== 1) return null;
    const [only] = block.body;
    if (only === undefined) return null;

    // Collapsing would drop any comment living inside the braces.
    if (this.hasCommentBefore(this.lineAfter(block))) return null;

    // Only a simple expression collapses; anything with its own block would
    // nest braces on one line and read badly.
    if (only.kind !== "ExpressionStatement" && only.kind !== "ReturnStatement") return null;

    const text = this.statementText(only, only.kind === "ExpressionStatement");
    return text.includes("\n") || text.length > this.width / 2 ? null : text;
  }

  /** Render a statement to text instead of appending it to the output. */
  private statementText(statement: Statement, isTail = false): string {
    const before = this.out.length;
    this.statement(statement, isTail);
    return this.out.splice(before).map((line) => line.trimStart()).join("\n");
  }

  /**
   * Wrap a sub-expression in parentheses when the printed form would otherwise
   * reassociate. Purely structural: it compares binding powers rather than
   * trusting the input's own parentheses, which the AST does not record.
   */
  private parenthesise(
    child: Expression,
    parent: Expression,
    side: "left" | "right",
  ): string {
    const text = this.expression(child);
    return needsParentheses(child, parent, side) ? `(${text})` : text;
  }

  // --------------------------------------------------------------- comments

  /**
   * Emit every own-line comment that appears before `line`.
   * Returns the line of the first one emitted, so the caller can decide whether
   * a blank line belongs above the comment rather than above the statement.
   */
  /** Emit pending own-line comments; returns the last one's end line, if any. */
  private flushComments(line: number): number | null {
    let previousEnd: number | null = null;
    while (this.nextComment < this.comments.length) {
      const comment = this.comments[this.nextComment]!;
      if (comment.position.line >= line) break;
      this.nextComment += 1;
      if (!comment.ownLine) continue;

      // A blank line the author left between two comment blocks is meaningful.
      if (previousEnd !== null && comment.position.line - previousEnd > 1) this.blank();
      for (const text of comment.text.split("\n")) this.line(text.trim());
      previousEnd = comment.end.line;
    }
    return previousEnd;
  }

  /** True when any comment is still waiting to be emitted before `line`. */
  private hasCommentBefore(line: number): boolean {
    const next = this.comments[this.nextComment];
    return next !== undefined && next.position.line < line;
  }

  /** Line of the next own-line comment due before `line`, if there is one. */
  private pendingCommentLine(line: number): number | null {
    for (let i = this.nextComment; i < this.comments.length; i++) {
      const comment = this.comments[i]!;
      if (comment.position.line >= line) return null;
      if (comment.ownLine) return comment.position.line;
    }
    return null;
  }

  /** Append a comment that shared a line with the statement just printed. */
  private trailingComment(line: number): void {
    while (this.nextComment < this.comments.length) {
      const comment = this.comments[this.nextComment]!;
      if (comment.position.line !== line || comment.ownLine) break;
      this.nextComment += 1;
      const last = this.out.pop() ?? "";
      this.out.push(`${last} ${comment.text.trim()}`);
    }
  }

  // ----------------------------------------------------------------- output

  private line(text: string): void {
    this.out.push(text === "" ? "" : `${this.pad(this.depth)}${text}`);
  }

  private blank(): void {
    if (this.out.at(-1) !== "") this.out.push("");
  }

  private pad(depth: number): string {
    return " ".repeat(depth * this.indentWidth);
  }

  /** Last source line a statement occupies, used for blank-line preservation. */
  private lineAfter(node: { position: Position; end?: Position }): number {
    return node.end?.line ?? node.position.line;
  }

  /** Column the next expression starts at, given a prefix of `prefix` chars. */
  private column(prefix: number): number {
    return this.depth * this.indentWidth + prefix;
  }
}

// --------------------------------------------------------------- precedence

const BINDING_POWER: Record<string, number> = {
  "||": 2,
  "&&": 3,
  "==": 4,
  "!=": 4,
  "<": 5,
  ">": 5,
  "<=": 5,
  ">=": 5,
  "+": 6,
  "-": 6,
  "*": 7,
  "/": 7,
  "%": 7,
};

function powerOf(node: Expression): number {
  if (node.kind === "InfixExpression" || node.kind === "LogicalExpression") {
    return BINDING_POWER[node.operator] ?? 0;
  }
  if (node.kind === "AssignExpression") return 1;
  if (node.kind === "PrefixExpression") return 8;
  return 100;
}

/**
 * Whether a sub-expression must be parenthesised to survive a round trip.
 *
 * Lower precedence always needs them. Equal precedence needs them on the
 * *right*, because every infix operator in Luma is left-associative: dropping
 * them would turn `1 - (2 - 3)` into `1 - 2 - 3`. Even `+` is not safe to
 * reassociate — `1 + (2 + "x")` is `"12x"`, while `(1 + 2) + "x"` is `"3x"`.
 */
function needsParentheses(
  child: Expression,
  parent: Expression,
  side: "left" | "right",
): boolean {
  const parentPower = powerOf(parent);
  const childPower = powerOf(child);

  if (childPower < parentPower) return true;
  return childPower === parentPower && side === "right";
}

// ------------------------------------------------------------------ helpers

/** Width of the first line, which is what decides whether text fits inline. */
function firstLineLength(text: string): number {
  const newline = text.indexOf("\n");
  return newline === -1 ? text.length : newline;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isIdentifier(text: string): boolean {
  return IDENTIFIER.test(text);
}

function formatNumberLiteral(value: number): string {
  return Object.is(value, -0) ? "-0" : String(value);
}

const STRING_ESCAPES: Record<string, string> = {
  "\\": "\\\\",
  '"': '\\"',
  "\n": "\\n",
  "\t": "\\t",
  "\r": "\\r",
  "\0": "\\0",
  "{": "\\{",
  "}": "\\}",
};

function escapeInto(value: string): string {
  return [...value].map((character) => STRING_ESCAPES[character] ?? character).join("");
}

function quote(value: string): string {
  return `"${escapeInto(value)}"`;
}

/**
 * Format a Luma program.
 *
 * Throws the same diagnostics `parse` does — formatting requires a program the
 * parser understands, so `luma fmt` on a broken file reports why.
 */
export function format(source: string, options: FormatOptions = {}): string {
  const parser = new Parser(source);
  const program = parser.parseProgram();
  return new Printer(parser.comments, options).print(program);
}
