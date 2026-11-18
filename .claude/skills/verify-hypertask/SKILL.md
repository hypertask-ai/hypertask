---
name: verify-hypertask
description: Prove real Hypertask behavior by driving the app: local before the PR, Visual Regression before a UI merge, and production after every deploy. Use for app QA verdicts, design QA, mobile checks and post-deploy proof.
---

pstack: 0.15.43

# Verify Hypertask

One verification skill for `https://app.hypertask.ai`. `verify-qa`, `verify-visual`,
`verify-design` and `verify-on-phone` are pointers to this file. Built on Lauren Tan's
verification pattern: drive the app the way a user does, then leave evidence a second
person can read without you.

Never use Valentin's login or his browser. Never print a credential, a cookie or a
storage state file. Use headless Playwright with a QA identity from the helper list.
A test, a preview, an open PR or a local build is not live proof.

## Launch

Pick one target per run. Every recipe below is the repo's own.

**Local, before the PR.** Unmerged code, disposable database, no production data:

```bash
docker volume create hypertask-verify-db
docker run -d --name hypertask-verify-db \
  -e POSTGRES_USER=verify -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=hypertask \
  -p 5678:5432 postgres:14.0-alpine
export DATABASE_URL=postgresql://verify:verify@127.0.0.1:5678/hypertask
npx prisma generate
npx prisma migrate deploy
CI=1 __NEXT_AGENT_UPGRADE=security \
BETTER_AUTH_SECRET=local-placeholder-at-least-32-characters \
NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000 npx next dev -p 3000
```

Start it detached and keep its pid where Cleanup reads it:
`setsid nohup ... > <run-folder>/dev.log 2>&1 & echo $! > <run-folder>/dev.pid`. `Ready` in that log is not ready: the first page still compiles, up to a
minute cold. Ready means `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/login`
answers `200`. `CI=1` and `__NEXT_AGENT_UPGRADE=security` stop Next's agent upgrade nudge
from exiting the server before it serves. `npm run dev` also starts `stripe:listen`, which
local proof does not need.

A worktree whose `node_modules` is a symlink elsewhere cannot run Next: it fails on module
resolution. Run `npm ci` in that worktree first, and `npx prisma generate` after it.

**Production, after a deploy.** `https://app.hypertask.ai` counts only when
`ship-check deployed <TICKET>` prints `deployed ok` for the merge sha. A preview, an open
PR or a local build never stands in.

**Visual Regression** covers heavy UI. Heavy runs only in GitHub Actions, never on the VPS
and never locally. On a non-draft PR to production the comparison is the `visual-compare`
job in `.github/workflows/ci-tests.yml`: it reuses the one build the `browser-build` job
published and diffs each screen against the production baseline, so a screen change costs
one build. The `Visual Regression` workflow
(`.github/workflows/visual-regression.yml`) never runs on a PR; it owns the
production baseline capture, the Monday schedule and manual dispatches, and its
`scripts/visual-regression-ci.mjs` builds base then head serially with a disposable DB and
Redis, seeds through `scripts/seed-browser-smoke.mjs --visual`, waits for `/login` and
search health, then stops its own servers. No production data and no QA credentials. A
capture drives
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

Run this before judging anything, and again after a surprising failure.

Run only the checks for the target you picked under Launch.

```bash
.claude/skills/verify-qa/scripts/qa-login flags --state
.claude/skills/verify-qa/scripts/qa-identity <state> --expect 985
.claude/skills/verify-design/scripts/design-check doctor
.claude/skills/ship/scripts/ship-check deployed <TICKET>
gh pr checks <PR>
gh run view <RUN_ID> --json workflowName,headSha,event,status,conclusion,url,jobs
```

Local: a `200` from the page you will drive, and the QA state loading as user 985.
Production: require the Production deployment `success` for the latest merge sha first, then
capture signed-in `/my-tasks` and run `qa-identity`. `identity ok` means fix state loading;
only `identity expired` means refresh. A login landing is never a doctor pass.
Design runs end with `doctor ok`, which checks the QA state, the QA identity, QA board
`https://app.hypertask.ai/project?id=7049&surface=board` opening without a redirect, and the
theme cookie switching the page theme.
Visual runs: require the current PR head, the right base, and completed base and head
captures in the GitHub step summary. Queued, missing, stale, cancelled, skipped or
setup-failed runs are not visual proof, and a missing run can mean path filtering.

## Drive

Start from the map for the change: the customer map
`.claude/skills/verify-qa/reference/feature-map/INDEX.md`, one file per customer area with
Sub-features, How to get to it (user POV), Driving it with agent-browser and Gotchas, or the
ops map `.claude/skills/verify-qa/reference/ops-map/INDEX.md` for build, release, runner, CI
and monitoring recipes. The counter `node .github/scripts/feature-map-coverage.cjs
--strict` gates every PR and reads 310 of 310 mapped. The visual screen map above is kept
honest by `tests/verify-visual-skill.test.cjs`, which fails when a screen is documented but
not captured, or captured but not documented. Design screens use the recipe in
`.claude/skills/verify-design/features/README.md`, one `design-check run` per screen.

**Pre-PR local shot, 390x844.** Shoot the page your branch changes, then assert what the
user must see in the served HTML. The screenshot proves the look, the assertion proves the
state; neither alone is a pass.

```bash
.claude/skills/verify-on-phone/scripts/phone-shot.sh http://127.0.0.1:3000/verify-email \
  <run-folder>/verify-email-390x844.png
curl -s http://127.0.0.1:3000/verify-email | grep -cF 'Verifying your email'
```

A zero count, a login landing or a redirect away from the requested path is a FAIL. When
the correct state for the page may legitimately look blank or empty, shoot a baseline first
and compare against it, so a genuinely broken blank page is not read as the expected one.
Pass
`--state` only for a page that needs a session, `--viewport 1440x900` for desktop, and
`--theme porcelain|graphite|graphite-2|amoled|dia` for one theme. Both shooters refuse an
address whose path says sign-in, even when that page is the one you asked for
(https://app.hypertask.ai/detail/project-15/9462). For those pages prove the state with the
served HTML and name the missing screenshot in the ticket.

**Production journey.** Every app deployment runs the core inbox cycle:

```bash
node .claude/skills/verify-qa/scripts/inbox-cycle-live.mjs <run-folder>/inbox-cycle
```

Require `inbox-cycle ok`, add `--phone` for the mobile layout, and include it in the cases.
Then cover the paths the ticket touches: success, cancel, error, empty and reload; the flag
mode declared for that account and the flag-off path; and, for a visible change, 390x844 on
the real screen plus a short main-path video. Compare before and after. Record an
unreachable path as `UNREACHABLE` with its reason and the closest real check.

Pick the account with `qa-login`: `flags` (user 985, default), `plain` (user 2343, flag
off), `free`, `byok`, `pro`, `owner`, `member`, `guest`. It prints the user id, the state
path and the refresh route, never credentials.

Hands-free drives run against a disposable loopback stack and refuse anything else. Pass
`--base`, `--state` and `--board`; each prints `<area> ok` or the failing step:

```bash
node .claude/skills/verify-qa/scripts/board-drive-live.mjs <run-folder>/board --base http://127.0.0.1:3100 --state <state> --board <board-id>
```

`task-drive-live.mjs`, `comments-drive-live.mjs`, `flags-drive-live.mjs`, `ctrl-j-drive.mjs`
and `ai-chat-drive.mjs` take the same arguments.

**Design pass.** One command per ticket and screen, frame size as `--viewport`, themes the
brief names, `--press` to open an overlay:

```bash
.claude/skills/verify-design/scripts/design-check run <TICKET> '<live url>' \
  --frame <frame-name.png> --themes porcelain,amoled,graphite-2 --viewport 1920x1032
```

Every theme the brief changes needs its own approved frame; a theme with no frame stops the
pass and asks on the ticket. A theme the brief does not change gets a no-change check
against production before the merge. The approved frame wins over ticket text and over the
style guide. The builder never passes its own design QA; a different runner reads every
side-by-side and marks the checklist. Any purple, any sparkle icon, any corner other than 0, 2 or 4px is a
FAIL. A FAIL goes back to the intake column the board has (`design-check fail-column`),
never Done.

**Visual Regression triage.** Read the failed screen and viewport in the step summary, then
download the diff PNGs artifact inside its 7-day retention and compare expected (base),
actual (head) and the diff PNGs together:

```bash
gh run download <RUN_ID> --name visual-regression-diffs \
  --dir "$HOME/.local/state/vcc-evidence/<TICKET>/visual/<RUN_ID>"
```

A real regression is fixed, never blessed by regenerating expected images from head. An
intended change needs `Visual change approved: <ticket URL>` in the PR description.

## Evidence

Everything lands under `~/.local/state/vcc-evidence/<TICKET>/<YYYY-MM-DD>-qa-run-<n>/`.
Evidence is proof, not a checkout: never build, install or keep a browser cache there.
Rules and the offline build lifecycle are in
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

`ship-check proof <TICKET>` must print `proof ok`: it checks merge sha, format, run files and
screenshots. A FAIL case cannot pass. Publish the self-contained HTML report as a ticket
page with `vcc pages create`, then post one `vcc comment add <TICKET> --kind qa` verdict
with the report link, the proof and the attachments, and read it back. PASS explains what
changed and the ticket moves to Done. FAIL keeps it In Progress and names the exact case.
After two failed repairs use the ticket-only handoff; do not message a lead. Never invent a
pass.

Visual proof is one line plus the GitHub run link:
`Checked <screens> at desktop/phone in Porcelain: PASS / FAIL / SETUP FAILED. <run URL>`.
Unavailable Actions proof is blocked, not verified. Design proof attaches the side-by-side
images and `report.md` to the same QA comment.

## Cleanup

Kill only what you started: the dev server by its recorded pid, then the database you
created. Never kill by process name.

```bash
kill "$(cat <run-folder>/dev.pid)"
docker rm -f hypertask-verify-db
docker volume rm hypertask-verify-db
```

Remove your own fixtures through product surfaces only, never SQL:
`node .claude/skills/verify-qa/scripts/fixture-cleanup <state-file> <taskId...> --base-url
<origin>`. Design and phone runs start and close their own headless browsers and create no
rows. Actions owns its disposable services. The daily pruner removes old allowlisted build
debris and Done-ticket videos under its age rules (`evidence-prune` dry-runs by default,
the timer applies it); it never removes a run folder you just wrote. Run cleanup after every
failed iteration too, and confirm the evidence still exists afterwards. A cleanup that eats
the proof fails the run.

## Helpers

Every script below is executable and is invoked exactly as shown.

| Helper | What it proves |
|---|---|
| `.claude/skills/verify-qa/scripts/qa-login [account] [--state]` | QA identity and state path for an account |
| `.claude/skills/verify-qa/scripts/qa-identity <state> --expect <id>` | the state loads as the expected user (`identity ok` or `identity expired`) |
| `.claude/skills/verify-qa/scripts/qa-teams` | the free, pro and byok team accounts load on their own plan and AI usage answers |
| `.claude/skills/verify-on-phone/scripts/phone-shot.sh <url> <out.png>` | one headless shot at 390x844, refusing a login landing |
| `.claude/skills/verify-on-phone/scripts/phone-shot.mjs` | the same shot from Node, with the resolved Playwright path |
| `.claude/skills/verify-design/scripts/design-check doctor` | QA state, QA identity, board 7049 and the theme cookie |
| `.claude/skills/verify-design/scripts/design-check run <TICKET> <url> --frame <png>` | per-theme live shot, score, purple, sparkle and corner audit |
| `.claude/skills/verify-design/scripts/design-check frames <TICKET> <dir>` | the ticket's approved frames and `frames.tsv` |
| `.claude/skills/verify-design/scripts/design-check fail-column <section...>` | the intake column a design FAIL belongs in |
| `.claude/skills/verify-qa/scripts/inbox-cycle-live.mjs <dir> [--phone]` | the core inbox cycle on production |
| `.claude/skills/verify-qa/scripts/board-drive-live.mjs` | board open, columns, card and negative control on a loopback stack |
| `.claude/skills/verify-qa/scripts/task-drive-live.mjs` | task detail title and negative control |
| `.claude/skills/verify-qa/scripts/comments-drive-live.mjs` | comment posted and visible, negative control |
| `.claude/skills/verify-qa/scripts/flags-drive-live.mjs` | flag switch and its refusal without an agent token |
| `.claude/skills/verify-qa/scripts/ctrl-j-drive.mjs` | Ctrl+J opens the task writer, negative control |
| `.claude/skills/verify-qa/scripts/ai-chat-drive.mjs` | AI chat answers, negative control |
| `.claude/skills/verify-qa/scripts/drive-grade.mjs` | shared loopback guard, theme landing and pass/fail grading for the drives |
| `.claude/skills/verify-qa/scripts/drive-cli.mjs` | the shared Playwright driver the drives call |
| `.claude/skills/verify-qa/scripts/fixture-cleanup <state> <taskId...>` | deletes only fixtures the run created, through product surfaces |
| `.claude/skills/verify-qa/scripts/evidence-prune` | ages out old build debris; dry-run unless `--apply` |
| `.github/scripts/feature-map-coverage.cjs [--strict]` | map coverage count against real routes and flags |

`verify-qa` and `verify-design` scripts are owned by `.github/workflows/ship-scripts-tests.yml`,
which runs their tests on these paths; keep the paths and the tests together if they move. The
skill pack eval `.claude/skills/evals/run-evals.sh` checks that every `SKILL.md` is indexed,
that each INDEX path exists, and that every script a skill names is present. Keep the maps
honest afterwards with [maintain-verification-skill](../maintain-verification-skill/SKILL.md):
it owns the weekly source check and the Monday live job.
