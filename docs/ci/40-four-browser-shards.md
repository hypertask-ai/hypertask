## Four browser shards under one required check (HYCI-57)

The page tests were the whole wait, and after HYCI-32 they were spread over two
machines of unequal work. On production run
[41280591758](https://github.com/hypertask-ai/hypertask/actions/runs/41280591758),
per half:

| Part | `browser-smoke-desktop` | `browser-smoke-mobile` |
| --- | --- | --- |
| job wall clock | 451 s | 561 s |
| containers, checkout, node_modules, Chromium, fixtures | 105 s | 103 s |
| build (`next build --webpack`) | 124 s | 196 s |
| page tests | 177 s | 250 s |
| upload, cache save | 20 s | none |

The check is the slower half, so 567 s, for 110 s of idle on the faster one.

The two halves became four shards on `ubuntu-latest`, each with the proven four
Chromium workers and each building its own candidate from the same warm Next.js
cache:

| Shard | Owns | Projects |
| --- | --- | --- |
| `browser-smoke-desktop` | the build and the `app-build` artifact, the Next.js cache saver, the MCP/CLI/API contract | `Desktop` |
| `browser-smoke-mobile` | phone pages | `Mobile` |
| `browser-smoke-matrix` | the layout matrix, live-like and every flag on | `Matrix` |
| `browser-smoke-flags` | every flag on both viewports, the inbox cycle, the report-only premerge QA | `Desktop`, `Mobile`, `Inbox` |

Measured on the first run of this split
([run 41282476354](https://github.com/hypertask-ai/hypertask/actions/runs/41282476354)),
from the Actions API step timings:

| Part | desktop | mobile | matrix | flags |
| --- | --- | --- | --- | --- |
| job wall clock | 379 s | 413 s | 427 s | 450 s |
| set up, containers, checkout, node_modules cache, Chromium, fixtures | 92 s | 96 s | 89 s | 79 s |
| Next.js cache restore and `next build --webpack` | 157 s | 200 s | 220 s | 219 s |
| page tests | 120 s | 112 s | 115 s | 147 s |

The whole check went from 567 s to 455 s. The remaining wait is the build, not the
pages: every shard spends 255 s to 309 s before its first page test, so the four
shards land within 71 s of each other and no further page split lowers the check
until that floor moves. That floor is the app's, not this check's: HYCI-49 measured
the same `next build --webpack` step at a 183 s median and named the lever (a
webpack-free or smaller build graph) as work for the app on board 15.

A shared build job stays rejected, now with the measured numbers. It would have to
finish before any shard's pages start, so the check would pay setup, build and then
the pages in series instead of paying them on different machines: the slowest
measured shard alone is 298 s of setup plus build before its pages, which already
outlasts the 71 s of idle the split removes.

The required ruleset context stays `browser-smoke`, a summary job with
`needs: [browser-smoke-desktop, browser-smoke-mobile, browser-smoke-matrix,
browser-smoke-flags]`. It is green only when all four shards are green, and a
cancelled, failed or missing shard never reads as a pass. `contract` and
`docs_only` still pass through from the desktop shard, so `mcp-cli-api-contract`
and `visual-compare` keep their wiring. `tests/browser-smoke-workflow.test.cjs`
still proves every spec/project pair runs exactly once and that no shard was left
without work.
