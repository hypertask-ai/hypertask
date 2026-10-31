## Two browser halves under one required check (HYCI-32)

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

The budget cost is two jobs per push: 17 becomes 19, under the plan's 20
parallel-job limit. Docs-only PRs still start their heavy steps as skips and
succeed, so their job count grows by the same two.
