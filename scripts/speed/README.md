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

Default: five samples of each of seven paths on each profile, run serially. Search uses the canonical query URL so legacy live-search debounce and Enter-to-open cannot race the measurement. QA Sandbox board 6859, existing ticket 43, expected title `QA 6667 Enter verification`. No fixture creation. Actions are at least two seconds apart. Desktop 1440x900, no throttling. Phone 390x844, touch/mobile Chromium with an iPhone user agent and deviceScaleFactor 3 (the repo adds these to the shared context; each phone sample records `innerWidth` and `documentWidth` and fails unless innerWidth is 390), 150ms latency, 1.6Mbps down/750Kbps up, 4x CPU. This is phone emulation on a VPS, not a physical-device field measurement.

| Path | Timed start and visible completion |
|---|---|
| Board | Fresh context hard navigation to QA Sandbox, actual fixture card visible and board identity present |
| Ticket cold | Separate fresh context hard navigation, exact title, description container and primary actions present |
| Ticket warm | Same context, return to board, actual card click, same ticket completion; board setup excluded |
| Search | Hard navigation to the existing search URL with the exact fixture title, to the visible matching result; includes real search fetching |
| My Tasks | Hard navigation, SSR-seeded title and actual table header visible; server loading fallback cannot pass; empty list allowed |
| Ctrl+J | Keydown on the selected QA board column to the visible existing AI Task Writer field; no text entered or submitted; Escape closes it |
| Page navigation | My Tasks `g` then `b` to the actual QA board card, not a document reload |

Two animation frames confirm completion. The same two-second observation tail as speed-check captures late traffic and long tasks, but is excluded from content timing. Counts include all allowed requests started in the measured window, including pending requests. Browser-canceled requests (including superseded board reads during navigation) remain recorded as failed/canceled but do not invalidate verified visible content; other read failures and HTTP errors invalidate the run. CDP `encodedDataLength` is actual transferred response bytes, including protocol overhead, with cache hits costing zero; pending or canceled requests keep CDP encoded bytes received so far, excluding not-yet-reported overhead. Per-request method, safe pathname (never query), relative start, TTFB, total duration, status/failure, bytes and sanitized Server-Timing numeric durations form a private waterfall. No headers, request/response bodies, cookies, raw traces or credentials are stored. Long tasks keep start/duration and summed milliseconds.

All app writes and unknown API reads are blocked by the shared CDP policy. Reviewed extensions only: app-shell bootstrap POST, My Tasks GET, keyword search document POST, search values GET. Blocked analytics, read receipts, AI prompts, share creation and activity are listed separately, never counted as successful requests. These timings describe the read-only harness, not unguarded customer traffic.

## History and interpretation

**Phone numbers before 2026-10-11 are not comparable.** Until then the shared context had only viewport, isMobile and hasTouch, which laid the ticket page out desktop-like (innerWidth 780, document width 834 on the live ticket page; board was fine at 390). Ticket-cold, ticket-warm, search and later phone paths on ticket or search pages may carry that wider layout. Treat the first run with the real phone profile as a new phone baseline; the 15% regression flag against older phone days is not meaningful for those paths.

`~/.local/state/speed/history.json` is an append-only JSON array logically, atomically replaced on disk (0600). It keeps every raw sample and failed/partial run, UTC dates, browser/profile/fixture/protocol, host load and the live full production commit from `/api/version` before and after. A deploy during a run makes it invalid. No repo-local history. A single-process lock refuses overlap; if a killed process leaves `measure.lock`, confirm no measuring process remains before removing only that lock and rerunning. Do not remove history.

Comparison uses the median of the latest matching successful run's cohort median per UTC day in the preceding seven full UTC days. Match Node/browser, profiles, fixture, sample count and protocol, not production commit or variable host load. Today is not its own baseline. Every measured content time, request count, wire bytes and long-task total over 15% of that reference is flagged. A zero baseline becoming nonzero is flagged without inventing a percent. No matching history says so. Failed runs never enter the median. Regression output does not make the service fail: operational inability to verify exits 1, measurements finish with 0 even when regressions need investigation.

High VPS load and under-five samples are provisional. Preserve slow samples and failures. Confirm a candidate with the existing speed-check 5 cold/5 warm protocol, variance, p90 and at least ten minutes since deploy before claiming an improvement. This seven-path history does not replace `performance/evidence`, `npm run performance:budget`, `npm run performance:field` or `fix-slow-page` proof.

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
