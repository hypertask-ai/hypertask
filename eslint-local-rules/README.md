# Style-guide lint baseline

`npm run lint` enables the four rules exported by `style-guide.mjs` plus the
duplicate-import and repeated-name rules in `eslint.config.mjs` (HTPR-8990). The
existing Lint step in `.github/workflows/ci-tests.yml` runs that same command, so
these errors fail the required `ci-tests` check without a separate job or merge gate.

`style-guide-suppressions.json` is ESLint's native bulk-suppression baseline of
existing production violations. Only those six rules are suppressed; other lint
errors still fail. The duplicate-import rule reaches files outside `src/` too, so
its entries also cover `tests/` and `scripts/`. ESLint tracks counts per file and rule, not line
numbers: new files and counts above the baseline fail, but replacing an old
violation with another of the same rule within its allowance is not detected.

Normal lint never updates the baseline. Unused allowances do not fail lint, so
fixing old violations or linting a single file is safe. When cleaning up style
debt, shrink the baseline with the full-repository command and include its diff:

```sh
npm run lint -- --prune-suppressions
```

Do not regenerate or increase allowances to make a new violation pass. The
initial baseline was generated once with these explicit rules, not `--suppress-all`:

```sh
npm run lint -- \
  --suppress-rule tailwindcss/no-custom-classname \
  --suppress-rule hypertask-style/no-raw-tailwind-colors \
  --suppress-rule hypertask-style/no-unapproved-color-literals \
  --suppress-rule hypertask-style/no-forbidden-utilities \
  --suppress-rule import/no-duplicates \
  --suppress-rule no-redeclare \
  --suppress-rule @typescript-eslint/no-redeclare
```

`import/no-duplicates` and the two `no-redeclare` rules are the cheap check that
catches a mistake before it waits on the type check, which can run out of time.
The TypeScript rule replaces the core one for `.ts`/`.tsx` files because only it
accepts overload declarations.

## Added-line token check

`npm run lint:styles -- <base-sha> <head-sha>` checks added lines independently
of the count baseline. The existing `ci-checks` job runs it against the PR
merge base and exact head, excluding production-only changes. Raw palette classes, literal colors, arbitrary text/leading values and
inline typography must use named tokens. CSS/SCSS declarations use the same
policy, with raw custom-property definitions allowed in the theme token files.
Unchanged debt and deletions pass; replacing one raw style with another fails.
The local default compares the merge base with the tracked working tree.
