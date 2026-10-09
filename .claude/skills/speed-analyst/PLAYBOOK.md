# SPEED RUNNER playbook

Update this file in the investigation's ticket PR **after every investigation and weekly research round**, even when nothing improved. Read before choosing the next experiment. This is learned evidence, not a wishlist or another ship map. Measurements live privately under `~/.local/state/speed/`; never commit credentials, board payloads or raw traces.

## How to add a lesson

Dated entry: full ticket URL and PR/commit, question and hypothesis, conditions and exact commands, method that isolated the cause, false leads ruled out, idea tried, before/after median/p90/range/sample counts, errors and variance, result (win / no measurable difference / regression / inconclusive), rollback, and next probe. Add confirmed milliseconds to the scoreboard only for matched before/after cohorts. Update the experiment queue, including rejected ideas, so the next round does not repeat them.

Weekly research entry: date and official sources, resolved installed versions vs candidates, expected gain/cost/risk scores, proposed falsifiable experiment, product decision if any, and the chosen next step or why no experiment is justified. The owning runner gives Valentin one short weekly ticket digest via `vcc` for his review; helpers report only to that runner. Ideas that need a product choice become one plain-language Question on their own ticket, not silent upgrades.

## Seed: lessons already in merged speed PRs

Source inventory, read 2026-10-10: `gh pr list --repo hypertask-ai/hypertask --search '"[SPEED]" in:title' --state merged --limit 60 --json number,title,body,mergedAt,url`. Read PR bodies/comments, not title alone. Quoted historical figures below are not a fresh benchmark and do not imply the old PR's conditions match today's seven-path harness.

| Ticket / source | Method that found a real problem | Reported figures / outcome | Reusable lesson |
|---|---|---|---|
| https://app.hypertask.ai/detail/project-15/5927, [PR #132](https://github.com/hypertask-ai/hypertask/pull/132) | Time `indexedDB.databases()` separately from keyed open on actual browser loads | 10 reps: enumeration median 106.7ms, min 1.7/max 146.3; keyed open median 74.5ms, min 5.8/max 145.9. Removed enumeration/absent-marker read; no paired end-to-end after number in PR | Attribute browser storage overhead before changing network/cache. Check migration fallback and revocation fences, not just a warm cache hit |
| https://app.hypertask.ai/detail/project-15/6059, [PR #404](https://github.com/hypertask-ai/hypertask/pull/404) | Compare actual production-build route chunks, trace static edges into emoji data | Same-build comparison: 67 initial chunks to 66, decoded initial bytes down 514,627. No matched readiness delta published in PR | A dynamic import is not proof the data left the critical chunk; inspect build output, verify stored emoji round-trip and interaction-triggered load |
| https://app.hypertask.ai/detail/project-15/6047, [PR #221](https://github.com/hypertask-ai/hypertask/pull/221), [#224](https://github.com/hypertask-ai/hypertask/pull/224), [#227](https://github.com/hypertask-ai/hypertask/pull/227) | HAR duplicates, Suspense ancestry and shared query-key ownership | Followers/comments/preferences requested two or three times; `task-questions` about 1,500ms in the old waterfall. #227 cold before samples: last API finish 3,935 / 2,052 / 3,465ms, JS 943-944KB; no paired after in these PRs | Remove duplicate ownership first; classify requests by what feeds visible readiness. Moving hidden work after paint does not eliminate bytes; count the observation tail |
| https://app.hypertask.ai/detail/project-15/5954, [PR #172](https://github.com/hypertask-ai/hypertask/pull/172) | Isolate connection setup from a warm query and traffic-gap distribution | Fresh handshake about 45ms vs warm query about 6ms; 85/90 traffic gaps exceeded the 10s idle timeout. Keep client pools for 5min. 45ms is expected, not proven whole-page savings | Do not claim a 45ms handshake explains a >1s tail. Separate Fluid/serverless initialization, client connection setup and query latency |
| https://app.hypertask.ai/detail/project-15/5820, [PR #216](https://github.com/hypertask-ai/hypertask/pull/216) | Server-Timing on existing API handler probes | Header `total;dur=...`; 30-probe client TTFB minus handler plan, no published gain | When handler time is small but TTFB is large, investigate runtime/network before optimizing a query |
| https://app.hypertask.ai/detail/project-15/5756, [PR #23](https://github.com/hypertask-ai/hypertask/pull/23) | Empty-array input traced into unnecessary enrichment | At least six reads removed; legacy desktop p50 1,155ms / p75 2,054ms vs one v2 submit-to-visible sample 336ms (server 181ms) | Input-shape tests can prove removed work. Legacy distribution vs one differently instrumented sample is not a matched speedup |

## False leads, regressions and measurement traps

- https://app.hypertask.ai/detail/project-15/5881: [#125](https://github.com/hypertask-ai/hypertask/pull/125) ran unread queries earlier, but [#150](https://github.com/hypertask-ai/hypertask/pull/150) reverted after mobile p75 645 to 824ms (+179ms); live 20-probe p75 299 to 400ms (+101ms), no measured upside. Concurrency can increase pool contention. Reversion evidence is provisional/small-N, not a license to assume all parallel queries are bad.
- https://app.hypertask.ai/detail/project-15/6166: [#528](https://github.com/hypertask-ai/hypertask/pull/528) reports interleaved `getAll` p50 324ms/64KB versus `boardTasks` 424ms/189KB. Narrower API is not automatically faster or smaller; the proposed gain was avoiding all-board rebuilds, not request latency. Measure event-to-render with existing `latencyCanary.ts` network/long-task split ([#318](https://github.com/hypertask-ai/hypertask/pull/318)). Never score a server-side microbench as a UI win.
- https://app.hypertask.ai/detail/project-15/6072: DOM ancestor marking found a second remount after a key was removed ([#264](https://github.com/hypertask-ai/hypertask/pull/264)); p75 574ms desktop/422ms mobile were repro figures, not saved ms. Stricter readiness gating in [#267](https://github.com/hypertask-ai/hypertask/pull/267) crashed real boards and was reverted in [#291](https://github.com/hypertask-ai/hypertask/pull/291). Test switched-to layout, permissions, focus, modal close and preserved tree identity together.
- https://app.hypertask.ai/detail/project-15/6047: [#384](https://github.com/hypertask-ai/hypertask/pull/384) found the readiness rAF path dropped across tab freeze/resume; about half hard-load desktop rows had timeouts. Prior p75 excluded those rows and understated the tail. Count timeout/error rates alongside completed samples; a faster failure is not a gain.
- Shared `speed-check/measure.md` records immediate post-deploy 3x3 runs falsely reporting regressions on three of five changes. Wait at least ten minutes, retain five cold/five warm samples, use matched conditions and alternate where safe. High load, browser-version changes and different fixture/data invalidate causal conclusions.

## Milliseconds saved scoreboard

Only matched end-to-end before/after evidence earns saved milliseconds; `unproven` is not zero. Do not sum different cohorts or claim forecasts as savings.

| Ticket | Cohort / source | Before → after | Saved ms | Status |
|---|---|---|---|---|
| https://app.hypertask.ai/detail/project-15/5927 | Browser enumeration, #132, ten baseline reps | 106.7ms median → no paired after | unproven | overhead identified, after proof needed |
| https://app.hypertask.ai/detail/project-15/5954 | Connection handshake, #172 | about 45ms vs 6ms, different operations | unproven | expected gain only, not page savings |
| https://app.hypertask.ai/detail/project-15/5756 | Task create, #23 | legacy p50 1,155ms → single v2 336ms | unproven | protocol/N mismatch, no subtraction |
| https://app.hypertask.ai/detail/project-15/5881 | Mobile inbox p75, #150 | 645ms → 824ms | -179ms reported | regression signal, reverted; not a win |
| https://app.hypertask.ai/detail/project-15/6059 | Initial route bytes, #404 | 514,627 decoded bytes removed | unproven | proven byte reduction, time unavailable |

Confirmed, comparable saved-ms total in this seed: **not established**. Future entries must link private before/after summaries, commits, N, median/p90/range and QA proof. This deliberately avoids inventing savings absent from the history.

## New probes queue

| Probe | Why / owner of existing instrumentation | Experiment before addition |
|---|---|---|
| App readiness phase marks and timeout count | `src/lib/analytics/taskDetailReadiness.ts`, board/inbox readiness; #381/#384 | Compare DOM completion and app usable mark in separate profile run; add timeout regression fixture |
| Decoded JS split versus CDP wire bytes | Existing `npm run performance:budget`, bundle analyzer; #404 | Keep measured wire metric; add decoded script total only with cache and compressed/uncompressed controls |
| Realtime event-to-visible network/long-task split | `src/lib/realtime/latencyCanary.ts`, #318 | Read existing telemetry first; do not generate live writes in the daily harness |
| Query-count correlation | Existing `[n+1-detector]` in `src/lib/queryCountTracker.ts` | Use approved app log access and route/commit correlation. It reports threshold warnings, not exact counts; unavailable means unavailable, never direct DB access |
| Post-paint loading completion and failed requests | Two-second tail can leave downloads pending | Add bounded completed/pending byte counters and tests; do not extend the tail silently or compare across protocol versions |

## Weekly research seed and experiment queue

Installed seed read from `package.json` and `package-lock.json` on 2026-10-10: Node engine **24.x**, Next **16.3.6**, React **19.3.0**, Prisma/client/adapter-pg **7.10.0**, transitive node-postgres **8.22.0**, Upstash QStash **2.11.3** (manifest `^2.11.1`), Turbopuffer **2.9.0**, Vercel functions **3.9.9**. No `@neondatabase/serverless` dependency. Vercel deployed runtime/features need separate confirmation. Re-read before every round; this table is not a latest-release claim.

Official first stops: [Next releases](https://github.com/vercel/next.js/releases), [React releases](https://react.dev/blog), [Node releases](https://nodejs.org/en/blog/release), [Prisma releases](https://github.com/prisma/prisma/releases), [Neon driver releases](https://github.com/neondatabase/serverless/releases), [Vercel changelog](https://vercel.com/changelog), [Upstash QStash releases](https://github.com/upstash/qstash-js/releases), [Turbopuffer changelog](https://turbopuffer.com/changelog). Research beyond this list: [Linear engineering](https://linear.app/now), [Superhuman engineering](https://blog.superhuman.com/) and independent browser/server performance write-ups. Record specific dated articles, not a generic homepage as evidence.

These are **proposed experiments, not completed research or upgrade recommendations**. Scores are hypotheses: gain/cost/risk 1-5, priority gain/(cost×risk). Estimates stay unknown until a baseline and source support them.

| Idea | Expected gain / cost / risk; priority | Experiment and decision |
|---|---|---|
| Correlate handler time with connection/setup tails before changing a Neon driver | Unknown ms; 4/2/2 = 1.00 | Use current Server-Timing and app logs plus cold/warm five-sample fixture runs. Compare driver candidates locally under same transport and auth. No DB clients on live board content. A new service price or migration contract needs one product Question |
| New Next/React scheduling, chunking or preload technique | Unknown ms/bytes; 4/3/3 = 0.44 | Read installed-to-candidate changelogs; profile slowest route's main thread and chunks. One local experiment, same correctness and cache conditions, reject if variance hides the gain. No blanket dependency upgrade |
| Linear/Superhuman instant-navigation technique adapted to existing app caches | Unknown click-to-visible ms; 4/3/4 = 0.33 | First verify access-scoped freshness/realtime invalidation. Reuse the current authorized read model, compare cached navigation with full-content readiness, never a faster empty shell. Any visible stale-data tradeoff is a product decision |
| Vercel runtime/cache or Upstash/Turbopuffer release feature | Unknown ms/cost; 3/2/3 = 0.50 | Confirm deployed versions/config and official limits first, capture handler/queue/search baseline. One reversible test with permission-scoped results and observed cost. New spend requires one plain-language Question |

### Next weekly round record

Use a dated heading and fill the lesson format above in the relevant ticket PR. Include sources read and rejected ideas, selected experiment, result when available, next probe, scoreboard change, and a short digest for Valentin. Do not claim the queue above was already researched or tried.
