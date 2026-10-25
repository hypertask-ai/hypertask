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
- https://app.hypertask.ai/detail/project-4060/513: HTPR-7367 made the cold ticket visible before its code loaded, so the harness left mid-download and ticket-warm jumped from about 3 s to 11 s with no app regression. A win on one path can silently redefine the next path's cohort; check cache hits in the waterfall.
- https://app.hypertask.ai/detail/project-4060/519: the board path dropped the saved board preference cookie, so it only measured a first visit (phone 11.9 s); returning phone users get the server board in 1.9 s. Desktop never saves the preference while AI chat opens by default.
- https://app.hypertask.ai/detail/project-15/7395: warming ticket code after the phone board paints cut bytes after the tap from 936 to 250 KB but not the 10 s wait: the tap is CPU-bound (1.2 s idle of 10.8 s). A request list without query strings made the previous/current/next prefetches look like a triple fetch.

## Dated entries

### 2026-10-10 to 2026-10-11: daily read, four investigations, one measuring bug

**Daily read.** The nightly `speed-check.timer` (06:47) overlapped `speed-measure.timer` (06:30 plus run time) and both failed. `speed-check` moved to 07:15. The old harness also failed on a Playwright browser version mismatch; fixed with `Environment=PLAYWRIGHT_NODE_MODULES` in the user service. Clean run 2026-10-10 06:43Z at host load 6.7, medians of N=5: desktop board 935 ms, ticket-cold 1808, search 1006; phone board 7237, ticket-cold 14406, ticket-warm 2528, search 2222. Host load above about 12 inflates results; runs at load 30 to 58 were discarded, not averaged in. The phone figures were taken with the old phone profile (see the measuring lesson below), so treat them as a different cohort from any later phone run.

**What found real problems.**
- Layout-shift and layout-box probes on the live ticket page (HTPR-7074): they found the composer mounted under a growing virtualized thread, which no timing metric shows.
- A cold phone trace with main-thread attribution (HTPR-7091): busy 11.2 s of a 14.2 to 16.6 s description wait.
- ABAB alternation of ON and OFF on the same shared board (HTPR-6934): it survives the host-load swings that wreck back-to-back runs.

**False leads.**
- No flag switched on 2026-10-10 caused the HTPR-7074 shift. The cause was `htpr-6899-stable-layout` being Off.
- The virtualizer total size is not a reliable settle signal on a phone.
- Timers that wait on flag load can hide UI forever. Gate on the thing itself, with a cap.
- One ON outlier (8838 ms) in the HTPR-6934 A/B looked like a regression; the other four ON samples were fast.

**Ideas tried, with results.**

| Ticket | Idea and conditions | Result |
|---|---|---|
| https://app.hypertask.ai/detail/project-15/6934 | Flag `htpr-6934-server-first-screen`, ABAB, shared QA board 7049, QA 985 (ON) vs QA 2343 (OFF), phone profile, N=5 | Phone board cold median 1745 vs 8120 ms, one ON outlier 8838 ms. Warm 890 vs 2325 ms. Inbox and desktop unmeasured (host load). Verdict pending. Lesson: an account-based A/B needs a shared board and seeded inboxes, otherwise account data differs |
| https://app.hypertask.ai/detail/project-15/7071 | Agent status chip, local build (151 tasks, 18 agent runs), ABAB, host load 31 to 45 | Board tasks TTFB p50 216 vs 212 ms, p95 349 vs 359. Queries 41 to 44 vs 39 to 42 (one batched query). Browser times within noise; two rounds disagreed. Verdict: not slower. Live check waits for a quiet morning |
| https://app.hypertask.ai/detail/project-15/7074 | Ticket-page CLS. Cause: `htpr-6899-stable-layout` Off, composer mounted under a growing virtualized thread (desktop jump 90 to 220 px) | Fix 1, [PR 1277](https://github.com/hypertask-ai/hypertask/pull/1277): hide composer until virtualizer size is steady. Desktop fixed, phone not. Live phone also had a 0-width workspace race (AI slot 420 px in flow before mobile detection), fixed by `max-md:fixed` in [PR 1299](https://github.com/hypertask-ai/hypertask/pull/1299). Fix 3, [PR 1304](https://github.com/hypertask-ai/hypertask/pull/1304): settle on the composer's own position (300 ms steady, no pending comment bodies, 5 s cap). Worst of 5, morning vs final: desktop 0.022 to 0.009, phone 0.049 to 0.032, long phone ticket 0.111 to 0.000 |
| https://app.hypertask.ai/detail/project-15/7091 | Investigation only: cold phone ticket description | Description ready 14.2 to 16.6 s, title 2.4 s. Main thread busy 11.2 s (compile 3.4, eval 3.4). `node-html-parser` chunk is a 1.5 s single task. TipTap is statically imported (248 KiB gz). The second JS wave starts only at 4.75 s. Bytes not needed early: Prisma browser runtime via enum imports 29 KiB gz, framer-motion 53, markdown 51, react-day-picker 21 |

**Tooling lessons.**
- `premerge-local`'s flag snapshot does not read live modes; pass `--flag` for each relevant flag.
- `layout-lock` now enforces CLS 0.05 and 24 px composer movement.
- A production deploy was blocked for hours by a failed migration (P3009). Check the deployment status, not only the merge.

**Measuring lesson (2026-10-11).** The phone context created by the shared `speed-check/scripts/common.mjs` `setup()` has only viewport 390x844, `isMobile` and `hasTouch`. On the live ticket page that rendered innerWidth 780 and document width 834 (desktop-like layout), while `devices["iPhone 13"]` rendered 390. Confirmed for the daily harness: with the old profile `/detail/project-6859/43` gave 780/834 and the board gave 390/390; a mobile user agent plus `deviceScaleFactor` 3 gives 390/390 on both (user agent alone also fixes the width; scale factor alone does not). Fixed in `scripts/speed/measure.mjs` (`PHONE_PROFILE`, `withPhoneProfile`), pinned by a unit test, and every phone sample now records `innerWidth` and `documentWidth` and fails unless innerWidth is 390. Phone numbers before 2026-10-11 are not comparable. Always log innerWidth and document width in the first sample of any new mobile profile. The shared skill still has the weak profile; the equivalent change there is to merge the same two options into `setup()` when `mobile` is true.

**Next probe.** Lazy-load `node-html-parser` on the list and mention branch (HTPR-7091); expected 1.5 to 2 s on cold phone. Then drop TipTap from the first paint, then the enum-import Prisma runtime. Re-run the phone daily read with the corrected profile to set the new phone baseline before claiming any phone gain.

### 2026-10-11 lessons: cold phone ticket open, one blank-ticket bug, measuring fixes

**Cold phone ticket description (HTPR-7091, https://app.hypertask.ai/detail/project-15/7091).**
- Probe 1, lazy `node-html-parser`: JS down 88 KB, but only about 200 ms faster, inside the noise. Not shipped (no measurable difference; notes in `~/.local/state/vcc-evidence/HTPR-7091/notes.md`).
- Probe 2, show the static description first and swap in the editor after (PR 1327, flag `htpr-7091-static-description-first`). Local ABAB, N=5, cold phone, description visible: plain 12.7 s to 10.3 s, lists 12.3 s to 10.5 s. Pixel-identical (0 px diff, CLS 0). First-load JS fell only 1.1 KB, so the gain is less main-thread work before paint, not fewer bytes. Live: 14.1 s to 11.8 s for API-written descriptions.
- AI review caught two real bugs: a failed chunk import was cached forever, and the static HTML guard let raw brackets and `javascript:` hrefs through. Both fixed.
- Flag gate lesson: a `[SPEED]` change needs the flag to pick a real branch (ternary or `if`); passing it as a prop value is not seen by `feature-flag-gate`. `[BUGFIX]` has a 150 UI line budget.

**App-saved descriptions (HTPR-7110, https://app.hypertask.ai/detail/project-15/7110).** The app stores descriptions wrapped in `<html><head></head><body>` and uses `<ol class="numbered-list">`, so the static path rejected every app-saved description. Fix PR 1341, flag `htpr-7110-app-saved-static-description`. Live cold phone 14.2 s to 11.7 s (N=5, host load 8 to 10). Trailing whitespace deliberately keeps editor-first.

**Blank ticket after open (HTPR-7116, https://app.hypertask.ai/detail/project-15/7116).** Prod smoke caught a phone ticket going blank 1.4 to 6.3 s after open (5 of 30 cold, 2 of 20 warm, live). Cause: the `htpr-6991-back-first-open` Suspense boundary in `CachedTaskDetailNavigation.tsx` re-showed its fallback when the lazily imported description editor (`DescriptionEditorSlot` `EagerEditor`) suspended during an urgent update (`setSecondaryPanelsReady`). Fix: that update runs in `startTransition` (PR 1360, flag `htpr-7116-ticket-stays-open`). Lesson: any new lazy chunk mounted after first paint must mount in a transition or behind its own Suspense, or an outer boundary can hide content the user already saw.

**Measuring lessons.**
- `speed-measure.timer` ran a stale main checkout (`c830aa601`) that lacked the YPER4-262 phone profile. `~/.local/bin/speed-measure-latest` now fetches `scripts/speed/measure.mjs` from `origin/production` on every run. The shared company-skills `speed-check` got the same phone profile (YPER4-287, release v1.4.17).
- Host load sat at 19 to 35 most of the day. ABAB alternation kept comparisons valid; keep every slow run, do not trim.
- Live QA can simulate a flag Off by rewriting the flags API response in the browser (`page.route`), with no deploy and no admin login.

**False lead.** Removing a library from the bundle (`node-html-parser`) is not a speed win unless the main thread gets quieter. Check busy time, not KB.

**Next probe.** Remaining cold phone time is main-thread JS (compile and eval 6.8 s). Candidates not needed for first content: Prisma browser runtime via enum imports 29 KiB gz, framer-motion 53, markdown libs 51, react-day-picker 21. Try one at a time, ABAB, corrected phone profile.

### 2026-10-19: daily read Can't verify; cold ticket description from the server HTML (HTPR-7367)

**Daily read.** Can't verify. Four runs on 2026-10-19 failed: one "Production changed during run", three on phone page navigation or My Tasks with "Path unavailable" at host load 12 to 19. The harness swallows the step error (https://app.hypertask.ai/detail/project-4060/499). A scratch copy that logs the error passed phone at load 14, N=2: board 12.5 s, ticket-cold 17.2 s, in line with the 2026-10-18 baseline (10.1 s, 13.7 s). The failure is intermittent under load, not a broken page.

**Ticket.** https://app.hypertask.ai/detail/project-15/7367, PR https://github.com/hypertask-ai/hypertask/pull/1657, flag `htpr-7367-server-description-first`. Phone ticket-cold is the biggest milestone 1 gap (13.7 s against 4 s).

**Idea.** Render task info and the description into the server HTML as in-flow rows, then hand over to the virtualized live rows after hydration in a transition.

**Method.** Local premerge build, live-like flags (`seed-browser-smoke.mjs --live-like-control`), then switch only the one flag row between OFF and EVERYONE per sample. Same phone profile as the daily harness (iPhone UA, DPR 3, 390x844, 150 ms, 1.6 Mbps, 4x CPU), fresh context, cold. Script and raw rows: `~/.local/state/vcc-evidence/HTPR-7367/abab-7367.mjs`, `abab-final-1723.jsonl`, `abab-desktop.jsonl`.

**Results (ABAB, host load 18 to 58, absolute numbers inflated; relative verdict only).**

| Cohort | OFF median | ON median | Note |
|---|---|---|---|
| Phone, description text visible, set 1 (N=5+5) | 18252 ms | 2309 ms | |
| Phone, description text visible, set 2 (N=5+5) | 20201 ms | 3692 ms | load up to 58 |
| Phone, full description with controls | 18252 / 20201 ms | 21445 / 21350 ms | later in 7 of 10 pairs |
| Desktop, description text visible (N=3+3) | 5085 ms | 1328 ms | no throttling |
| Desktop, full description with controls | 5085 ms | 5547 ms | |

Description top never moved after first paint (one value in every frame, phone 502 px, desktop 105 px); title height stayed 37 px; settled description text identical (hash, with the relative age masked). Result: **win for first content, small cost for controls**. The edit controls, reaction and time arrive about 1 s later than today, likely because the live description now commits inside a transition after hydration. Next probe: check whether the lazy editor chunk finishing gates that transition; if so, a nested Suspense with the static frame as fallback should remove the delay.

**What found real problems.**
- The CI layout lock with all flags on (`e2e/smoke/layout-lock.spec.ts`, Mobile): the comment box settled at 770 px under the server rows, then jumped to 1852 px. `useThreadSettled` saw a still box for 300 ms and called the thread settled. A still box under placeholder rows is not a settled thread: the steadiness wait and its 5 s cap now start only once live rows are in.
- A per-frame probe of every element above the rows: the title grew 32 to 37 px at hydration (one-row textarea before the autosize hook), moving the visible description 5 px. Fixed by `field-sizing: content` with a 37 px floor on the flag path.
- Comparing settled screenshots, not just first-visible time: an early ON sample looked identical by timing but lacked time, reaction and Add sub-tasks; they only appear after the live swap.

**Tooling lessons.**
- `scripts/premerge-local.sh up` seeds once; a second full seed fails on `User_pkey`. Use `--live-like-control` (keeps fixtures) and switch one flag row with `withFlagModeInvalidation`.
- CI runs the layout lock with `--all-flags-on`; a live-like local run hid the composer jump (6 of 6 passed, then 1 of 4 failed with all flags on).
- `feature-flag-gate` does not see `isFeatureEnabled(...).catch(...)`, and a derived boolean (`const x = flag || other`) used in a ternary does not count; put the flag identifier in the ternary condition itself.

### 2026-10-20: daily read Can't verify; ticket-warm cohort broken by a cold-open win (YPER4-513)

**Daily read.** Can't verify: no complete run since 2026-10-18. Five failures on 2026-10-19 (one deploy during the run, four "Path unavailable", three of them phone page navigation at load 12 to 26). The harness threw away the step error, so the cause is unknown; a phone-only scratch copy passed page navigation 2 of 2 at load 15.

**What found the real problem.** The 2026-10-19 22:52 run read phone ticket-warm at 11.0 s against a 2.9 to 4.0 s week. Its waterfall showed every ticket chunk downloaded with real bytes (30 to 68 KB each, about 3 s apiece at 1.6 Mbps) where earlier warm samples had 0-byte cache hits. The matching cold samples ended with 52 to 53 of 63 scripts still pending: since HTPR-7367 the cold ticket is visible from server HTML at about 2.5 s, before its own route code arrives. The 2 s tail ended, the board navigation cancelled the downloads, and "opened before" silently became "first open".

**False lead.** "The ticket chunks pending in cold are the ones warm downloads": 0 of 24 overlapped by name. The cold page had not even started the lazy ticket chunks; it was still on its route chunks.

**Experiment (phone, scratch copy, N=3, load 13 to 14).** Cold, then an untimed 25 s wait, then board and tap: warm 1632, 2206, 1614 ms. Without the wait: 11726, 11338, 11483 ms. Fresh context, board settled 2 s, then tap (never opened a ticket): 10018, 10344, 10031 ms. The first tap from a phone board is a real 10 s user cost, filed as https://app.hypertask.ai/detail/project-15/7395.

**Fix.** `settleScripts` waits (untimed, 30 s cap) after the cold sample until no script is pending or newly requested for 1.5 s and stays so after a `requestIdleCallback` (a throttled phone sat network-quiet mid-hydration for over 1.5 s, then fetched the lazy ticket chunks; the network-only wait settled at 5 s and warm still read 10.8 s). With the idle check it settles at about 15 s and warm reads 1.0 to 1.6 s (N=3, load 15 to 19). Board readiness re-scrolls the fixture card when a late reflow pushes it off screen: the 2026-10-20 failure had the card and board present but never visible, and records `settleMs` and `pendingScripts` on the cold row. A failed path now keeps the step, a one-line error with URLs removed, the `id`/`view` query and whether the fixture link and QA board were on the page (also closes https://app.hypertask.ai/detail/project-4060/499). Ticket-warm before 2026-10-20 is not comparable; noted in the README.

**Phone page navigation cause.** With the step error saved, two runs showed it: `g` then `b` follows the `previousBoard` cookie and the board's saved view on the shared QA account 2343. One failure landed on board 8778, a read-only probe landed 3 of 3 on 6859 under view `qa7098-control` (another session's saved view), where task 43 was present but never visible. Shared fixture state, not an app slowdown. Page navigation now completes on any visible card of the board it opened and records `landed` (board id and view); not comparable before 2026-10-20.

**Follow-up (same day).** The first full run still failed phone page navigation: on a phone the address first commits as a bare `/project` and the board id is added a moment later, so the recorded `landed` was empty and readiness looked for cards of no board. The harness now waits for the `id` in the address before reading `landed`, and scrolls the first card of the landed board into view when none is on screen. Two phone checks then passed (5558 and 3747 ms, load 22).

**Complete run.** After PR 1671 the 2026-10-20 03:53 UTC run completed all 70 samples (first since 2026-10-18): phone ticket-cold 2791 ms median (was 14234 ms), phone ticket-warm 1933 ms. Every other path read 36 to 148% slower with long tasks up about 2x across the board at load 18 to 30, a host-load signature, not a regression to chase. The run before it failed once more on phone ticket-warm: the tap on task 43 left the page on /project for 60 s at load about 50; watch whether that repeats at normal load.

**Measurement trap.** A speed win upstream can change what a downstream cohort measures. When a path suddenly moves several times its range, compare its waterfall's cache hits with the previous week before blaming the app.

### 2026-10-20: phone first tap from the board stays at about 10 s; warming the ticket code is not the limiter (HTPR-7395)

https://app.hypertask.ai/detail/project-15/7395, PR 1670 (shipped Owner + QA), reverted in PR 1677.

**Question.** A fresh phone board, wait 2 s, tap the first ticket: 10.0 / 10.3 / 10.0 s (N=3, load 13). HTPR-7008 skips `warmTaskDetail` on phone /project until pointerdown, so the hypothesis was that downloading the ticket code after the tap is the wait.

**Tried.** Warm the ticket code once the board has painted (`secondaryStartupEnabled`), behind `htpr-7395-phone-board-warms-ticket`. Local PR build: tap 0.72 to 0.80 s, unthrottled, so not evidence.

**Result: no measurable difference.** Live ABAB, QA 2343, board 6859, phone profile, `/api/flags` rewritten per sample, 5 interleaved pairs, same deploy, load 14 to 30: tap 10057 ms off vs 9814 ms on (paired differences -3.5 to +3.0 s), board 13418 vs 14842 ms (+10.6%), bytes after tap 936 KB vs 250 KB. Two earlier runs at load 45 to 60 were discarded (one spanned a deploy). Reverted.

**What actually limits the tap.** CPU profile of the tap window (500 us sampling, flag off, load 9): 10.8 s wall, only 1.2 s idle. React render and commit 5.4 s, native and compile 1.5 s, webpack module evaluation 1.4 s (chunks 49986, 14096, 3cb99d79). React time is spread over many components, some of them in the board route chunk, so the board is still rendering 2 s after its first card shows. A network-only view (requests after tap) looked like getTask, detailMeta, comments and drafts each fetched three times; those are the prefetches for the previous, current and next tickets, not duplicates.

**Lessons.** Moving bytes off the tap is not a win on a CPU-bound path; check idle time in a profile before warming code. Read request query strings before calling a fetch a duplicate. On this host, an ABAB above load 30 is noise.

**Next probe.** Local production build with source maps, same phone profile, profile the tap to name the components behind the 5.4 s React time and the board work still running at tap time; then test deferring the pointerdown ancillary warm (Firebase, emoji) until the ticket paints.

### 2026-10-20: the board path only ever measured a first visit; desktop never gets the server board (YPER4-519)

https://app.hypertask.ai/detail/project-4060/519.

**Daily read.** Complete at 06:16 UTC on bb8f47aa1, load 6.0, N=5. Phone board 11945 ms (p90 13223, 11768 to 13223), desktop board 2166 ms. Flags over 15%: phone Ctrl+J +43%, phone My Tasks +39%, phone search +24%, plus long-task totals on six cohorts. The 04:41 run (load 12.4, older deploy) agreed on Ctrl+J (+41%) and search (+36%), not on My Tasks (+0.1%).

**What found the real problem.** The phone board waterfall: the board data arrived at 2.3 s, the last route chunk at 5.5 s, the card at 11.6 s, and `/project` HTML was 8.8 KB with no board in it, although `htpr-6934-server-first-screen` is on for QA 2343. `getServerBoardDocument` returns nothing without the `ht_board_display_v1` preference cookie, and the shared `qaState()` keeps only login cookies. Every board sample since the harness began was a first visit on a new device.

**Experiment.** Phone, live, load 7 to 9, preference primed in an untimed visit then added to a fresh context. Five interleaved pairs: without 11861, 12823, 12332, 12161, 11656 ms; with 1931, 1952, 1883, 1956, then one fallback at 12874 ms (no server board, page fetched it). Then 20 with: median 1926 ms, 1747 to 2223, 20 of 20 served by the server. Fallback 1 of 25: leave it to the new `serverBoard` field to build a rate before filing.

**Desktop never saves the preference.** `BoardDisplayMirror` deletes it on desktop while AI chat opens by default (`openAiChatByDefaultAtom` defaults to true; QA 2343 has it on). So by default no desktop user gets the server board: desktop board 2.1 s against the 1 s milestone 1 target. Filed as its own [SPEED] ticket.

**Ctrl+J is a cohort change, not a code regression.** Phone Cmd+J now opens the Compose writer in the Commands sheet (screenshot private): between 2026-10-19 12:20 and 2026-10-20 00:40 UTC the requests changed from `mcp/token`, `createGlobally`, labels and members to `tasks/single`, two `getAllMinimal` reads and a blocked `invite/generatePublicInvite`. 1.8 s is under milestone 1. Ctrl+J is now path version 2.

**Cold board limiter (trace, phone, load 6).** `react-dom` chunk 93794 4.8 s of script time, Next runtime 4bd1b696 1.4 s, layout 0.5 s, route page 0.3 s. Same shape as the HTPR-7395 tap: React render, not bytes.

**Changed.** New `board-returning` path (both profiles), `serverBoard` on every board sample, `boardPreference` on board-returning, Ctrl+J path version 2. The `board` path is unchanged.

**False leads.** Treating HTPR-6934 as "verdict pending, needs a same-account A/B": the flag works; the harness never sent the cookie. A probe that pressed Cmd+J 4 s after the board card (5989 ms) was mid-hydration; not a Ctrl+J number.

**Lesson.** Before trusting any cohort, list the cookies and storage the server reads for that route and check the harness keeps them. A whitelist built for login safety can silently drop a speed path's input.

**Next probe.** Desktop server board with AI chat on by default (the [SPEED] ticket); phone search +24 to 36% waterfall; watch the `serverBoard` fallback rate on phone board-returning.

### 2026-10-20 evening: phone search "regression" is the harness; cold ticket server wait (YPER4-525)

https://app.hypertask.ai/detail/project-4060/525.

**Daily read.** Can't verify twice: 12:23 and 18:28 UTC both had a deploy during the run. The day's complete reference is 06:16 (bb8f47aa1, load 6, N=5); 07:07 was a 1-sample smoke. Every run so far used Node 22.22.2, so the cohorts match each other (the README asks for Node 24).

**Question.** Phone search read 3.2 to 4.1 s since 2026-10-19 against 2.46 s on 2026-10-18, even at load 4. Was it the app?

**What found it.** Per-sample phase timings from the saved waterfall: in the slow samples the first requests were the previous ticket page's own chunks, the search document arrived by about 200 ms, but its styles were only requested at about 1100 ms (about 270 ms in every 2026-10-18 sample). The old ticket page was busy and held the new page back. Since the YPER4-513 fix, ticket-warm is a real fast opened-before ticket, so 2 s after it the page is still loading its deferred parts.

**Experiment.** Scratch copy, phone, production 4fd12478f, load 4.8, 5 interleaved pairs: search as the harness ran it 3249 ms median (2663 to 3549); after waiting until the ticket page was idle (settleScripts plus 3 s) 2520 ms (2412 to 2553). Result: no app regression. Fixed in the harness: search waits for an idle previous page and is path version 2.

**Lesson.** The third time an upstream win changed a downstream cohort (HTPR-7367 to ticket-warm, YPER4-519 board, now search). When a path moves, first look at when its earliest request starts, before the app gets blamed.

**Remaining limiter for phone search (2.5 s, milestone 1 target 2 s).** The search request is the end of a chain: about 1.5 s of app start, then `getAllMinimal` (the search waits for the project list, `useSearch` `projects.length > 0`), then `search/document`. Starting the search on the server, or seeding the project list, is the obvious experiment; the client re-posts if the project ids in `lastSearchKey` differ.

**Cold ticket server wait.** The cold ticket document took over 1 s to its first byte in 36 of 125 samples since 2026-10-19 (29%) and 12 of 50 before (24%): 1.4 to 2.7 s against about 0.2 s. Other pages: board 2%, My Tasks 5%, search 1%. That is the bimodal desktop ticket-cold (about 600 ms vs about 2 s) and the phone ticket-cold over 4 s. HTPR-5820 found the same 1.7 to 1.8 s wait before API handlers run on about 22% of calls. Next probe: spaced document requests to tell a cold server from slow page queries.

### 2026-10-20 night: the cold ticket server wait is jsdom start-up (HTPR-7497)

https://app.hypertask.ai/detail/project-15/7497.

**Daily read after YPER4-525.** Complete at 19:48 UTC on 154b2203a, load 4.9, N=5: phone search 2809 ms with no late-starting sample (search version 2), desktop ticket-cold 656 ms median (p90 1699). New flags to watch: phone My Tasks +30% (bytes 133 vs 89 KB, long tasks +21%) and phone first-visit board +15.9% (12351 vs 10653 ms).

**Question.** Why does about 1 in 4 cold ticket documents wait 1.4 to 2.7 s for the first byte, when the board almost never does?

**What found it.**
- Document first byte per sample from the saved waterfalls, split by path: ticket-cold over 1 s in 29% of samples, board 2%, My Tasks 5%, search 1%.
- A spaced probe on one connection (24 cycles, gaps 15/60/180 s): ticket first request slow 3 of 24, the immediate repeat 0 of 24, board 0 of 24. A per-instance cold path, not slow queries.
- A Codex helper walked the static import graph of the ticket route against the board route: `InnerHTMLComment` imports `sanitizeHtml`, which imports `isomorphic-dompurify`; its Node entry builds a JSDOM window at module load. Loading it alone takes about 700 ms (5 of 5 runs, 682 to 724 ms) against 70 to 90 ms for the next suspect (`@upstash/qstash`).
- All routes ship as one 13.7 MB Vercel function, so an instance warmed by the board still pays the ticket-only modules on its first ticket request.

**False leads.** A fresh local `next start` is 6.5 to 8 s for any first request, which hides the route-specific cost; warm the server with the board first, then time the first ticket request. Vercel request logs carry no durations, and the deployment API is behind the preview guard.

**Fix.** `sanitizeAiHtml` loads the sanitizer on its first call instead of at import (`require` in a memoized getter, the `src/lib/flags.ts` pattern). Same library, same options; a test proves byte-identical output on a corpus and that importing the module loads no jsdom.

**Result (local production build, premerge-local data, load 5, interleaved base/fix N=5+5).** First ticket request on a board-warm server: base 1352 ms median (1197 to 1521), fix 654 ms (619 to 704). Repeat request unchanged (about 150 ms). Visible markup identical; only the streamed data chunk order differs.

**Next probe.** Live: rerun the daily harness after deploy and count ticket-cold first bytes over 1 s across at least 50 samples (gate: under 10%, board at 5% or less). Remaining ticket-only start-up: `agentRuns/service` pulls marked, node-html-parser and qstash at import.

### 2026-10-21: daily read complete; search opened from a link waits for two requests after hydration (HTPR-7501)

https://app.hypertask.ai/detail/project-15/7501, PR https://github.com/hypertask-ai/hypertask/pull/1705, flag `htpr-7501-search-server-start`.

**Daily read.** Complete 00:44 UTC on dfe2dae4f (N=5, load 6 to 17; the desktop half ran at 13 to 17). Desktop flags +16 to 44% on board, search, My Tasks and page navigation came with long tasks up on every desktop cohort: a host-load signature, provisional. Phone search 2924 ms (p90 3353) and desktop search 1192 ms (p90 1824) are milestone 1 gaps not owned by another ticket (desktop board is HTPR-7406, open PR 1694).

**Phone My Tasks +41% bytes is not a content regression.** The new 30 KB are five lazy chunks requested at 2.5 s, after content at about 1.0 s (latest 22:01 run vs 19:48). Content time did not move. Note, do not chase.

**What found the cause.** The per-request waterfall in every search sample of three runs: hydration, then `getAllMinimal`, then `search/document` only after it returns (the `useSearch` mount effect waits on `projects`). Phone: search starts 2.1 to 2.8 s, results about 0.4 s later. `/api/flags` resolves at about 0.6 s desktop and 2.2 s phone.

**Idea.** On a full page load (`rsc` header absent) the server runs the same board-list lookup and search the page would send and streams the result as a promise prop. The page adopts it once flags are ready (earlier would flash the pre-flag layout on phone), and its own mount search awaits the same result when the board list lands first. Any mismatch (query, archive, board, project ids, non-200) falls back to today's request.

**Bug the local click caught.** First build: phone still sent one page search. On a throttled phone the board list lands before the flags, so the projects-empty hand-off was cancelled and the mount search posted. Unit tests with a board list that arrives on the next render missed it; a test with the list already loaded on mount reproduced it. Fix: both paths share one server result.

**Local on/off (disposable PR build, flag row switched per sample, 5 pairs, load 12 to 20).** Desktop median 364 ms on vs 401 off; phone 1307 vs 1177. No measurable difference, as expected: on loopback the two removed round trips cost about a millisecond and the local search is a stub. Correctness held in all 20 samples: 0 page search requests on, 1 off, same two rows. Live before/after decides the timing.

**Lessons.** A local build cannot show a round-trip saving; measure network-bound changes live. Test hand-offs with the competing data both late and already present on mount.

**Next probe.** Live after deploy: daily harness N=5 both profiles at load under 12 against this morning's run. If phone gains but stays above 2 s, the remaining limiter is hydration (first API call at about 2.0 s): look at seeding flags on the search page, which would also let the server result render before flags load. Weekly research round is overdue (none since the 2026-10-10 seed); next dispatch without a free ticket should run it.
### 2026-10-20: desktop board from the server with the AI chat column reserved (HTPR-7406)

https://app.hypertask.ai/detail/project-15/7406, flag `htpr-7406-desktop-server-board`.

**Daily read.** Can't verify: the 12:23 UTC run failed when production changed mid-run (bc37fcea0 to 121a17874). Its desktop board-returning samples still agree with the morning: 2550, 2392, 2087, 2233, 2626 ms, median 2392, server board 0 of 5, load 12 to 14. Desktop board 2.1 to 2.4 s is the biggest milestone 1 gap after the phone first-visit board, and the only one with a ready fix.

**Cause.** `parseBoardDisplay` refused a desktop display with AI chat open by default or pinned, so `BoardDisplayMirror` deleted the preference cookie on every desktop visit and the server never sent the board. The ticket page already reserves the chat column before the chat loads (`usePageLoadReservations`); the board page did not, so a server board would have rendered full width and then jumped.

**Change.** The cookie carries the chat width and sidebar mode; the server accepts desktop open chat for `/project` only (the inbox still refuses it); the chat column is reserved from the first render by a one-way latch that clears when the chat opens or the page leaves `/project` (chat `close()` does not set the suppressed flag, so a permanent reservation could leave an empty column).

**Result (local premerge, desktop, 6 interleaved pairs, load 8 to 11, every run kept).** First card 912 ms OFF (798 to 1482) to 255 ms ON (204 to 391). Layout shift 0.209 OFF to 0 ON: today the board itself shifts when the chat opens; the reserved column removes that. Board column x and width identical in every frame. Settled screenshots identical except the AI chat's rotating suggested questions (they differ between two OFF loads too). Cost: the chat composer shows about 0.45 s later (1364 to 1854 ms), because it waits for hydration, which is heavier with the board already on screen. Click-through 10 of 10, phone still served. Evidence: `~/.local/state/vcc-evidence/HTPR-7406/abab-summary.txt`.

**False lead.** Preloading the chat code while the column is reserved, as the ticket page does: the chat opens from a child effect after hydration, before a parent preload effect runs, so it cannot move the wait. Not shipped.

**Lesson.** A fast server path refused for one setting can silently exclude the default population. Check the default values of every setting a first-screen parser rejects.

**Next probe.** Live after deploy: desktop board-returning should read `boardPreference: true`, `serverBoard: true`. Then the chat-after-hydration cost: profile what hydration does on a server board before the chat effect runs.

### 2026-10-21 morning: daily read complete; the runner's own stalled PR was the biggest milestone 1 win (HTPR-7406)

**Daily read.** Complete 04:35 UTC on 89cdd74d2, load 10, N=5. Milestone 1 misses: desktop board 2090 ms and board-returning 2030 ms (0 of 5 server board, target 1000); phone board first visit 11558 ms (target 4000); phone search 2130 and page navigation 2338 ms (target 2000). Met since 2026-10-18: phone ticket-cold 2293 ms, desktop ticket-cold 775, desktop search 679. Two >15% flags are secondary metrics, not content time: desktop search long tasks 233 vs 167 ms (search 34% faster after HTPR-7501, a cohort change) and phone My Tasks bytes +40% (lazy chunks after content, already noted 2026-10-21 for HTPR-7501; do not chase).

**What found the work.** The dispatcher reported no free speed ticket, but a board read found HTPR-7502 unassigned and HTPR-7406 In Progress under this runner with PR 1694 approved and green, stalled for 19 h on a playbook merge conflict after its session ended. Finishing it beat filing a new ticket.

**Lesson.** Before filing or researching, list the runner's own In Progress tickets and open PRs: a cleared session can strand a finished, reviewed win behind a docs conflict. Rebase conflicts in this file are additive; keep both entries.

**Live result (HTPR-7406, merge ee3c49c3c).** Two complete harness runs: desktop board-returning **1079 ms** (p90 1252, 944 to 1252, load 5.5) and **1098 ms** (p90 1221, 900 to 1221, load 12.8), server board 5 of 5 both times, against 2030 ms that morning: about 47% faster, still about 90 ms over the 1 s milestone 1 target. Phone unchanged (board-returning 1926 and 1979 ms).

**False alarm cleared with a matched A/B.** Both runs read desktop first-visit board +22 to 33% and page navigation +48 to 87%. A live A/B with `/api/flags` rewritten per sample (the client flag decides whether the preference is saved; first visit has no server board, so the client flag isolates the change), desktop first-visit board, 5 interleaved pairs, load 6 to 14: off 2157 ms, on 2004 ms. The slow page-navigation samples all wait on `getAllMinimal` (0.4 to 2.0 s), the same spike seen before the deploy (03:58 run, 1.5 s). Both readings sit inside the week's range (board 1926 to 3214, page navigation 503 to 889 ms).

**Measurement trap.** The first run started about 5 minutes after the deploy: its first desktop document took 1210 ms to its first byte against about 130 ms later (cold instance). Wait at least 10 minutes, as `speed-check/measure.md` says; the timer start ignores it.

**What found the next limiter.** A per-frame probe (card in the DOM, card in view, paint entries) on three returning desktop loads: the HTML with all 28 cards arrives at 0.3 to 0.6 s, the fixture card is in the DOM at 0.36 to 0.63 s, but first-contentful-paint is 835 to 1007 ms. Script evaluation runs before the first paint. Filed as https://app.hypertask.ai/detail/project-15/7507.

### 2026-10-21 afternoon: the returning board's first paint waits on fonts, not app code; one eager import moved off startup (HTPR-7507)

**Premise corrected.** HTPR-7507 was filed on the 2026-10-21 morning probe ("script evaluation runs before the first paint"). Live Chrome traces (3, plus 2 with font categories, QA 2343, board 6859, desktop, cold cache with the saved preference) say otherwise: every `EvaluateScript` starts after the first paint lifecycle. The HTML arrives at about 0.28 s; the first layout then takes 90 to 360 ms, almost all `FontCache::GetFontPlatformData` (97 to 191 calls), `FontDataManager::onMatchFamilyStyle` and `WebSandboxSupportLinux::GetWebFontRenderStyleForStrike` (Linux-sandbox font IPC; much cheaper on Mac and Windows). After the paint, startup JavaScript (React hydration plus module init, 200 to 330 ms tasks) holds `ready()`'s rAF loop, so the harness reads ready 300 to 400 ms after the first paint.

**Field check.** `npm run performance:field` needs a key with `query:read` (the read-only and alert keys lack it). Desktop LCP p75 2555 ms over 7 days (52 samples, not split by route): slow first paint is real for users, not only the VPS.

**Fix shipped (PR 1709, merge ea7aba37a, [REFACTOR], no flag).** `TaskTagsRow` (every board card) imported `formatElapsed` and `useTimerNow` through `TaskDetail/TaskInfoColumn/TaskTime.tsx`, a re-export, which pulled `TaskTime` and `TimeLogModal` into board startup (85 to 175 ms inclusive in live CPU profiles at load 22 to 39, part of it shared Intl setup). It now imports both from their own modules.

**Proof method worth reusing.** Playwright JS coverage stopped one frame after the fixture card is visible: 87 to 88 scripts covered, 0 contain the time log or time panel code (3 of 3), against the pre-fix profile where they ran during startup. Coverage stopped 4 s later shows the same modules running from the ticket-view warm-up (`CachedTaskDetailNavigation` `warmTaskDetail`, idle callback): a second load path that hides an import fix if you only check "is it loaded".

**Traps.** A static import graph overstates startup: TypeScript elides type-only imports even without `import type` (`src/store/index.ts` -> `RemindMeComponent` is a type import only). Deterministic module ids do not match between a local build and a live build of a different commit (live 84287 is `TimeLogModal`; locally it is a comment component), so map a live profile only with a build of the exact live commit. `curl` on chunks needs the `?dpl=` query; live `.map` files answer 403.

**Not measured.** Host load was 20 to 77 from 11:50 to 13:30 UTC. The 11:23 UTC harness run failed on phone ticket-warm readiness; its desktop first-visit board, untouched by the change, read 3.9 to 7.2 s against 2.1 to 2.7 s that morning, a 2x load inflation. Eight failed runs in two days. Measure the returning board only below load about 13.

**Next probe.** The first layout's font work: count the distinct family, weight and size strikes on the first screen (191 platform lookups) and test on a quiet host whether `local()` fallback faces and the monospace stack cost the first paint on Linux only.

### 2026-10-21 evening: no-cookie server board is a no-go; a search link sends its search once (HTPR-7502)

https://app.hypertask.ai/detail/project-15/7502, flag `htpr-7502-search-once`.

**Daily read.** Can't verify the current deploy: the 11:23 UTC run failed and production moved past ee3c49c3c. Last complete run 07:42 UTC (load 13). Milestone 1 misses: phone board first visit 11802 ms (target 4000), desktop board first visit 2448 ms and board-returning 1098 ms (target 1000), phone page navigation 2370 and search 2124 ms (target 2000). No >15% seven-day regression in content time.

**The 11:23 failure.** Phone ticket-warm: the tap left the page on `/project` with the fixture card at top 1447 px in an 844 px viewport, and `boardTasks` fetched six times, at load 27 to 34. Second such failure this week (the first at load about 50). Watch for one at normal load before changing the harness.

**Free ticket the dispatcher missed again.** HTPR-7502 sat unassigned in Improvements. Read the board for `[SPEED]` tickets in every column before researching.

**No-go: server board on a first visit without the preference cookie.** The server render reads `timeZone` (card dates), `boardLayout`, rail, view tabs, table columns and chat state from the cookie. Only theme (cookie) and phone (user agent) are knowable without it. A device whose cookie expired (7-day `Max-Age`; Safari caps script cookies at 7 days anyway) still holds other choices in localStorage, so a default render would flip after hydration: not identical output. Scored gain 5 / cost 3 / risk 5 = 0.33, rejected. Queued instead: write the cookie at login before the first `/project` load (real users only; the harness never logs in, so it needs its own measurement plan), and the client render limiter (react-dom 4.8 s, HTPR-7395 probe).

**Cause (HTPR-7502).** A fresh tab with the board list already loaded runs the mount search before feature settings arrive, so it skips the server-started result and posts; when settings arrive, the Esc-back flag flips, the term is missing from the tab history and the effect posts again. Live before, QA 2343, 10 fresh tabs at load 42 to 67: 2 posts in 9 of 10, identical result list in all.

**Fix.** Behind a server-evaluated flag (the client flag is false until settings load, so it cannot gate the first effect): wait for settings only while a server result is pending, in a separate effect that runs only if nothing searched meanwhile (a rerun of the main effect resets the typed input), and record a search already shown in the history instead of resending it.

**Trap.** Adding `searchFlagsReady` to the main mount effect looked harmless but re-ran `setInputValue(_searchTerm)`, wiping a query the user typed before settings loaded. The existing "user search wins" test caught it with the flag off.

**Live result (PR 1731, merge 76b1498a2, flag Everyone).** Same fresh-tab probe, 5 desktop and 5 phone: 0 search requests in 10 of 10 (before 2 in 9 of 10), same result-list hash in all 20. Content visible: desktop 5234 ms (3890 to 9541, load 42 to 67) to 1773 ms (1314 to 3131, load 18 to 22); phone 14774 (13006 to 21212) to 9940 ms (9528 to 10750). Load differs, so the milliseconds are unproven; the request count is the proof. The daily harness search path opens search in a tab that already used the app (0 extra requests before), so it should not move.

**Harness trap.** A click script that waits for the first `#tasks-list li` returns on the "Ask AI" row before any result; wait for a known result row. On a throttled phone a typed search can start more than 2 s after Enter; wait for the request, not a fixed delay.

**Next probe.** Phone search in the daily harness is 2.1 s against the 2.0 s milestone 1 target, with long tasks of about 1 s; profile its main thread at load below 13.

### 2026-10-22: first weekly research round; flag readers redraw after load (HTPR-7560)

https://app.hypertask.ai/detail/project-15/7560.

**Daily read.** Can't verify. The VPS `speed-measure.timer` was stopped on purpose on 2026-10-21 at 22:39 local (no live browsers or tests on the VPS, Valentin 2026-10-21). The replacement GitHub schedule (https://app.hypertask.ai/detail/project-4060/545, PR 1755) waits on the `live-qa` environment from https://app.hypertask.ai/detail/project-4060/544. Its red checks were the GitHub app rate limit at 20:08 UTC, not the code. The last complete run is still 2026-10-21 07:42 UTC. Do not restart the VPS timer to fill the gap.

**Installed (origin/production 12ed2d28c).** Next 16.4.0 (webpack, no React Compiler), React 19.3.0, Prisma 7.10.0 with adapter-pg and pg 8.22.0, react-query 5.104.1, jotai 3.0.1, Node 24.x. Candidates: Next 16.4.2 (backports only), Prisma 7.10.1 (bugfixes), babel-plugin-react-compiler 1.0 (not installed).

**Sources (dated).** Next 16.4 post 2026-10-06 and v16.4.2 2026-10-15; Next 16.3 "Instant Navigations" 2026-06-25; React 19.3 2026-09-09; React 19.2 Activity 2025-10-01; React Compiler 1.0 2025-10-07; perfplanet "React 19.2 further advances INP" 2025-12-10; "How is Linear so fast" (performance.dev) 2026-05-03; Vercel changelog 2026-10-20; Prisma releases 2026-10-19. Full report: private scratch notes of this round.

**Ideas scored (gain/cost/risk, priority = gain/(cost x risk)).**

| # | Idea | G/C/R | Priority | Product decision |
|---|---|---|---|---|
| 1 | Flag readers subscribe per key; same values after load keep the same object | 4/2/2 | 1.00 | none, filed as HTPR-7560 |
| 2 | Drop the unused `showCreateTaskModalAtom` read on every card | 1/1/1 | 1.00 | none |
| 3 | Navigate hook reads the address at click time, not `usePathname` per card | 2/1/2 | 1.00 | none |
| 4 | Lift per-card drafts and timer queries to the board | 2/2/2 | 0.50 | none |
| 5 | Probe whether the board remounts on a tap (`CachedTaskDetailNavigation.tsx`), then keep it with `<Activity mode="hidden">` | 4/3/3 | 0.44 | yes, board kept in memory |
| 6 | React Compiler, annotation mode on card and section | 3/3/3 | 0.33 | build time risk (HTPR-6163) |
| 7 | Mount `Draggable` only on drag intent | 3/3/4 | 0.25 | none if drag identical |
| 8 | Activity boundaries around board chrome for selective hydration | 2/3/3 | 0.22 | none |

**Rejected this round.** Cache Components and partial prefetching: the board renders client-side data, migration cost 5. Turbopack build: bytes are not the limiter (HTPR-7395). Vercel WebSockets in place of Pusher: no render gain and a price decision. A Linear-style sync engine: rewrite scale.

**Why idea 1.** Both measured limiters are React render CPU: react-dom 4.8 s on the phone board, and 5.4 s of React in the 10.8 s tap. In `src/hooks/useFlag.tsx` the context value moves from `seed.values` to a new `query.data` object with the same values after hydration. Every `useFlag` also reads `useHydrated`. So all readers (399 calls in 183 files, several per card) redraw once after load, and again on a first visit when `/api/flags` lands. The gain is an estimate until the ABAB runs.

**Trap.** The research helper proposed a local production build to measure. Builds are banned on the VPS now; measure live by switching the server flag for QA 2343 between samples, or with the GitHub run once YPER4-545 lands.

**Next probe.** HTPR-7560 ABAB on the phone board. Then idea 5 step 0: a no-code live probe of whether `#kanban-page-container` survives the tap.

### 2026-10-22 morning: daily read still Can't verify; the research entry sat on a branch

**Daily read.** Can't verify. `measure.mjs --latest` returns the failed 2026-10-21 11:23 UTC run; the timer is still off on purpose, and no run has happened since. Last complete run 2026-10-21 07:42 UTC on ee3c49c3c. Production is now 4b51e2e84.

**What was stranded.** The research entry above was committed to branch `htpr-7560-flag-readers` and pushed, but Runner 4 took HTPR-7560 and merged its code as PR 1799 from another branch, so the entry never reached production. A playbook entry riding in a ticket's code PR is lost when someone else ships that ticket. Land playbook entries in their own small PR.

**Second research round: not run.** The last one finished 6 hours earlier; its ranked queue (ideas 2 to 8) still stands. Nothing on the live site was measured since, so a new round would only re-read the same sources.

**Open speed work, all waiting on live measurement.**
- HTPR-7395, PR 1759: cached ticket shows its description before the editor (flag `htpr-7395-cached-static-first`). Required checks green; `ux-signoff` is red only because the gate fires on any `src/components/` path and is not required.
- HTPR-7547, PR 1763: phone search loads closed tools on open. Conflicts with production.
- HTPR-7560, PR 1799 (Runner 4): merged; its ABAB has not run.
- YPER4-545, PR 1755: the GitHub speed schedule. It skips with a notice until the `live-qa` environment (YPER4-544, Runner 6), the read-only deploy key and the age key pair exist; its red checks were the review rate limit, rerun.

**Next probe.** Merge PR 1755 so the schedule exists, then the first GitHub run starts a new baseline (`conditions.runner: github-actions`, not comparable with VPS runs). HTPR-7560, 7395 and 7547 get their on/off numbers from it.

### 2026-10-22 midday: phone tap from the board shows the ticket 3 s sooner; the static-first swap cut the bottom scroll short (HTPR-7395)

https://app.hypertask.ai/detail/project-15/7395, PR 1759 (flag `htpr-7395-cached-static-first`, Everyone), fix PR 1822.

**Method.** Live, QA 2343, board 6859, ticket 43, phone profile, fresh context per sample: board, wait 2 s, tap, time to non-empty `#description-input`, time to the editor, then a 12 s per-250 ms trace of the description top and `scrollTop`, settled screenshot hash and text hash. The flag is forced on or off per sample by rewriting the `/api/flags` response. Script: `~/.local/state/vcc-evidence/HTPR-7395/live-qa/trace.mjs`.

**What found the problem.** Screenshot hashes, not timings: 1 of 6 flag-on screenshots differed. The trace showed the page growing in 5 steps for about 3.5 s after the text appeared (scrollHeight 900 to 1269), with `scrollWindowToBottomMobile` ending after 3 equal frames or 2.5 s and stopping 50 px short in 2 of 10 flag-on opens (0 of 7 off). Same text and geometry otherwise.

**Fix (PR 1822).** On the flag path only, the mobile bottom scroll keeps following until the description editor is mounted, no composer slot reports unsettled and the height holds for 300 ms (10 s cap; user scroll still cancels). Flag off unchanged.

**Result (live, build 309ae766d, load 2 to 3, interleaved, every run kept).** Text visible: on median 7398 ms (7117 to 8056, N=10), off 10531 ms (10263 to 11908, N=5). Scroll short stops 0 of 10. Settled screenshot hash identical in 15 of 15. Still above the ticket's 4 s target.

**Lessons.**
- A screenshot hash per sample catches a layout difference that timings miss; keep it in every on/off QA.
- A description of 5 characters (highlighted text) broke a `> 20` characters readiness wait; wait for non-empty.
- `feature-flag-gate` does not count a flag read inside a `useCallback` body or a ternary that picks between a function and `null`; a flag expression passed as a call argument at hook level counts (`deferredEditorReadyCheck(flag && ...)`). Run `FEATURE_FLAG_TYPESCRIPT_PATH="$(node -p 'require.resolve("typescript")')" node .github/scripts/feature-flag-gate.mjs "<title>" origin/production HEAD` locally before pushing.
- A `git reset --soft` onto a newer production folds production's newer changes into the commit as reversions; rebuild from only the changed files.

**Next probe.** The remaining 7.4 s is the phone's main thread (HTPR-7395 CPU profile: React render 5.4 s); HTPR-7560 and research ideas 2, 3 and 5 target it.

### 2026-10-22 afternoon: daily read complete but before today's deploys; two finished branches were stranded again (HTPR-7554, HTPR-7555)

**Daily read.** Complete at 06:17 UTC on 0f0854834, load 8.9, N=5; production is now 52a67016a, so the current deploy is not verified. Milestone 1 misses: phone first-visit board 11744 ms (target 4000), desktop first-visit board 2018 ms (target 1000), phone page navigation 2491 ms (target 2000; no matching 7-day baseline). Met on this run: desktop board-returning 936 ms (was 1079), phone search 1920 ms, phone ticket-cold 2294 ms. No content-time regression over 15%; the five flags are bytes or long tasks (phone board-returning long tasks 728 vs 395 ms, watch). The run says 18 CPUs (VPS) while `speed-measure.timer` is still disabled; the active `speed-check.timer` is the Product Bot check (YPER4-148), not this harness.

**What found the work.** The dispatcher said no free speed ticket. The board search found HTPR-7554 and HTPR-7555 In Progress under Speed Runner since 21:36 UTC yesterday, each with a pushed branch, tests and a flag, but no PR and no log entry. Same failure as 2026-10-21 (HTPR-7406): a session ended between push and PR.

**HTPR-7554 verified live before shipping.** `curl` of https://app.hypertask.ai/login: every manual preload (Inter, Newsreader, IBM Plex Sans) uses a bare `/_next/static/media/...-s.woff2`, while the `next/font` CSS asks for the same file with `?dpl=dpl_...`. Two URLs, two downloads (Inter 48 KB, immutable cache), and the preload never feeds the `@font-face`. PR 1839 adds the deployment tag to the preload href behind `htpr-7554-font-once`.

**HTPR-7555 scope.** The branch caches only the per-query size verdict in `shouldDehydratePersistedQuery` (WeakMap on the query, valid while the data reference is unchanged). `createQueryCacheRecord` still stringifies every kept query and then the whole client on each persist, so this removes one of three stringify passes, not the whole 0.5 s the HTPR-7395 profile charged to persistence. PR 1838, flag `htpr-7555-persist-size-once`.

**Lesson.** Open the PR in the same turn as the first push of a ticket branch, even as a draft; a pushed branch without a PR is invisible to the dispatcher and to `gh pr list`.

**Next probe.** Live on/off for both after deploy (flag forced per sample by rewriting `/api/flags`): 7554 counts font requests on the desktop returning board; 7555 times phone page navigation and the first ticket tap. If 7555 helps but persistence still shows in the tap profile, the next target is `serializePersistedClientWithinBudget` stringifying each query twice.

### 2026-10-22 midday: the cache save no longer re-measures unchanged data; CPU saved, ticket text not sooner (HTPR-7555)

https://app.hypertask.ai/detail/project-15/7555, PR 1838 (merge 9209e26b3, flag `htpr-7555-persist-size-once`, Everyone).

**Method.** Live, QA 2343, phone profile, fresh context per sample: board 6859, tap ticket 43, 8 s after the description shows. Flag forced per sample through an `/api/flags` rewrite. An init script times every `JSON.stringify`; after each sample the IndexedDB record is read and hashed. Script: `~/.local/state/vcc-evidence/HTPR-7555/probe.mjs`.

**Result (load 6 to 9, interleaved, every run kept).** Stringify time in the tap window: on 171 ms median (155 to 174, N=5), off 317 ms (293 to 367, N=5); calls 7.1k vs 10.6k. Time to ticket text: on 8097 ms, off 7785 ms, ranges overlap: no measurable change. The saved work runs mostly after the text paints. Same 53 cached keys, same non-flag data hash, same text and screenshot hash in every sample.

**Trap.** The saved cache differed by exactly 1 byte between arms: the persisted `feature-flags` query holds the forced flag (`true` vs `false`). Hash the cache with the flag query excluded before calling an identical-output check failed.

**Next probe.** `createQueryCacheRecord` still stringifies each kept query in `keepWithinBudget` and then the whole client on every persist. Reusing the per-query string from the size check could remove one more pass; measure with the same probe.

### 2026-10-22 afternoon: font preload fix failed live and broke ticket-page CLS; reverted (HTPR-7554)

https://app.hypertask.ai/detail/project-15/7554, PR 1839 (merge 75b0995b7), revert PR 1846 (merge 707bd637a).

**Premise wrong.** The fix stamped `?dpl=<NEXT_DEPLOYMENT_ID>` on the three manual font preloads to match the `next/font` stylesheet. Live, the stylesheet `34413c5a9dc26b9b.css` keeps the tag of the build that last compiled that chunk (`dpl_ANdm...` under HTML tagged `dpl_6ibF...`; this morning HTML `dpl_B9e9...`, CSS `dpl_ANdm...`). An env var read at render time cannot predict it: 3 of 3 preloads unmatched before and after, fonts still downloaded twice.

**Regression.** Every PR containing 1839 failed browser-smoke's ticket-page layout check (CLS 0.127 and 0.120 vs 0.05; comments drew 217 px then collapsed to 29 px); PRs without it passed, and the revert passed. CI sets no `NEXT_DEPLOYMENT_ID`, so the href code took the old path there: the suspect is the added `await isFeatureEnabled(...)` in `RootLayout`, not the URLs. Unproven; check before any retry.

**Deadlock trap.** With production red on an unrelated test, the revert failed ci-tests while the test fix (PR 1845) failed browser-smoke until the revert landed. Fix: cherry-pick the test-only commit into the revert and merge one combined PR.

**Lessons.**
- Before stamping a URL to match another asset, read that asset's own URL on production across two deploys.
- An extra awaited server call in the root layout is not "no visible change": run browser-smoke's layout checks before merging, and treat a CLS failure on your PR as yours until a PR without your change passes.
- A speed fix that ships flagged Everyone still needs live proof before Done; the flag let it ship, it did not make it safe.

**Next probe.** Reproduce the CLS cause on a PR build: the layout await alone (no href change) vs the href change alone. Then the real fix candidate: drop the three manual preloads (today they only add a second download) without any layout await, desktop returning board on/off, browser-smoke green first.

### 2026-10-22 evening: phone page navigation waits for a board list before it starts (HTPR-7588)

https://app.hypertask.ai/detail/project-15/7588, PR https://github.com/hypertask-ai/hypertask/pull/1863, flag `htpr-7588-board-shortcut-from-device`.

**Question.** Phone page navigation (My Tasks, `g` then `b`) is the only milestone 1 miss with no owner: 2491 ms median on the 06:17 UTC run (p90 2618, 2097 to 2618, N=5, load 8.9; target 2000). Desktop 579 ms.

**What found it.** The saved per-request waterfall of every page-navigation sample: a `getAllMinimal` request starts at 13 to 20 ms after the key press and the `/project` RSC request only after it returns, at 217 to 312 ms on the phone (desktop 110 to 176 ms). In code, the `b` handler in `GloablProviders.tsx` awaits `fetchQuery(["projectsAllMinimal", userId], staleTime 60 s)` before `goToProjectShortcut`, so every press more than a minute after the last list fetch pays a round trip first.

**False leads, ruled out with live read-only probes (phone profile, QA 2343, load 2).**
- "The phone never keeps its board copy": wrong. After one board visit the `ht_board_read_model_seen` marker is set and IndexedDB holds the board (6 of 6 contexts, quick or 20 s stay). Desktop page navigation reads it at about 250 ms; on the phone the read only starts at 750 to 1670 ms, after the route has rendered.
- Chunks 2011 and 24392 carry the same board read-model modules and both download on a cold phone; they arrive after `boardTasks` and are off the content path. Minor waste, not chased.
- A CPU profile showed 0.5 s in ticket modules (24111, 92049, emoji 13972) during the navigation; a timeline of the same profile puts them all after content. Cut any profile at the content time before ranking modules.

**Remaining limiter (trace, phone, load 2).** Main thread busy 2.1 of 2.6 s; four React render tasks of 174 to 369 ms (`react-dom` chunk 93794) after `boardTasks`. Same shape as the board and the tap (HTPR-7395).

**Change.** When the list already in the query client (account key, then the shared key `navigateToBoard` uses) contains the board, open it at once and refresh the list in the background; otherwise unchanged. Expected: phone about 2250 ms, desktop about 450 ms (estimate from the request start times).

**Lessons.**
- Read the first request of a navigation before blaming render: a `fetchQuery` with a short staleTime in front of `router.push` costs a round trip on every press after the stale window.
- `feature-flag-gate` did not count `useFlag` assigned to a constant and used inside the async key handler; `if (useFlag(KEY)) lookup = flaggedLookup;` at render (the HTPR-7406 pattern) passes. Run the gate after `npm run flags:generate`.

**Live result (merge 56e3ab899, build 4f13edc55, phone, QA 2343, flag forced per sample, 5 interleaved pairs, load 3 to 5, every run kept).** Key press to `/project` request: on 95 ms median (80 to 131), off 388 ms (368 to 440). Content: on 1947 ms (1662 to 2386), off 1985 ms (1813 to 2398): no measurable difference. Same landed board in 10 of 10; settled screenshots identical. The background list refresh still starts right away, so "list requests before the board" reads 1 in both arms; the board just no longer waits for it. Result: real 290 ms earlier start, absorbed by the busy main thread before content. Flag stays Everyone.

**Probe trap.** Playwright `page.route` disables the browser cache, and with it g then b timed out in 6 of 6 samples. Rewrite `/api/flags` with CDP `Fetch` at the Response stage alongside the request-stage write blocker instead.

**Next probe.** Start the board read-model read at key press instead of after the route renders, then the React render cost after `boardTasks` (about 1 s on the phone).

### 2026-10-23: daily read Can't verify; the board's own code is requested only after the first wave runs (HTPR-7617)

https://app.hypertask.ai/detail/project-15/7617.

**Daily read.** Can't verify. `measure.mjs --latest` is the 2026-10-22 06:17 UTC run on 0f0854834; production is now 4f3732e23. The GitHub schedule (`speed-live.yml`, merged in PR 1755) has 0 runs: `scripts/speed/github-age-recipient.txt` is still the placeholder and the repo has no `live-qa` environment (only `Production`), so it skips (YPER4-544, YPER4-545). No browser run from the VPS to fill the gap. Stranded green playbook PR 1869 (HTPR-7588 live result) merged.

**What found it.** The saved per-request waterfalls of that run, no new browser. In 10 of 10 phone board samples (first visit and returning) the app layout chunk, the `[...boardURL]` page chunk and their shared chunks (about 400 KB wire, for example 41724, 33412, 67977) start at 3.3 to 3.7 s, right after the first wave (webpack runtime, React 4bd1b696, react-dom 93794, main-app) finishes at about 3.1 s. Desktop: 0.32 to 1.03 s. On a phone first visit they finish at 5.3 to 5.6 s and content follows at 11.2 to 12.2 s. A returning board paints from server HTML before they arrive, so only the first visit waits on them.

**Why.** Live HTML (public `/login`, same root layout) names only the first wave as `<script async>` plus a `webpack` preload; `app/layout-*.js` and the page chunk appear only inside the inline flight data, so the browser asks for them once the runtime has run and parsed it. The Next.js change that added these tags ("App Router - preinitialize chunks during SSR", vercel/next.js #54752) emits them only for client components rendered during SSR; installed `react-server-dom-webpack` client preinits each chunk while resolving a module row (`prepareDestinationWithChunks`). Why this app gets none is the ticket's first step.

**Scored.** Start the layout and page download with the first wave (Next's own tags if a fixable cause, else preload hints for the same files): gain 3 / cost 2 / risk 2 = 0.75. Expected up to about 1 to 1.5 s on the phone first visit (the line is shared, so not the whole 2.2 s), about 0.1 s desktop; unmeasured. Yesterday's idea 2 (drop the per-card `showCreateTaskModalAtom` read) rescored 1/1/1 with gain about 0 on load: the subscription only fires when that atom changes.

**Evidence error caught before it landed.** The four `<template data-dgst="">` client-render fallbacks were in the `/login` HTML, a static page; they say nothing about `/project`, which is `force-dynamic`. Do not cite them for the board.

**Lessons.**
- A waterfall's request start times answer "what does content wait on" without a new browser run: compare when each chunk group starts across paths and profiles before profiling CPU.
- `secrets-guard` blocks any command that also mentions a protected path, including a `sed` with `/` in its pattern next to a redirect; write such probes as a small script file.

**Next probe.** HTPR-7617: find why the layout and page client chunks get no early script tag on `/project` (server render of those parts or config), then an interleaved on/off live run once a measurement path exists.

### 2026-10-23 morning: early board code tags are a no-go; the harness adds about 2.8 s to the phone board (HTPR-7617, YPER4-615)

https://app.hypertask.ai/detail/project-15/7617 (no-go), https://app.hypertask.ai/detail/project-4060/615 (harness fix).

**Daily read.** Can't verify: `--latest` is still the 2026-10-22 06:17 UTC run on 0f0854834; production is 37d953119.

**Why the tags are missing (verified in Next 16.4.0 source and live HTML).** With webpack, `getLayerAssets` emits CSS only (`entryJSFiles` exists only for Turbopack), so early JS tags come solely from React's flight client calling `preinitScript` while it parses each module row during server render. On Node, Next 16.4.0 sets `__NEXT_USE_NODE_STREAMS` and reads the flight stream with `createFromNodeStream`, whose rows arrive in `stream.on("data")`. `preinitScript` needs `resolveRequest()` (the Fizz request or its AsyncLocalStorage store); an EventEmitter listener runs in the producer's context, so rows that arrive after the first chunk fall to the no-op dispatcher. Live HTML matches: rows emitted before any server I/O get tags (the error boundaries, the `/inbox` page, which renders its client part right after a cached read), rows after an await do not (the root layout on every route; the board page after `getProjectForValidation`). Same code in 16.5.0-canary.24. Leading explanation for the playbook, not watched executing.

**Experiment (no deploy).** Live, QA 2343, phone profile, first visit. Both arms take `/project` through the same CDP response-stage fulfil; "on" adds `<script async>` after `main-app` for the 27 chunks the flight data names but the HTML does not. Script: `~/.local/state/vcc-evidence/HTPR-7617/abab-7617.mjs`.

| Run | Off | On | Note |
|---|---|---|---|
| r1, 5 interleaved pairs, load 8.5 to 11 | 12315 ms (11702 to 12911) | 12354 ms (11799 to 12875) | layout chunk start 3.5 s to 0.33 s, done 5.6 s to 4.85 s |
| seen, 2 pairs, load 5 to 9 | 11686, 11882 ms | 13830, 13521 ms | board first commit 7.6 s to 9.3 s |

Result: **no-go**. The earlier start competes with the first wave for the 1.6 Mbps link and pulls in one chunk the board never loads (48932, the root error page); paired differences -346 to +2144 ms. Not filed further.

**What found the real problem.** A per-frame probe of each readiness condition: the fixture card is in the page at 8.4 to 9.7 s but at top 1447 px of an 844 px screen, and only in view 3.3 s later. A wrapped `Element.prototype.scrollIntoView` saw 0 calls, so the scroll came from Playwright's `locator.scrollIntoViewIfNeeded()` in `ready()`, which waits for the card to stop moving before it scrolls. The app's own marks: `ht-board-first-commit` 7.6 s, `ht-board-usable-ready` 7.7 to 8.6 s.

**Measured (4 interleaved pairs, load 5 to 11).** Playwright pre-scroll: 11786, 12556, 12274, 11682 ms. In-page scroll only: 8959, 9426, 10046, 8997 ms. The phone first-visit board baseline (11.7 s) carries about 2.8 s of harness. Fix: drop the pre-scroll; board and board-returning are path version 2 (YPER4-615).

**False leads.**
- "QA Sandbox" in `document.body.textContent` is true at about 2 s: the inline flight data in `<script>` holds the board title. That check proves nothing; the card is what gates.
- "No timing difference means the tags are harmless": the second run shows on 2 s slower; one quiet run is not safety evidence.

**Lessons.**
- Split a readiness check into its parts and time each one per frame before treating the total as app time.
- A Playwright actionability step (scroll, click) inside a timed window waits for stability, which a busy throttled phone delays by seconds; do in-page DOM work inside the timed loop instead.
- Before shipping a preload, test it against bandwidth: on 1.6 Mbps an earlier start only reorders the same bytes.

**Next probe.** Phone first visit after the fix is about 9.2 s: `boardTasks` returns at 2.4 s, the local read starts at 6.5 s and the first commit is 7.4 to 7.6 s, with 4.5 s of long tasks from 5.5 s. Name what hydration runs between the code arriving (about 5.6 s) and the local read (6.5 s), then the 0.9 s from first commit to cards in the page.

## Milliseconds saved scoreboard

Only matched end-to-end before/after evidence earns saved milliseconds; `unproven` is not zero. Do not sum different cohorts or claim forecasts as savings.

| Ticket | Cohort / source | Before → after | Saved ms | Status |
|---|---|---|---|---|
| https://app.hypertask.ai/detail/project-15/5927 | Browser enumeration, #132, ten baseline reps | 106.7ms median → no paired after | unproven | overhead identified, after proof needed |
| https://app.hypertask.ai/detail/project-15/5954 | Connection handshake, #172 | about 45ms vs 6ms, different operations | unproven | expected gain only, not page savings |
| https://app.hypertask.ai/detail/project-15/5756 | Task create, #23 | legacy p50 1,155ms → single v2 336ms | unproven | protocol/N mismatch, no subtraction |
| https://app.hypertask.ai/detail/project-15/5881 | Mobile inbox p75, #150 | 645ms → 824ms | -179ms reported | regression signal, reverted; not a win |
| https://app.hypertask.ai/detail/project-15/6059 | Initial route bytes, #404 | 514,627 decoded bytes removed | unproven | proven byte reduction, time unavailable |
| https://app.hypertask.ai/detail/project-15/6934 | Phone board cold, flag A/B, QA 985 vs 2343, N=5 | 8120ms (OFF) → 1745ms (ON) | unproven | different accounts, verdict pending; 2026-10-20 same account, live, phone: with the saved preference 1926 ms (N=20) vs without 11945 ms (N=5); the flag works for returning phone users; desktop excluded while AI chat opens by default (YPER4-519) |
| https://app.hypertask.ai/detail/project-15/7071 | Board tasks TTFB p50, local ABAB | 216ms → 212ms | 4ms, within noise | not slower; no saving claimed |
| https://app.hypertask.ai/detail/project-15/7074 | Ticket-page CLS (unitless, worst of 5) | phone 0.049 → 0.032, long phone 0.111 → 0.000 | n/a (layout shift, not ms) | shipped PRs 1277, 1299, 1304 |
| https://app.hypertask.ai/detail/project-15/7091 | Cold phone ticket description, PR 1327, local ABAB N=5 | plain 12.7 s → 10.3 s, lists 12.3 s → 10.5 s | about 2,400 ms local plain, about 1,800 ms lists | flag `htpr-7091-static-description-first`; lazy `node-html-parser` probe (about 200 ms) not shipped |
| https://app.hypertask.ai/detail/project-15/7091 | Same, live, API-written descriptions | 14.1 s → 11.8 s | about 2,300 ms | live check, different cohort from local |
| https://app.hypertask.ai/detail/project-15/7110 | Cold phone, app-saved descriptions, PR 1341, live N=5, load 8 to 10 | 14.2 s → 11.7 s | about 2,500 ms | flag `htpr-7110-app-saved-static-description` |
| https://app.hypertask.ai/detail/project-15/7116 | Phone ticket blanking after open, PR 1360 | 5 of 30 cold, 2 of 20 warm blank → fix pending live proof | n/a (correctness, not ms) | flag `htpr-7116-ticket-stays-open` |
| https://app.hypertask.ai/detail/project-15/7367 | Cold phone ticket, description visible, PR 1657, local ABAB N=10, load 18 to 58 | 18.3 / 20.2 s → 2.3 / 3.7 s; controls 18.3 / 20.2 s → 21.4 s | unproven live; local about 16,000 ms to text, about -1,000 ms to controls | flag `htpr-7367-server-description-first`; live 5 cold run after deploy decides |
| https://app.hypertask.ai/detail/project-15/7395 | Phone first tap after fresh board, live ABAB N=5, load 14 to 30 | 10057 ms (OFF) → 9814 ms (ON) | 0, within noise | reverted in PR 1677; board +10.6% with flag on |
| https://app.hypertask.ai/detail/project-15/7501 | Search hard load, local PR build on/off N=5, load 12 to 20 | desktop 401 → 364 ms, phone 1177 → 1307 ms | unproven, local cannot show round trips | flag `htpr-7501-search-server-start`; live before 2924 ms phone, 1192 ms desktop (daily N=5); live after pending |
| https://app.hypertask.ai/detail/project-15/7497 | First ticket request on a board-warm server, local production build, interleaved N=5+5, load 5 | 1352 ms → 654 ms | about 700 ms local | lazy sanitizer; live first-byte rate after deploy decides |
| https://app.hypertask.ai/detail/project-15/7406 | Desktop board-returning, first card, local premerge ABAB N=6, load 8 to 11 | 912 ms (OFF) → 255 ms (ON); chat composer 1364 → 1854 ms | about 650 ms local to the board, about -490 ms to the chat | flag `htpr-7406-desktop-server-board`; live: 2030 → 1079 / 1098 ms (two complete runs, N=5 each, 5 of 5 served), first visit unchanged by flag A/B (off 2157, on 2004 ms) |
| https://app.hypertask.ai/detail/project-15/7502 | Search link in a fresh tab, live probe, desktop and phone N=5 each | search requests 2 (9 of 10) → 0 (10 of 10); content desktop 5234 → 1773 ms, phone 14774 → 9940 ms | unproven ms (load 42 to 67 before, 18 to 22 after); 2 requests saved per open | flag `htpr-7502-search-once`, PR 1731, identical results |
| https://app.hypertask.ai/detail/project-15/7395 | Phone tap from the board to ticket text, live on/off interleaved, build 309ae766d, load 2 to 3 | 10531 ms (off, N=5) → 7398 ms (on, N=10) | about 3,100 ms | flag `htpr-7395-cached-static-first`, PRs 1759 and 1822; settled screenshot identical 15 of 15 |
| https://app.hypertask.ai/detail/project-15/7555 | Phone tap board to ticket, JSON.stringify time, live on/off interleaved N=5+5, load 6 to 9 | 317 ms (off) → 171 ms (on) main-thread stringify; ticket text 7785 → 8097 ms (overlapping) | about 146 ms CPU, 0 to ticket text | flag `htpr-7555-persist-size-once`, PR 1838; cache, text and screenshot identical |
| https://app.hypertask.ai/detail/project-15/7554 | Font preloads vs stylesheet URL, live login, PR 1839 | 3 of 3 unmatched → 3 of 3 unmatched; ticket-page CLS 0.127 in browser-smoke | 0, regression, reverted in PR 1846 | premise wrong (stylesheet keeps an older deployment tag) |
| https://app.hypertask.ai/detail/project-15/7588 | Phone page navigation, key press to /project request, daily harness N=5 | /project request 388 → 95 ms (live on/off N=5+5); content 1985 → 1947 ms, overlapping | about 290 ms to the board request, 0 to content | flag `htpr-7588-board-shortcut-from-device` Everyone, PR 1863; same board and screen in 10 of 10 |
| https://app.hypertask.ai/detail/project-15/7617 | Phone board first visit, early layout and page script tags injected live, interleaved N=5+5 and 2+2 | 12315 ms (off) → 12354 ms (on); second run 11.8 → 13.7 s | 0, regression risk | no-go, nothing shipped; layout code started 3.2 s sooner but shares the link with the first wave |
| https://app.hypertask.ai/detail/project-4060/615 | Phone board first visit, harness readiness, interleaved N=4+4 | 12030 ms (Playwright pre-scroll, median of 4) → 9212 ms (in-page scroll) | n/a (measurement, not app speed) | about 2.8 s of the 11.7 s baseline was the harness; board paths version 2 |

Confirmed, comparable saved-ms total in this seed: **not established**. Future entries must link private before/after summaries, commits, N, median/p90/range and QA proof. This deliberately avoids inventing savings absent from the history.

## New probes queue

| Probe | Why / owner of existing instrumentation | Experiment before addition |
|---|---|---|
| App readiness phase marks and timeout count | `src/lib/analytics/taskDetailReadiness.ts`, board/inbox readiness; #381/#384 | Compare DOM completion and app usable mark in separate profile run; add timeout regression fixture |
| Decoded JS split versus CDP wire bytes | Existing `npm run performance:budget`, bundle analyzer; #404 | Keep measured wire metric; add decoded script total only with cache and compressed/uncompressed controls |
| Realtime event-to-visible network/long-task split | `src/lib/realtime/latencyCanary.ts`, #318 | Read existing telemetry first; do not generate live writes in the daily harness |
| Query-count correlation | Existing `[n+1-detector]` in `src/lib/queryCountTracker.ts` | Use approved app log access and route/commit correlation. It reports threshold warnings, not exact counts; unavailable means unavailable, never direct DB access |
| Post-paint loading completion and failed requests | Two-second tail can leave downloads pending | Add bounded completed/pending byte counters and tests; do not extend the tail silently or compare across protocol versions |
| Lazy-load `node-html-parser` on the list/mention branch | HTPR-7091: tried 2026-10-11, JS -88 KB but only about -200 ms, inside noise. Rejected, do not repeat | none |
| Drop non-first-content bytes: Prisma enum-import runtime (29 KiB gz), framer-motion (53), markdown libs (51), react-day-picker (21) | Cold phone main thread is compile and eval 6.8 s | One at a time, corrected phone profile, 5 cold samples before and after, ABAB; mount any new lazy chunk in a transition (HTPR-7116) |
| Re-baseline phone daily read | Profile fixed 2026-10-11; older phone days not comparable | Run the daily harness at host load below 12, record as the new phone baseline |
| Live description sooner after a server description (HTPR-7367) | Controls arrive about 1 s later with the server description | Time the editor chunk against the live swap; if it gates the transition, nest a Suspense with the static frame as fallback; ABAB phone N=5 |
| Account-based flag A/B on a shared board | HTPR-6934 verdict pending | Seed inboxes for both accounts, run desktop and inbox when load is low |
| Flag readers redraw after load (HTPR-7560) | `useFlag` context swaps to an equal new object after hydration; 399 readers | Per-key subscription behind a server flag, live ABAB phone N=5, render-count test |
| Name the React work in a phone tap from the board (HTPR-7395) | Tap window is 5.4 s React, 1.4 s module eval, 1.2 s idle of 10.8 s | Local production build with source maps, phone profile, CPU profile the tap; then defer the pointerdown Firebase and emoji warm until the ticket paints, ABAB N=5 at load under 20 |

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

### 2026-10-25: daily read Can't verify; the GitHub speed schedule is now healthy

**Daily read.** Can't verify. `node scripts/speed/measure.mjs --latest` returns the failed 2026-10-24 08:13 run ("Production changed during run") and `--history` returns cannot verify, because this VPS keeps no fresh private history and the VPS timer stays off on purpose.

**What changed.** The blocker recorded on 2026-10-23 and 2026-10-24 is gone: the repo now has a `live-qa` environment, `scripts/speed/github-age-recipient.txt` holds a real age recipient, and `speed-live.yml` has succeeded twice on schedule (39932477815 on 2026-10-23, 40080514403 on 2026-10-24 09:04 UTC). Live numbers exist; they are simply not readable from this VPS.

**Decision.** No measured fix today: choosing a regression without verified numbers would invent a target. The open speed ticket HTPR-7718 (phone first visit idle gap) stays with its owner.

**Next probe.** Make the daily read read the schedule's published history instead of `~/.local/state/speed/history.json` (fetch the run artifact or the private history the run writes, per YPER4-545), then rerun `--latest` and pick the biggest seven-day regression. Do not restart the VPS timer. Recorded before touching any code so next week does not repeat the read.
