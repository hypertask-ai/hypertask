## Two browser halves under one required check (HYCI-32)

> Superseded by HYCI-57: the page tests now run in four shards. The build, the
> contract, the `app-build` artifact and the Next.js cache saver stay in
> `browser-smoke-desktop`; the inbox cycle and the report-only premerge QA moved
> to `browser-smoke-flags`; the layout matrix has its own `browser-smoke-matrix`.
> Numbers and the rejected shared build are in the four-shard section below.

The browser check used to be one job that served every project in sequence. On a
production run on 2026-10-31 it took 723 s of wall clock inside a 12-minute CI
([run 41236373520](https://github.com/hypertask-ai/hypertask/actions/runs/41236373520)):
196 s building the candidate and 423 s serving it while 73 then 63 tests ran four
at a time. Eight parallel workers on that one machine was measured and rejected,
because one desktop page test failed in all three attempts.

`.github/workflows/ci-tests.yml` now runs the same checks as two jobs on two
machines, each with the proven four Chromium workers:

| Job | Owns | Projects |
| --- | --- | --- |
| `browser-smoke-desktop` | the build and the `app-build` artifact, the MCP/CLI/API contract, the inbox cycle, the report-only premerge QA | `Desktop`, `Inbox` |
| `browser-smoke-mobile` | phone pages and the layout matrix | `Mobile`, `Matrix` |

Every `npx playwright test` line names its projects with `--project`, so no
spec/project pair runs in both halves and none was dropped by the split.
`tests/browser-smoke-workflow.test.cjs` holds that contract as a table of
state runs: live-like, instant-open control, all-flags-on, inbox cycle and the
live-like inbox cycle, each with the projects that must run it.

Both halves restore and build their own candidate. A shared build job was
rejected: the phone half would then start only after the build, which serialises
the two halves behind it and gives back the wall clock the split exists to
remove. The desktop half is still the only saver of the shared Next.js cache and
the only publisher of `app-build`, so the visual comparison adds no third build.

The required ruleset context stays `browser-smoke`. That name is now a summary
job with `needs: [browser-smoke-desktop, browser-smoke-mobile]`; it is green only
when both halves are green, and a cancelled, failed or missing half never reads
as a pass. It passes `contract` and `docs_only` through from the desktop half, so
`mcp-cli-api-contract` and `visual-compare` keep their existing wiring.

The budget cost is two jobs per push. HYCI-42 took the pool to six lanes and
HYCI-45 added a second serial lane before this merged, so the merged count is 22
jobs rather than the 20 that landed ahead of it: two past the 20-job pool, which
costs nothing to wait for because the summary only becomes ready once both halves
have finished and the halves are the longest legs either way. Docs-only PRs still
start their heavy steps as skips and succeed, so their job count grows by the same
two.

Both halves start the fixture search server, so both seed steps must ask
`scripts/seed-browser-smoke.mjs` for search rows: `BROWSER_SMOKE_SEARCH_FIXTURES: '1'`
on the `fixtures` step. The desktop half keeps `MCP_CLI_API_CONTRACT: '1'` for the
MCP contract fixtures. Before this was written down, the phone half started the
search server against a `card-fixture.json` with no `searchRows`, and
[run 41244897378](https://github.com/hypertask-ai/hypertask/actions/runs/41244897378)
died in five seconds with `Missing search fixtures`. The switch used to be implied
by the MCP contract or the visual seed, so a third consumer could forget it again;
`tests/browser-smoke-workflow.test.cjs` now fails when a half starts the search
server without asking for search rows.

The desktop half's board-rail switch in `e2e/smoke/prod.spec.ts` opens the rail by
its own state instead of pressing `Control+b` blind. `Control+b` toggles the rail
(`src/components/ProviderGlobal/GloablProviders.tsx`), so the same keystroke closes
an already-open rail, and a flyout row re-renders under the pointer because its
`onMouseOver` sets the selected board. On
[run 41244897378](https://github.com/hypertask-ai/hypertask/actions/runs/41244897378)
the click landed, the rail closed through the row's own `setShowBoardManager(false)`,
and the URL still named the board being viewed. The switch now presses the shortcut
only when the rail is closed, then clicks the row once and asserts the board really
renders.

It clicks once on purpose. A rail click is a client-side `pushState`
(`src/hooks/General/useProjectQuery.ts`), so the board changes when the app applies
the new URL one render later, and on
[run 41252735437](https://github.com/hypertask-ai/hypertask/actions/runs/41252735437)
the URL named the requested board while the desktop half rendered the previous one
for the whole 15 s title wait. Repeating the click made that run pass and hid a
dropped render: a required check that retries a product bug reports green on it.
The switch therefore asserts the rendered board from the one click, so a dropped
render is red here and stays a product bug for the app to fix, the same class of
late update that HYCI-1's readiness gate covers for page loads.
