# Midscene E2E flow pack (HTPR-5720, scaffold from HTPR-5715)

AI-driven UI checks against the live Hypertask app using
[Midscene](https://github.com/web-infra-dev/midscene) + Puppeteer. HTPR-5715
built the guarded runner and one smoke flow; HTPR-5720 turns that into an
organized flow pack:

- `flows/*.mjs` -- one flow per feature area. Each file's default export is
  **data**, not code: `{ id, area, title, description, safe, steps }` where
  `steps` are declarative `{ action, arg, ... }` objects (`goto`, `aiAssert`,
  `aiTap`, `aiInput`, `aiKeyboardPress`, `aiQuery`, `aiWaitFor`). Being data
  means the same flow file drives both the test run and the human-readable
  docs page (`hypertask.app/qa-flows`, see `hypertask-analytics` repo).
- `flows/index.mjs` -- the flow registry.
- `manifest.json` -- maps feature areas (from `openwiki/feature-map.md`) to
  flow ids, so coverage gaps are visible (`flowIds: []`).
- `runner.mjs` -- generic executor: loads a flow's `steps` and runs them
  against one puppeteer session, writes `midscene_run/results-latest.json`.
- `nightly.sh` -- cron entry point (not run by CI). Runs `guarded-run.sh
  --all`, then tracks per-flow consecutive failures in `flake-state.json` and
  auto-files a Hypertask bug ticket the first time a flow crosses 2
  consecutive nightly failures.

## Flows in the starter pack

| id | area | what it checks |
|---|---|---|
| `board-demo` | board | demo board renders, columns are To Do / In Progress / Done |
| `task-detail-demo` | board | tapping a card opens the task detail panel |
| `task-create-demo` | board | creating a task through the UI on the demo board (disposable guest board, safe to write to) |
| `landing` | marketing | `hypertask.ai` (falls back to `app.hypertask.ai`) renders with branding, no error text |
| `login-screen` | auth | login page shows the email input and Google sign-in option (does not log in) |

All five are `safe: true`: no writes to real user data. `task-create-demo`
writes to the `/demo` guest board, which is disposable by design; everything
else is read-only.

## Setup

```bash
cd e2e/midscene
npm install
cp env.example .env
# fill OPENAI_API_KEY with the Vercel AI Gateway key (see below)
```

## Run

```bash
npm run smoke              # runs every flow (guarded-run.sh --all)
./guarded-run.sh --flow board-demo   # runs one flow
```

**Always run through `guarded-run.sh` — never run `node runner.mjs`
directly.** It's the only supported entry point because it guards the VPS.
`guarded-run.sh` passes its arguments straight through to `runner.mjs`
(`--flow <id>` or `--all`).

Guards, unchanged from HTPR-5715:

- **Single-flight lock**: `flock` on `/tmp/midscene-e2e.lock`, held for the
  entire script (never just probed then released, and the lock file is never
  unlinked). A second concurrent run exits 0 immediately with "another run in
  progress, skipped". The pre-run sweep (`cleanup.sh --locked`) runs under
  that same held lock, so it can never race a new run starting in the gap
  between a probe and the cleanup.
- **Resource caps**: `systemd-run --user --scope` with `MemoryMax=2G`,
  `MemorySwapMax=0`, `CPUQuota=150%`, `TasksMax=256`. **Fails closed** if
  `systemd-run --user --scope` doesn't work on the box: exits non-zero with
  an error instead of running unguarded. There is no fallback execution path
  without cgroup limits.
- **Hard timeout**: 10 minutes wall clock (`timeout --signal=TERM
  --kill-after=30 600`).
- **Cleanup**: the pre-run sweep kills any orphaned Chrome from a previous
  crashed run and clears stale profile artifacts, and an EXIT trap after
  every run kills only the Chrome instance launched with this run's own
  `--user-data-dir=/tmp/midscene-profile-<pid>`, deletes that profile dir,
  and prunes `midscene_run/report/` down to the 10 most recent reports.

To force-reset everything by hand (or from cron): `./cleanup.sh` or
`npm run cleanup`. It takes the same lock itself for its whole run, so it's
safe to run at any time (it just skips if a real run currently holds it).

## Provider: Vercel AI Gateway

```
OPENAI_BASE_URL=https://ai-gateway.vercel.sh/v1
OPENAI_API_KEY=<GATEWAY_KEY_VALENTIN>
MIDSCENE_MODEL_NAME=google/gemini-2.5-flash
```

`google/gemini-2.5-flash` is confirmed available through the gateway and is
what the working run used. `openai/gpt-4o` is the documented fallback if
Gemini is ever pulled from the gateway; `qwen/qwen2.5-vl-72b-instruct` was not
listed on the gateway at the time this was written. If you do switch to a
Qwen VL model, also set `MIDSCENE_USE_QWEN_VL=1` per Midscene's docs.

## Proxy requirement

The Contabo VPS IP is bot-challenged by Vercel — Midscene's AI gateway calls
must go through the SOCKS tunnel on port 1088. Use Midscene's own proxy var,
**not** the generic `ALL_PROXY`:

```
MIDSCENE_OPENAI_SOCKS_PROXY=socks5h://127.0.0.1:1088
```

Two things went wrong when this was tried with `ALL_PROXY` set process-wide,
both fixed by using `MIDSCENE_OPENAI_SOCKS_PROXY` instead:

- Chrome inherits `ALL_PROXY` too and tried to route the demo-site page load
  through the same tunnel, which isn't set up for general browsing —
  `net::ERR_EMPTY_RESPONSE`. (`run.mjs` also strips proxy vars from the
  Chrome subprocess's env as a second layer of defense.)
- Node's built-in `fetch` (undici) going through the tunnel got a `403
  Vercel Security Checkpoint` HTML page back even though `curl` through the
  identical tunnel got a clean 200 — looks like TLS/HTTP client
  fingerprinting on Vercel's side, not a tunnel problem. Midscene's own
  `socks-proxy-agent` path for `MIDSCENE_OPENAI_SOCKS_PROXY` doesn't hit
  this.

If a call ever comes back with a "Vercel Security Checkpoint" HTML page
instead of a JSON response, check the tunnel is up first
(`ss -ltnp | grep 1088`), and confirm you're using
`MIDSCENE_OPENAI_SOCKS_PROXY`, not `ALL_PROXY`.

## Results and reports

Every run writes `midscene_run/results-latest.json` (gitignored):
`{ startedAt, results: [...] }`, where `startedAt` is the ISO time this
runner invocation began and each result is `{ flow, ok, error, durationMs,
reportPath, screenshotPath, resolvedUrl }`. `resolvedUrl` is the URL a
`goto` step actually ended up on (only differs from the flow's declared URL
when a DNS/connection-refused fallback kicked in). `--all` continues past a
failed flow and still exits non-zero if any flow failed. On failure the
runner also saves a full-page screenshot to `midscene_run/screenshots/`.

`startedAt` exists so `nightly.sh`'s postprocessor (`postprocess.mjs`) can
tell a fresh results file from a stale one left over by a crashed or
timed-out run -- see below.

Midscene itself writes HTML run reports to `./midscene_run/report/`
(gitignored, pruned to the 10 most recent by every run).

## Nightly cron and auto-filed tickets

`nightly.sh` is a **cron entry point, not part of CI**. The whole script runs
under its own single-flight `flock` (`/tmp/midscene-nightly.lock`, separate
from `guarded-run.sh`'s own lock file) -- a second concurrent nightly
invocation skips immediately instead of racing the first over
`flake-state.json`. It:

1. Checks the SOCKS tunnel (port 1088) is up, starts it if not
   (`ssh -f -N -D 1088 vps`), and aborts with a clear message if that fails.
2. Sources `~/.config/val-staging/credentials.env` for the AI gateway key.
3. Removes any leftover `results-latest.json`, records the run's start time,
   then runs `./guarded-run.sh --all`.
4. Runs `postprocess.mjs` (a real file, not an inline `node -` heredoc --
   ESM import syntax on stdin can be misdetected as CommonJS), which:
   - refuses to process a results file whose `startedAt` predates this
     nightly run (a crashed/timed-out runner never causes the previous
     night's results to be silently reprocessed as fresh) -- exits non-zero,
     `nightly.sh` logs `postprocess FAILED` and exits non-zero too;
   - otherwise updates `flake-state.json` (gitignored, per-flow
     `consecutiveFails` / `flakeCount` / `ticketFiled`): a single failure
     just increments `flakeCount`; **2 consecutive failures** files one
     Hypertask bug ticket (project 15, section Bugs, title `Midscene
     nightly: <flow id> failing`, the error and screenshot attached) and
     marks `ticketFiled: true` **only after the `hypertask` CLI call actually
     succeeds** -- a CLI error, or `--dry-run`, leaves `ticketFiled: false` so
     the next failing night retries filing; a pass resets the flow's state.
5. Appends a one-line summary to `~/.cache/midscene-nightly.log`.

Test the ticket-filing logic without touching the board: `./nightly.sh
--dry-run` prints the `hypertask` command instead of running it (still runs
the real flows first). To test `postprocess.mjs` in isolation without running
`--all`, call it directly: `node postprocess.mjs flake-state.json
midscene_run/results-latest.json 2 15 Bugs 1 <run-start-unix-seconds>`.

**Install the cron job by hand** (this repo does not install it for you):

```
30 3 * * * /home/valentin/projects/hypertasks/e2e/midscene/nightly.sh
```
