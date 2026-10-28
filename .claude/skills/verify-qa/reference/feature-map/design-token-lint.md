# Design-token lint ratchet

## How a customer reaches it

Indirectly, through consistent app styling. Contributors run `npm run lint`;
the existing CI lint step runs the same local plugin. This changes no screen,
route, feature flag, workflow, or required check.

## How to drive it

1. Run `node --test tests/design-tokens.test.cjs` from the merged checkout.
2. Confirm the configured ESLint rejects a raw shadow and accepts a CSS-variable
   shadow token. The real CLI cache fixture also exercises both outcomes.
3. Confirm existing per-file debt passes, new debt fails, reduced counts require
   pruning, and `node scripts/design-token-baseline.mjs --prune` never increases
   or moves an allowance.
4. Run `npm run lint` against the committed baseline. Existing source must pass
   without changing any screen to satisfy the new rules.
5. After deployment, collect the normal signed-in My Tasks doctor screenshot
   and core inbox cycle as QA 985. These prove app health, not lint enforcement.

## What usually breaks

- Raw values hide in templates, variants, inline style objects, or fallbacks.
- Conditional token styles are accidentally rejected.
- Baseline or matcher changes reuse an obsolete green ESLint cache entry.
- Token migrations remove raw values but retain their old baseline allowance.
- Whole theme-variable references are treated as hand-typed values.

## What proof to collect

- Targeted test output including the real configured ESLint and CLI cache cases.
- Full lint output with the existing per-file baseline.
- Commit and deployment identifiers, signed-in doctor screenshot, core inbox
  cycle result, and the run checklist. Keep tooling and live health evidence
  separate; a screenshot alone cannot prove lint behavior.

## Cleanup

The regression tests delete their temporary files and caches. The prune command
changes only the committed baseline; include its reduced counts with the style
migration. Do not increase allowances to make lint pass.
