# Daily live speed measurement

For https://app.hypertask.ai/detail/project-4060/232. Deterministic measuring, not automated diagnosis or board writes. Uses the existing company `speed-check/scripts/common.mjs` for QA-only storage state, browser resolution, read-only request policy, context/profile and action pacing. No copied login or separate credentials. See `.claude/skills/speed-analyst/SKILL.md` for analysis.

## Run

Requirements: the app's Node 24 major, the company skill pack at `$COMPANY_SKILLS_DIR` or `~/projects/company-skills`, Playwright and installed Chromium. Use the app's existing `@playwright/test` dependency, not another harness. Set `PLAYWRIGHT_NODE_MODULES` to the app's `node_modules` if the shared resolver cannot find it. For a fresh development installation: `npm ci`, then `npx playwright install chromium`. Do not install in a production checkout.

QA-normal state: `~/.config/hypertask-videos/storageState-qa-normal.json`, user 2343. The shared harness validates it privately and drops origins and unrelated cookies. A server-side `POST /api/app-shell/bootstrap` doctor must agree with that identity. If expired, follow `.claude/skills/verify-qa/SKILL.md` Logins, using the existing QA runner login/email-code flow. Never use Valentin's account or print the state. Authentication is outside the timed samples.

```sh
PLAYWRIGHT_NODE_MODULES="$PWD/node_modules" node scripts/speed/measure.mjs
node scripts/speed/measure.mjs --samples 1   # harness smoke, not speedup proof
node scripts/speed/measure.mjs --latest
node scripts/speed/measure.mjs --verify-history
```

Default: five samples of each of eight paths on each profile, run serially. Search uses the canonical query URL so legacy live-search debounce and Enter-to-open cannot race the measurement. QA Sandbox board 6859, existing ticket 43, expected title `QA 6667 Enter verification`. No fixture creation. Actions are at least two seconds apart. Desktop 1440x900, no throttling. Phone 390x844, touch/mobile Chromium with an iPhone user agent and deviceScaleFactor 3 (the repo adds these to the shared context; each phone sample records `innerWidth` and `documentWidth` and fails unless innerWidth is 390), 150ms latency, 1.6Mbps down/750Kbps up, 4x CPU. This is phone emulation on a VPS, not a physical-device field measurement.

| Path | Timed start and visible completion |
|---|---|
| Board | Fresh context hard navigation to QA Sandbox, actual fixture card visible and board identity present. A first visit on a new device: the QA login filter drops the saved board preference, so the server never sends its ready-made board |
| Board returning | Same as Board, with the saved board preference (`ht_board_display_v1`) the app wrote on an earlier visit, so the server can send the ready-made board (HTPR-6934). The preference comes from an untimed, unthrottled visit in its own context; the timed context is otherwise as cold as Board. On desktop the app declines to save it while AI chat opens by default (the default setting, and QA 2343's), so desktop Board returning measures that user without it and records `boardPreference: false`. Every board sample records `serverBoard`: false when the page fetched `/api/projects/boardTasks` before the card showed (the server copy was missing or late) |
| Ticket cold | Separate fresh context hard navigation, exact title, description container and primary actions present |
| Ticket warm | Same context: after the cold sample, wait (untimed, 30 s cap) until no script download is pending or new for 1.5 s after an idle main thread, then return to board, actual card click, same ticket completion; board setup and the wait excluded. The cold sample records `settleMs` and `pendingScripts` |
| Search | Hard navigation to the existing search URL with the exact fixture title, to the visible matching result; includes real search fetching |
| My Tasks | Hard navigation, SSR-seeded title and actual table header visible; server loading fallback cannot pass; empty list allowed |
| Ctrl+J | Keydown on the selected QA board column to the visible Task Writer field (since 2026-10-20 the Compose writer inside the Commands sheet); no text entered or submitted; Escape closes it |
| Page navigation | My Tasks `g` then `b` to any visible card of the board it opened (recorded as `landed`), not a document reload |

Two animation frames confirm completion. The same two-second observation tail as speed-check captures late traffic and long tasks, but is excluded from content timing. Counts include all allowed requests started in the measured window, including pending requests. Browser-canceled requests (including superseded board reads during navigation) remain recorded as failed/canceled but do not invalidate verified visible content; other read failures and HTTP errors invalidate the run. When every failed read is `net::ERR_NETWORK_CHANGED` (the VPS network changed, for example a Docker container starting), that phase's samples are dropped and the phase is measured once more in a fresh context; the run records it under `networkRetries`, and a second change fails the run as `Host network changed`. CDP `encodedDataLength` is actual transferred response bytes, including protocol overhead, with cache hits costing zero; pending or canceled requests keep CDP encoded bytes received so far, excluding not-yet-reported overhead. Per-request method, safe pathname (never query), relative start, TTFB, total duration, status/failure, bytes and sanitized Server-Timing numeric durations form a private waterfall. No headers, request/response bodies, cookies, raw traces or credentials are stored. Long tasks keep start/duration and summed milliseconds.

All app writes and unknown API reads are blocked by the shared CDP policy. Reviewed extensions only: app-shell bootstrap POST, My Tasks GET, keyword search document POST, search values GET. Blocked analytics, read receipts, AI prompts, share creation and activity are listed separately, never counted as successful requests. These timings describe the read-only harness, not unguarded customer traffic.

## History and interpretation

**Path versions.** `conditions.pathVersions` gives ticket-warm, page navigation and Ctrl+J version 2 (2026-10-20). The seven-day baseline for a path uses only history with the same path version (older runs count as version 1); page navigation also needs the same set of landed board and view. Other paths keep their full history. A cold ticket whose scripts are still pending at the 30 s settle cap fails the run instead of measuring a partly cold warm tap.

**Page navigation before 2026-10-20 is not comparable.** `g` then `b` opens the shared QA account's previous board under its saved view, which other QA sessions change (2026-10-20: board 8778, and 6859 under another session's saved view). It now completes on any visible card of the board it opened and records that board's `id` and `view` as `landed`; it no longer waits for task 43.

**The Board path is a first visit, not a returning user (2026-10-20).** On production bb8f47aa1, phone, host load 7 to 9: without the saved preference 11.7 to 12.8 s (N=5), with it 1.75 to 2.2 s, median 1.93 s (N=20, all served from the server) plus 4 of 5 interleaved pairs at about 1.9 s; the fifth fell back to the page fetch (12.9 s). Board before 2026-10-20 is the first-visit cohort only; Board returning starts its own history.

**Ctrl+J before 2026-10-20 is not comparable.** Between 2026-10-19 12:20 and 2026-10-20 00:40 UTC plain QA began getting the Compose writer inside the Commands sheet instead of the older writer: different code and requests (`/api/tasks/single`, two `/api/projects/getAllMinimal` reads with query strings not recorded), phone about 1.8 s instead of about 1.25 s.

**Ticket-warm before 2026-10-20 is not comparable.** Since HTPR-7367 (2026-10-19) a cold ticket is visible from server HTML while most of its code is still downloading. The old harness left 2 s after content, cancelling those downloads, so the warm click downloaded the ticket code again: phone about 11 s instead of about 2 s. Runs from 2026-10-19 on 2edd39cbc or later measured a first open, not an opened-before ticket. A failed path now records `index`, a one-line `error` with URLs removed, the `id`/`view` query values, and whether the fixture link and QA board were on the page.

**Phone numbers before 2026-10-11 are not comparable.** Until then the shared context had only viewport, isMobile and hasTouch, which laid the ticket page out desktop-like (innerWidth 780, document width 834 on the live ticket page; board was fine at 390). Ticket-cold, ticket-warm, search and later phone paths on ticket or search pages may carry that wider layout. Treat the first run with the real phone profile as a new phone baseline; the 15% regression flag against older phone days is not meaningful for those paths.

`~/.local/state/speed/history.json` is an append-only JSON array logically, atomically replaced on disk (0600). It keeps every raw sample and failed/partial run, UTC dates, browser/profile/fixture/protocol, host load and the live full production commit from `/api/version` before and after. A deploy during a run makes it invalid. No repo-local history. A single-process lock refuses overlap; if a killed process leaves `measure.lock`, confirm no measuring process remains before removing only that lock and rerunning. Do not remove history.

Comparison uses the median of the latest matching successful run's cohort median per UTC day in the preceding seven full UTC days. Match Node/browser, profiles, fixture, sample count and protocol, not production commit or variable host load. Today is not its own baseline. Every measured content time, request count, wire bytes and long-task total over 15% of that reference is flagged. A zero baseline becoming nonzero is flagged without inventing a percent. No matching history says so. Failed runs never enter the median. Regression output does not make the service fail: operational inability to verify exits 1, measurements finish with 0 even when regressions need investigation.

High VPS load and under-five samples are provisional. Preserve slow samples and failures. Confirm a candidate with the existing speed-check 5 cold/5 warm protocol, variance, p90 and at least ten minutes since deploy before claiming an improvement. This eight-path history does not replace `performance/evidence`, `npm run performance:budget`, `npm run performance:field` or `fix-slow-page` proof.

## Install the daily user timer (owning session only, after merge)

No install command is run by this PR. Use a permanent updated app checkout, not a ticket worktree that cleanup will delete. The units default to `~/projects/hypertask` and `~/projects/company-skills`. Verify the QA doctor manually first.

```sh
node --version                         # must be v24.x
node scripts/speed/measure.mjs --samples 1
mkdir -p ~/.config/systemd/user/speed-measure.service.d
cp scripts/speed/systemd/speed-measure.{service,timer} ~/.config/systemd/user/
# systemd does not inherit an interactive shell's Node manager PATH.
printf '[Service]\nExecStart=\nExecStart=%s %s/scripts/speed/measure.mjs\n' \
  "$(command -v node)" "$PWD" > ~/.config/systemd/user/speed-measure.service.d/runtime.conf
systemd-analyze --user verify ~/.config/systemd/user/speed-measure.{service,timer}
systemctl --user daemon-reload
systemctl --user enable --now speed-measure.timer
systemctl --user list-timers speed-measure.timer
journalctl --user -u speed-measure.service -n 30 --no-pager
```

For a different permanent checkout, override `WorkingDirectory`, `ExecStart`, `COMPANY_SKILLS_DIR` and `PLAYWRIGHT_NODE_MODULES` in the drop-in, using absolute paths. The daily schedule is 04:30 UTC plus up to 15 minutes jitter, with missed-run catch-up. The timer measures only; SPEED RUNNER reads the report in its session. Weekly research is part of that session, not a second scheduled LLM job. The owner must confirm user-manager persistence if measurements must run after logout; do not alter host/login policy here.

Stop: `systemctl --user disable --now speed-measure.timer`. Stop an active measurement with `systemctl --user stop speed-measure.service`, then inspect the lock as above. Tests: `node --test tests/speed-analyst.test.cjs`. Units: `systemd-analyze --user verify scripts/speed/systemd/speed-measure.{service,timer}`.
