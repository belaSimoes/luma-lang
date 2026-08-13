## What this changes

<!-- One paragraph. What behaves differently afterwards? -->

## Why

<!-- The problem this solves. Link an issue if there is one. -->

## Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] `npm run fmt:check` passes (run `npm run fmt` if not)
- [ ] New behaviour is covered by a test
- [ ] For a language change: a case in `test/resolver.test.ts`, including one in
      the `CLEAN` table if the new syntax must *not* be flagged
- [ ] For a new diagnostic: a code in `src/codes.ts` and `npm run docs`
- [ ] `docs/LANGUAGE.md` updated if the language changed
- [ ] `CHANGELOG.md` updated

## Notes for the reviewer

<!-- Anything you are unsure about, or deliberately left out. -->
