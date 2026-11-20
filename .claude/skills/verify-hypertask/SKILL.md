---
name: verify-hypertask
description: Prove real Hypertask behavior by driving the app: local before the PR, Visual Regression before a UI merge, design QA against the ticket frame, and production after every deploy. Use for app QA verdicts, mobile checks and post-deploy proof.
---

pstack: 0.15.43

# Verify Hypertask

One verification skill for `https://app.hypertask.ai`. `verify-qa`, `verify-visual`,
`verify-design` and `verify-on-phone` are pointers here. Built on Lauren Tan's verification
pattern: drive the app the way a user does, then leave evidence a second person can read
without you.

Never use Valentin's login or his browser. Never print a credential, a cookie or a storage
state file. Use headless Playwright with a QA identity from the helper list. A test, a
preview, an open PR or a local build is not live proof. Never build or run tests on the VPS,
because CI does that; a local run killed with exit 137 is not a blocker. Admin pages are not
agent-testable.

## ht-verify

One command wraps the helpers below. It prints one JSON object on stdout,
`{ command, ok, target, run, data, evidence, error }`, where `error` holds
`{ code, message, next }` and `next` is what to run instead. Exit codes: 0 ok,
1 the check failed, 2 usage or unreadable environment, 3 identity expired.
State lives in `~/.local/state/ht-verify/default` (`HT_VERIFY_RUN` overrides), so
`up`, `seed` and `login` compose without repeating flags. `--help` is canonical.

| Command | What it proves |
|---|---|
| `.claude/skills/verify-hypertask/bin/ht-verify up [--port] [--db-port] [--dry-run]` | the disposable Postgres, migrations and Next dev start and `/login` answers 200 |
| `.claude/skills/verify-hypertask/bin/ht-verify down [--keep-db] [--dry-run]` | only this run's dev process group, container and volume stop |
| `.claude/skills/verify-hypertask/bin/ht-verify doctor [--target local\|production] [--ticket HTPR-N]` | local: page, database, dev pid and seeded identity; production: the merge deployment and the QA identity |
| `.claude/skills/verify-hypertask/bin/ht-verify seed [--visual] [--all-flags-on] [--dry-run]` | the disposable database seeds and the local state loads as a real user |
| `.claude/skills/verify-hypertask/bin/ht-verify login [account] [--state] [--expect] [--base-url]` | the chosen QA account's state loads as the expected user |
| `.claude/skills/verify-hypertask/bin/ht-verify shot <url> --out <png> [--account] [--viewport] [--theme]` | the page renders signed in and lands where asked, never on a login page |
| `.claude/skills/verify-hypertask/bin/ht-verify session start\|status\|stop [--state] [--base] [--viewport]` | one persistent headless browser for the commands below |
| `.claude/skills/verify-hypertask/bin/ht-verify open <path> [--wait <selector>]` | the page loads in the session and reports URL, status and title |
| `.claude/skills/verify-hypertask/bin/ht-verify click <selector> [--double]` | a real click lands and the page reacts |
| `.claude/skills/verify-hypertask/bin/ht-verify fill <selector> <text> [--submit]` | a field accepts typed input on the real page |
| `.claude/skills/verify-hypertask/bin/ht-verify api <method> <path> [--data] [--confirm] [--dry-run]` | an authenticated call through the run's cookies; a write needs `--confirm` |
| `.claude/skills/verify-hypertask/bin/ht-verify logs [--dev\|--browser] [--lines] [--grep]` | the dev or browser log shows what happened |
| `.claude/skills/verify-hypertask/bin/ht-verify flags list\|show <key>\|set ...` | flag state, and a switch only through ht-flag's approval path, never Off |
| `.claude/skills/verify-hypertask/bin/ht-verify drive <area> [--base] [--state] [--board]` | one hands-free area (board, task, comments, flags, ctrl-j, ai-chat, inbox) step by step |

```bash
.claude/skills/verify-hypertask/bin/ht-verify up && .claude/skills/verify-hypertask/bin/ht-verify seed
.claude/skills/verify-hypertask/bin/ht-verify session start
.claude/skills/verify-hypertask/bin/ht-verify open /my-tasks
.claude/skills/verify-hypertask/bin/ht-verify shot --session --out "$PWD/my-tasks.png"
```

A bare `ht-verify up` serves a production build with Redis and Soketi, so the board
renders its columns and cards locally and a new ticket lands through realtime. `up`
refuses a `node_modules` symlink that resolves outside this checkout and stops in seconds
on a fatal line in `dev.log`, so a stack that cannot serve never waits out the 240s timeout
or leaves `env.json` behind for the next command.

## Launch

Pick one target per run: local before the PR, a PR's Visual Regression comparison, or
production after the deploy, which design QA also uses.

**Local, before the PR.** Unmerged code, disposable database, no production data:

```bash
docker volume create hypertask-verify-db
docker run -d --name hypertask-verify-db \
  -e POSTGRES_USER=verify -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=hypertask \
  -p 5678:5432 postgres:14.0-alpine
export DATABASE_URL=postgresql://verify:verify@127.0.0.1:5678/hypertask
export SESSION_SECRET=local-verification-session-placeholder-32
export BETTER_AUTH_SECRET=local-verification-auth-placeholder-32
export NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000
export NEXT_PUBLIC_BASEURL=http://127.0.0.1:3000
npx prisma generate
npx prisma migrate deploy
npx next build
setsid nohup env CI=1 __NEXT_AGENT_UPGRADE=security npx next start -H 127.0.0.1 -p 3000 \
  > <run-folder>/dev.log 2>&1 &
echo $! > <run-folder>/dev.pid
```

Build and serve, never `next dev`: in dev the inline Flight payload never resolves, no page
hydrates, and the board sits on "Loading board..." forever. Real live board updates also need
`REDIS_URL` and the `PUSHER_*`/`NEXT_PUBLIC_PUSHER_*` pair that `ht-verify up` starts. Write
only `dev.log`. `Ready` in it is not ready: the first `/login` still compiles. Ready means
`curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/login` answers `200`.
`CI=1` and `__NEXT_AGENT_UPGRADE=security` stop Next's agent upgrade nudge from exiting
before it serves. `npm run dev` also starts `stripe:listen`, which local proof does not need.
A worktree whose `node_modules` is a symlink elsewhere cannot run Next: it fails on module
resolution. Run `npm ci` there first, then `npx prisma generate`. More detail:
[local launch](../verify-qa/reference/local-launch.md).

A local run that needs a session seeds its own account: a fresh database has no user 985 and
its own secrets, so a production storage state cannot sign in there. With the launch exports
in scope:

```bash
BROWSER_SMOKE_STATE_FILE=<run-folder>/state.json GITHUB_OUTPUT=<run-folder>/seed.out \
  node scripts/seed-browser-smoke.mjs
.claude/skills/verify-qa/scripts/qa-identity <run-folder>/state.json --base-url http://127.0.0.1:3000
```

`identity ok: user <id>` is the local identity pass; add `--all-flags-on` only when the
ticket's flag must reach that account.

Optional pre-PR CI check: push, then run `scripts/verify-qa <branch> inbox-cycle` on
GitHub-hosted fixtures, never VPS or production data. Mint a fresh `gh-app-token`, never fall
back to human login, follow the returned run URL with one `gh run watch`, then download the
artifacts. `inbox-cycle-broken` proves failure propagation and `hands-free-drives` runs every
drive script with its broken-feature control. It never replaces live QA.

**Production, after a deploy.** `https://app.hypertask.ai` counts only when
`ship-check deployed <TICKET>` prints `deployed ok` for the merge sha. A preview, an open PR
or a local build never stands in.

**Visual Regression** covers heavy UI. Heavy runs only in GitHub Actions, never on the VPS and
never locally. On a non-draft PR to production the comparison is the `visual-compare` job in
`.github/workflows/ci-tests.yml`: it reuses the one build `browser-build` published and diffs
each screen against the production baseline, so a screen change costs one build. The
`Visual Regression` workflow (`.github/workflows/visual-regression.yml`) never runs on a PR;
it owns the production baseline capture, the Monday schedule and manual dispatches, and its
`scripts/visual-regression-ci.mjs` builds base then head serially on a disposable DB and
Redis, seeds through `scripts/seed-browser-smoke.mjs --visual`, waits for `/login` and search
health, then stops its own servers. No production data and no QA credentials. A capture drives
`e2e/visual/visual.spec.ts` with `e2e/visual/playwright.visual.config.ts`, each screen at
desktop 1440x900 and phone 390x844, ten comparisons per build. A fixed-time fixture enables
the screen controls, so this covers those states, not every live flag or theme.

| Screen ID | User path and expected state |
|---|---|
| `board` | Seeded board, To do/Done columns and the fixture card visible |
| `task-detail` | Click that board card, title/description, two comments and one composer visible |
| `comment-box` | Cached-open task scrolls the uniquely matched last seeded comment into view, then the desktop composer only (phone composer is fixed); both stay in viewport and desktop composer follows comments |
| `ctrl-j` | Board, Control+j, empty writer with Describe the task textbox; never submit |
| `inbox` | /inbox loaded, inbox panel and list visible |

## Doctor

Run only the checks for the target you picked, before judging anything, and again after a
surprising failure. A login landing is never a doctor pass.

**Local.** The page you will drive answers `200`
(`curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/<path>`), and a run that
needs a session reports `identity ok` for its seeded account. Nothing else applies before a
merge: `ship-check deployed` and a 985 identity need production.

**Production.** Require the Production deployment `success` for the latest merge sha first,
then capture signed-in `/my-tasks` and check the identity:

```bash
.claude/skills/ship/scripts/ship-check deployed <TICKET>
.claude/skills/verify-qa/scripts/qa-login flags --state
.claude/skills/verify-qa/scripts/qa-identity <state> --expect 985
```

`identity ok` means fix state loading; only `identity expired` means refresh.

**Design.** A design run ends with `doctor ok` from
`.claude/skills/verify-design/scripts/design-check doctor`, which checks the QA state, the QA
identity, QA board `https://app.hypertask.ai/project?id=7049&surface=board` opening without a
redirect, and the theme cookie switching the page theme. Do not judge a design before it does.

**Visual.** Require the current PR head, the PR's base, and a capture summary in the job log
or step summary. `gh pr checks` carries neither the head nor the base, so read them from the
PR and the run:

```bash
gh pr view <PR> --json headRefOid,baseRefOid
gh api repos/hypertask-ai/hypertask/actions/runs/<RUN_ID> \
  --jq '{head: .head_sha, prs: [.pull_requests[] | {number, base: .base.sha, pr_head: .head.sha}]}'
gh api repos/hypertask-ai/hypertask/actions/runs/<RUN_ID>/jobs \
  --jq '.jobs[] | select(.name == "visual-compare") | {conclusion, steps: [.steps[] | {name, conclusion}]}'
gh run view <RUN_ID> --log | grep -E 'Visual base cache hit|Visual head reuses|passed|failed'
```

`head` must equal the PR's `headRefOid`, `base` must equal its `baseRefOid`, and the capture
step must have run. A restored production baseline is a valid base: when the job reports
`Visual base cache hit: ten validated screenshots`, the base capture was deliberately
skipped and only the head capture has to complete. Queued, missing, stale, cancelled, skipped
or setup-failed runs are not visual proof, and a missing run can mean path filtering. Do not
dispatch or retry a workflow to get green.

## Drive

Start from the map for the change: the customer map
`.claude/skills/verify-qa/reference/feature-map/INDEX.md`, one file per customer area with
Sub-features, How to get to it (user POV), Driving it with agent-browser and Gotchas, or the
ops map `.claude/skills/verify-qa/reference/ops-map/INDEX.md` for build, release, runner, CI
and monitoring recipes. Build and release tickets read the ops map, not the customer map. The
counter `node .github/scripts/feature-map-coverage.cjs --strict` gates every PR and reads 310
of 310 mapped. Design screens use the recipe in
`.claude/skills/verify-design/features/README.md`, one `design-check run` per screen. Write
the checklist from the ticket's acceptance criteria before testing, and correct a wrong or
missing recipe in the same PR.

**Pre-PR local shot, 390x844.** Shoot the page your branch changes, then assert what the user
must see in the served HTML. The screenshot proves the look, the assertion proves the state;
neither alone is a pass.

```bash
.claude/skills/verify-on-phone/scripts/phone-shot.sh http://127.0.0.1:3000/verify-email \
  <run-folder>/verify-email-390x844.png
curl -s http://127.0.0.1:3000/verify-email | grep -cF 'Verifying your email'
```

A zero count, a login landing or a redirect away from the requested path is a FAIL. An HTTP
200, an unchanged URL or a fixed sleep is not proof of a meaningful ready or empty state.
When the correct state may legitimately look blank or empty, shoot a baseline the same way
first, from production or from the base commit, and compare it against your shot; with no
baseline a blank page is a FAIL, because a broken blank page and the expected one look
identical. Read the shot against the acceptance criteria line by line and reshoot before the
PR. When a criterion names the initial state of a persisted control, remove that control's
saved preference first. A control on a closed, collapsed or idle bar is photographed closed,
not open.

Pass `--state` only for a page that needs a session; the default is
`~/.config/hypertask-videos/storageState-qa.json` (user 985, sees Owner + QA flags) and the
flag-off path is `~/.config/hypertask-videos/storageState-qa-normal.json` (user 2343). The
flag must be on for the account in that state or you photograph the old UI, so name the
account and the flag in the ticket comment. `--viewport 1440x900` gives the desktop viewport
and user agent, `--theme porcelain|graphite|graphite-2|amoled|dia` sets one theme, `--dry-run`
prints the command without a browser, and `--allow-redirect` accepts a redirect away from the
requested path, labels the shot `UNVERIFIED`, and never permits a login landing. Both shooters
refuse an address whose path says sign-in, even when that page is the one you asked for
(https://app.hypertask.ai/detail/project-15/9462). For those pages prove the state with the
served HTML and name the missing screenshot in the ticket. A missing or stale state file makes
the script fail loud; repair it through
[logins](../verify-qa/reference/logins.md) and never invent a login flow. Attach
the shot with `vcc comment add <TICKET> --kind qa --attach <out.png>`, never as a markdown
image, which crashes the ticket UI. With no local dev server for the change, shoot production
as it is today as the "before" and say so on the ticket.

**Production journey.** Every app deployment runs the core inbox cycle:

```bash
node .claude/skills/verify-qa/scripts/inbox-cycle-live.mjs <run-folder>/inbox-cycle
```

Require `inbox-cycle ok`, add `--phone` for the mobile layout, and include it in the cases.
Then cover the paths the ticket touches: success, cancel, error, empty and reload, and prove a
saved result survives a reload. Check the flag mode declared for that account and the
flag-off path, and, for a visible change, 390x844 on the real screen plus a short main-path
video. Compare before and after. Record an unreachable path as `UNREACHABLE` with its reason
and the closest real check.

Pick the account with `qa-login`: `flags` (user 985, default), `plain` (user 2343, flag off),
`free`, `byok`, `pro`, `owner`, `member`, `guest`. It prints the user id, the state path and
the refresh route, never credentials. Hands-free drives run against a disposable loopback
stack and refuse anything else. Pass `--base`, `--state` and `--board`; each prints
`<area> ok` or the failing step:

```bash
node .claude/skills/verify-qa/scripts/board-drive-live.mjs <run-folder>/board --base http://127.0.0.1:3100 --state <state> --board <board-id>
```

`task-drive-live.mjs`, `comments-drive-live.mjs`, `flags-drive-live.mjs`, `ctrl-j-drive.mjs`
and `ai-chat-drive.mjs` take the same arguments.

**Design pass.** One command per ticket, per screen and per theme, the frame's own size as
`--viewport`, so each changed theme is compared against its own frame:

```bash
.claude/skills/verify-design/scripts/design-check run <TICKET> '<live url>' \
  --frame <frame-porcelain.png> --themes porcelain --viewport 1920x1032
```

Repeat for every theme the brief changes, with `amoled` for AMOLED and `graphite-2` for
Graphite 2. `--press "<keys>"` opens an overlay such as the AI chat or the task writer before
the shot. The theme is a cookie per browser context, so parallel runs never clobber each
other. Every theme the brief changes needs its own approved frame; a theme with no frame
stops the pass and asks on the ticket, and one frame compared against all the themes is not
coverage. A theme the brief does not change gets a no-change check against production before
the merge. The approved frame wins over ticket text and over the style guide. Frames come from
`design-check frames <TICKET> <dir>`, whose `frames.tsv` gives each name and size; most
design-pass frames are 1920x1032, so a different viewport makes the score meaningless. The
builder never passes its own design QA; a different runner reads every side-by-side and marks
the checklist. Any purple, any sparkle icon, any corner other than 0, 2 or 4px is a FAIL,
except a round element whose class or data-testid names it avatar or status-dot. A FAIL goes
back to the intake column the board has (`design-check fail-column`), never Done and never to
Everyone.

A design run writes `~/.local/state/vcc-evidence/<TICKET>/<YYYY-MM-DD>-design-run-<n>/` with
`frames/`, `live-<theme>.png`, `audit-<theme>.json`, a labelled `side-<theme>.png` and
`report.md`. The score only helps a reviewer look and never passes a ticket alone; 0 is
identical and lower is closer. A redirect or a login page is never evidence, and
`--allow-redirect` is only for a run whose landed URL is named in the comment.

Known traps: the QA account opening board 15, My Tasks or Inbox lands on board 7049, so
board-level screens use 7049; Graphite 2 only appears while `htpr-8054-graphite-2` reaches the
QA account (`ht-flag get <flag-key>`); a flag at Off hides the change, so the shot shows the
old design and must FAIL.

**Visual Regression triage.** Read the failed screen and viewport in the step summary, then
download the diff PNGs artifact inside its 7-day retention and compare expected (base),
actual (head) and the diff PNGs together:

```bash
gh run download <RUN_ID> --name visual-regression-diffs \
  --dir "$HOME/.local/state/vcc-evidence/<TICKET>/visual/<RUN_ID>"
```

Read `error-context.md` for the named failing step and the page snapshot. Comment-box
navigation, scrolling, asset and geometry settling and desktop order checks have 15-second
step limits. Missing PNGs or a build, auth or readiness error mean an incomplete or
setup-failed run, not a pixel match; the artifact uploads only on failure and may be absent
before capture. A real regression is fixed, never blessed by regenerating expected images from
head, masking the change or loosening the threshold. An intended change needs
`Visual change approved: <ticket URL>` in the PR description, and that approval must cover the
observed screen change; it does not turn the job green or waive an unrelated regression. This
comparison is advisory: it never replaces browser-smoke, layout locks, premerge evidence or
live QA. Never upload auth state, tokens, traces or raw app logs.

For a mobile or responsive ticket, reading code or a desktop-width window is never
verification. Anything short of a real 390x844 screenshot on production with the flag on is not
a pass (Valentin, 2026-09-11, after a mobile ticket passed on desktop and was broken on his
phone).

## Evidence

Everything lands under `~/.local/state/vcc-evidence/<TICKET>/<YYYY-MM-DD>-qa-run-<n>/`.
Evidence is proof, not a checkout: never build, install or keep a browser cache there. Rules
and the offline build lifecycle are in
`.claude/skills/verify-qa/reference/evidence-storage.md`.

Write `<TICKET>/proof.md`:

```text
Feature map: .claude/skills/verify-qa/reference/feature-map/<page>.md
Doctor: sha <latest-merge-sha> deployment success; /my-tasks signed in as user <id>
Run: <YYYY-MM-DD>-qa-run-<n>

## Cases
- PASS: <case> -> <nonempty-file-in-run-folder>
- FAIL: <case> -> <file, steps, actual behavior>
- UNREACHABLE: <case> -> <reason; closest real check>
```

`ship-check proof <TICKET>` must print `proof ok`, and it belongs to the production target
only: it reads the merge sha and requires the `Doctor:` line to name that sha and its
`success`, so it cannot pass before a merge exists. A local or PR-visual run proves itself
with its own run folder: the cases, the served HTML, the 390x844 shot, that folder named in
the ticket comment, and, for a visual run, the current-head run URL. A FAIL case cannot pass.
Publish the self-contained HTML report as a ticket page with `vcc pages create`, then post one
`vcc comment add <TICKET> --kind qa` verdict with the report link, the proof and the
attachments, and read it back. PASS explains what changed and the ticket moves to Done. FAIL
keeps it In Progress and names the exact case. After two failed repairs use the
ticket-only handoff; do not message a lead. Never invent a pass.

Visual proof is one line plus the GitHub run link:
`Checked <screens> at desktop/phone in Porcelain: PASS / FAIL / SETUP FAILED. <run URL>`.
Name any approved difference. Unavailable Actions proof is blocked, not verified. Design
proof attaches the side-by-side images and `report.md` to the same QA comment.

## Cleanup

Kill only what you started: the dev server by its recorded pid, then the database you created.
Never kill by process name.

```bash
kill "$(cat <run-folder>/dev.pid)"
docker rm -f hypertask-verify-db
docker volume rm hypertask-verify-db
```

Remove your own fixtures through product surfaces only, never SQL:
`node .claude/skills/verify-qa/scripts/fixture-cleanup <state-file> <taskId...> --base-url
<origin>`. Design and phone runs start and close their own headless browsers and create no
rows. Actions owns its disposable services. The daily pruner removes old allowlisted build
debris and Done-ticket videos under its age rules (`evidence-prune` dry-runs by default, the
timer applies it); it never removes a run folder you just wrote. Run cleanup after every failed
iteration too, and confirm the evidence survives it: a cleanup that eats the proof fails.

## Helpers

Every script below is executable and is invoked exactly as shown.

| Helper | What it proves |
|---|---|
| `.claude/skills/verify-hypertask/bin/ht-verify up` | the disposable local stack starts and answers 200 on /login |
| `.claude/skills/verify-hypertask/bin/ht-verify doctor` | the local page, database, dev pid and QA identity all pass |
| `.claude/skills/verify-hypertask/bin/ht-verify down` | only this session's dev server and database stop |
| `.claude/skills/verify-hypertask/bin/ht-verify login [account]` | the chosen QA account's state loads as the expected user |
| `.claude/skills/verify-hypertask/bin/ht-verify seed` | the disposable database seeds and the local state loads as a real user |
| `.claude/skills/verify-hypertask/bin/ht-verify shot <url> --out <png>` | the page renders signed in, never a login landing |
| `.claude/skills/verify-hypertask/bin/ht-verify session start` | one persistent browser the later `open`, `click`, `fill` and `shot --session` share |
| `.claude/skills/verify-hypertask/bin/ht-verify click <selector>` | a real click lands and the page reacts |
| `.claude/skills/verify-hypertask/bin/ht-verify fill <selector> <text>` | a field accepts typed input on the real page |
| `.claude/skills/verify-hypertask/bin/ht-verify api <method> <path>` | an authenticated API call answers through the run's own cookies, writes behind `--confirm` |
| `.claude/skills/verify-hypertask/bin/ht-verify logs` | the dev or browser log shows what happened |
| `.claude/skills/verify-qa/scripts/qa-login [account] [--state]` | QA identity and state path for an account |
| `.claude/skills/verify-qa/scripts/qa-identity <state> --expect <id>` | the state loads as the expected user (`identity ok` or `identity expired`) |
| `.claude/skills/verify-qa/scripts/qa-teams` | the free, pro and byok team accounts load on their own plan and AI usage answers |
| `.claude/skills/verify-on-phone/scripts/phone-shot.sh <url> <out.png>` | one headless shot at 390x844, refusing a login landing |
| `.claude/skills/verify-design/scripts/design-check doctor` | QA state, QA identity, board 7049 and the theme cookie |
| `.claude/skills/verify-design/scripts/design-check run <TICKET> <url> --frame <png>` | per-theme live shot, score, purple, sparkle and corner audit |
| `.claude/skills/verify-design/scripts/design-check fail-column <section...>` | the intake column a design FAIL belongs in |
| `.claude/skills/verify-qa/scripts/inbox-cycle-live.mjs <dir> [--phone]` | the core inbox cycle on production |
| `.claude/skills/verify-qa/scripts/fixture-cleanup <state> <taskId...>` | deletes only fixtures the run created, through product surfaces |
| `.claude/skills/verify-qa/scripts/evidence-prune` | ages out old build debris; dry-run unless `--apply` |
| `.github/scripts/feature-map-coverage.cjs [--strict]` | map coverage count against real routes and flags |

`verify-qa` and `verify-design` scripts are owned by
`.github/workflows/ship-scripts-tests.yml`, which runs their tests on these paths; keep the
paths and the tests together if they move. The skill pack eval
`.claude/skills/evals/run-evals.sh` checks that every `SKILL.md` is indexed, that each INDEX
path exists, and that every script a skill names is present. When the workflow, spec, config or
screen paths change, reconcile this file's screen map with source, and review every mapped
screen in the next natural GitHub run: the drift check
`tests/verify-visual-skill.test.cjs` runs in GitHub CI, never on the VPS, and fails when a
screen is documented but not captured, or captured but not documented. Keep the maps honest
with [maintain-verification-skill](../maintain-verification-skill/SKILL.md), which owns the
weekly source check and the Monday live job.
