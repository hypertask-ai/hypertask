# Style-guide lint baseline

`npm run lint` enables the four rules exported by `style-guide.mjs`. The existing
Lint step in `.github/workflows/ci-tests.yml` runs that same command, so style
errors fail the required `ci-tests` check without a separate job or merge gate.

`style-guide-suppressions.json` is ESLint's native bulk-suppression baseline of
existing production violations. Only the four style-guide rules are suppressed;
other lint errors still fail. ESLint tracks counts per file and rule, not line
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
  --suppress-rule hypertask-style/no-forbidden-utilities
```

## Added-line token check

`npm run lint:styles -- <base-sha> <head-sha>` checks added lines independently
of the count baseline. The existing `ci-checks` job runs it against the PR
merge base and exact head, excluding production-only changes. Raw palette classes, literal colors, arbitrary text/leading values and
inline typography must use named tokens. CSS/SCSS declarations use the same
policy, with raw custom-property definitions allowed in the theme token files.
Unchanged debt and deletions pass; replacing one raw style with another fails.
The local default compares the merge base with the tracked working tree.

## Design-token ratchet

The existing `local` plugin also checks raw shadows, layers, corners, pixel text
sizes, colours, and theme selectors across `src/`. Theme definition files in
`src/styles/tailwindThemes/` own raw values; components use named utilities or
whole CSS-variable references, including `shadow-[var(--elevation-card)]`.

`design-tokens-baseline.json` records existing counts per file and family. The
initial rollout snapshots production source without changing rendered styles.
Once merged, allowances can only decrease. New files have zero allowance.
Normal lint rejects both increased debt and stale allowances after a removal,
including deleted files. Generated TypeScript
files use the same exclusions in lint and inventory. After replacing raw
styles with tokens, run:

```sh
node scripts/design-token-baseline.mjs --prune
```

Commit the smaller baseline alongside the migration. This command inventories
source through the real rules and refuses any increased or moved allowance.
Normal lint never writes files. ESLint's cache fingerprint includes the rules
and baseline, so shrinking an allowance invalidates earlier green results.
