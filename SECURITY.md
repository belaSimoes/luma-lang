# Security policy

## Reporting a vulnerability

Please report security issues privately through
[GitHub's private vulnerability reporting](https://github.com/belaSimoes/luma-lang/security/advisories/new)
rather than opening a public issue. I aim to acknowledge a report within a week.

## Threat model

Luma is an interpreter: **running a Luma program means running code you trust**,
the same way `node script.js` does. It is not a sandbox, and the following are
not vulnerabilities:

- a program consuming CPU or memory up to the configured limits;
- a program printing anything it likes;
- the playground executing whatever is typed into it.

What *would* be a vulnerability:

- source that makes the interpreter escape its own limits — reaching host
  globals, the filesystem, or the network, none of which Luma exposes;
- input that crashes the host process instead of producing a Luma diagnostic
  (an uncaught non-`LumaError` exception is always a bug — see `E0601`);
- cross-site scripting in the playground, for instance source text escaping
  `escapeHtml` in `src/highlight.ts` and reaching the DOM as markup.

## Built-in limits

The interpreter bounds two resources so a runaway program fails with a
diagnostic instead of taking the host down:

| Limit | Default | Option |
| --- | --- | --- |
| Nested calls | 2,000 | `maxCallDepth` |
| Loop iterations | 50,000,000 | `maxIterations` |
| Recorded debugger steps | 20,000 | `maxSteps` |

Embedding Luma in a context where the source is untrusted means lowering these
and running it in a worker or process you can terminate. Luma has no timeout of
its own.

## Supported versions

The latest release on `main` is supported. There are no long-term support
branches.
