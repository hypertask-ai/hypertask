# E2B verification fleet

The one nightly QA suite for the live app (Valentin, 2026-09-15). Midscene is
retired in favor of this; see `midscene-flows.md` for the retirement stub and
[HTPR-6484](https://app.hypertask.ai/detail/project-15/6484) for the port
ticket. Full detail: `~/projects/hypertask-verify-app/ABSTRACT.md` and
`openwiki/verification-fleet.md` in the hypertasks repo.

## What it is

LLM agents drive a real headless browser through scripted flows against
`https://app.hypertask.ai`, a judge model grades the evidence, and confirmed
product bugs become tickets. Code: `~/projects/hypertask-verify-app`
(`app-suite` branch, private repo `hypertask-ai/hypertask-verify`). Dashboard:
[https://hypertask.app/verify](https://hypertask.app/verify).

## The 02:15 timer

`scripts/run-critical-lifecycle.sh` runs daily at 02:15 UTC: a deterministic
Playwright smoke test, the full LLM-driven app suite (flows in `flows-app/`,
42 today), and a small exploratory lane. Cron log:
`~/.cache/hypertask-verification/critical-lifecycle.log`.

## Test account — never Valentin's

Every flow runs as `verification-fleet@crolab.org`, **userId 1248**, Free
plan. Login is headless cookie injection (`nookies_user` + `ht_session`
minted from the prod `JWT_SECRET`). Never point any flow at Valentin's
account. The Free plan's 3-board cap is a known source of env failures when
flows run concurrently (`01-create-board` fails if all 3 slots are held).

## Running one flow, or a subset, on demand

From `~/projects/hypertask-verify-app`:

```bash
node orchestrator.mjs --flow 07-priority-size          # one flow
node orchestrator.mjs --flows 05,06,07                 # a subset
node orchestrator.mjs                                  # full app suite
```

Each flow gets its own throwaway board and its own E2B cloud sandbox (the
`desktop` template — the base template crashes Chromium). `gpt-5.6-luna`
(OpenRouter, dedicated key at `~/.config/openrouter/credentials.env`) drives
Playwright from screenshots and a DOM summary; a judge model passes/fails
each flow. Sandbox credentials: `~/.config/e2b/credentials.env`.

## Flow list

`flows-app/*.md` in `~/projects/hypertask-verify-app`, one file per flow
(`01-create-board.md` … `42-ai-chat-new-conversation.md`), covering board
CRUD, task fields, comments, views (board/table/calendar/inbox), filters,
search, inbox actions, settings, and the five AI-chat flows.

## Judge + two-pass triage

`reporter.mjs` sends every failure (with screenshots) to a Claude call that
classifies it as product-bug / agent-error / flake / env-issue. **Only a
product-bug that two independent triage passes agree on becomes a ticket** —
this is what keeps the fleet's own noise off the board. Triage refuses to
re-process a run summary older than 6 hours (a 2026-09-03 outage hid behind
stale re-triage).

Confirmed bugs go to project 15, labels **`e2b,Bug`**, assignee 6, Bugs
column, one open ticket per flow (repeat failures get a comment, not a
duplicate ticket).

## Known false-alarm patterns

- The judge misreads the orchestrator's own `goto()` reloads as "unexpected
  navigation".
- Agents sometimes type into the wrong element or skip a scroll step before
  asserting.
- `01-create-board` fails under concurrent runs holding all 3 Free-plan board
  slots — an env limit, not a product bug.
- Recurring signal worth watching but not yet filed as a standalone bug:
  "Minified React error #418" (hydration) on initial page loads.

## Cost

~$0.40-0.75 per full app-suite run, ~$0.10 for the small lanes.

## Rules that bite

- Board writes go through the `hypertask` CLI, never direct DB.
- Cleanup deletes throwaway boards in a `finally`; after a hard kill, run
  `cleanupThrowawayBoards` (`app-fixtures.mjs`) to clear strays.
- Tickets it files must carry both labels, `e2b` and `Bug`.

## Status 2026-09-15

Fleet is live and is now the only nightly QA suite (Midscene's cron is being
removed under HTPR-6484). Last full run (2026-08-30, pre-expansion to 42
flows): 34/37 passed, zero confirmed product bugs; the one earlier real find
(HTPR-5761, Ctrl+Z not undoing an inbox archive) did not reproduce the next
day. HTPR-6484 tracks porting the Midscene flows this fleet doesn't already
cover and deleting the Midscene cron and `qa-flows` dashboard page.
