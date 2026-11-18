## Docs-only CI lane (YPER4-548 / YPER4-663)

HTPR-9450 keeps both smoke contexts as PR stubs.
This includes docs-only and source-changing PRs.
Neither stub starts services, builds, or browsers.
The real browser shards run on production pushes.
They also run nightly, using the existing scope detector.
`app-smoke-nightly.yml` runs against the event's production SHA.
Manual App Smoke requests retain their scope detector.
Visual comparison runs nightly and remains available manually.

The stricter existing `build_needed` output for `ci-tests` is unchanged: changed
unit tests still run. Its legacy docs-only exclusions remain `docs/`, `.claude/`,
`scripts/self_hosted_agent/`, non-exercising `.github/` files and root Markdown;
`.github/workflows/ci-tests.yml` and `.github/scripts/` always exercise CI. Live
settings, review and approval guards remain mandatory. No detector job is added.

The detector fetches the base/head SHAs, deepens the shallow fetch (50, 200,
1000) until `git merge-base` is visible, and diffs merge base to head with
NUL-delimited `git diff --no-renames --name-only`. Diffing the moving
production tip instead counted every later production commit as changed and
sent skill-only PRs down the full lane (YPER4 fast lane). No merge base found
means run everything; moving source into docs cannot hide a
removed source file. Its self-check covers both outputs and fail-closed cases:
`node .github/scripts/ci-change-scope.cjs --self-check` (run in CI, not here).
