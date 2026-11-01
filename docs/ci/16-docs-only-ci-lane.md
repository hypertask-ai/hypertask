## Docs-only CI lane (YPER4-548 / YPER4-663)

Required `app-smoke` and `browser-smoke` still report success when every changed
file is documentation, skills or `tests/**` outside `src/`; both browser halves
skip their heavy steps and the summary job reads their success (HYCI-32). The shared
`.github/scripts/ci-change-scope.cjs` emits `heavy_needed=false` for `docs/**`,
`.claude/**`, `skills/**`, `.agents/skills/**`, `tests/**` and Markdown outside
`src/`. Source files (even Markdown), dependency files and CI/harness code run
smoke normally. Empty/unknown diffs and detector failures run the heavy lane.
Production pushes always run everything.

App Smoke determines scope in its trusted validation job and publishes
`app-smoke: success` with `docs-only change, skipped` without starting its build
job. Browser smoke keeps its successful required job and explicit scope output,
but skips install/build/tests with a clear log line. Its PostgreSQL, Redis and
Soketi job-level services still start. Neither required workflow uses path skips.
Visual Regression keeps its narrow screen/harness path filter and excludes
Markdown; unit-test-only changes do not start it.

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
