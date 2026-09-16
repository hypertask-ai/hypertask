# Product rules

Rules that hold only for the Hypertask product board (project 15), the app repo
`hypertask-ai/hypertask`, and the dev/QA fleet that works them. Everything true
for any bot on any board lives in the company pack:
`$COMPANY_SKILLS_DIR/RULES.md` (`$COMPANY_SKILLS_DIR` is exported by the runner and points at the installed company-skills plugin, falling back to `~/projects/company-skills` when the plugin is not installed). Read that one first.

Two sections that read as product-only stayed in the company file on purpose,
because a supervisor script reads them by heading: `## Auto-added rules` and
`## Agent Blocked is emptied by acting`. Splitting a read path from its write
path fails silently, which is the worst way to fail.

Column names below are facts and they rot. `board.yml` next to the bot's conf
is the live map; `hypertask section list --project 15` is the board itself.

---

# Owner resume (Valentin, 2026-09-14)

Valentin turned the Cursor fleet back on. Cursor Dev, Cursor Dev 2, and Cursor QA are live. They drain Bugs only, then stop. Manager and Sol Dev 1 stay parked. Blocker detector and drain-watch are on again. Do not start Manager unless Valentin says so.

## Manager role (Valentin, 2026-09-11)
The Manager is the escalation target, not a loop. It runs only when the blocker script or Valentin calls it. Duties: 1) decide every ticket in HT Manager Review within the hour: retry with a note to the dev, park to Backlog, or push to Valentin Review (only money, auth, security, irreversible data, product direction). 2) Give agents what they ask for: a test login, a config value, a label, a second identity. Never park a ticket on a request the Manager can fulfil. 3) Rewrite the blocked agent's mission the same day, so the block does not repeat. 4) Never touch app code, never run on a timer. Database changes and CI repairs stop at HT Manager Review, not Valentin Review.

# Owner update: Manager stood down

Valentin removed Manager from the operating fleet on September 9. Dev1 and Cursor QA remain. The active CEO session directly owns unblocking. Do not start Manager, its loop, reconciliation or provider worker. The deterministic monitor remains enabled with supervisor=ceo and must not launch Manager or send Manager-timeout escalations to Valentin. Earlier Manager responsibilities below are historical until reassigned. Automatic CEO wake-up is not implemented; do not claim unattended coverage.

CEO checks only the current incident and changed evidence, verifies resumed work and shipping, and records proven recovery procedures before automating them. No broad recurring LLM review or dashboard work while PR drainage is blocked.

## Purpose and limits
Reliability comes first, avoiding waste second, staying within subscription means third. Keep useful work possible throughout the week. Completion means QA PASSED against deployed production behavior. A merge or deployment alone never completes a ticket. Features and major behavior changes stay behind Owner + QA feature flags until Valentin chooses a wider release. Bug fixes may deploy directly, especially severe bugs, and QA checks them on production.

The only active fleet is Dev 1, ht-bug-fixer; Cursor QA, qa-cursor; and Manager, ht-manager, hourly. Keep existing providers and hax. Never add agents, unpark stood-down agents, change models, budgets, timers or paid fallback on your own. A future two-dev/two-QA design is a proposal, not permission to launch it. Manager enables the two workers through unblocking and board hygiene. CEO sessions with Valentin own mission redesign and durable policy changes.

## PR and QA drainage, owner priority
Dev1 draining the existing main-repository PR queue is the primary priority. Cursor QA drains eligible deployed QA alongside it. Before routine work, read ~/.local/state/ht-drain-watch/status.json. Its deterministic timer checks every two minutes without model calls. New alerts request a Manager tick through the existing admission and overlap guards. Treat alerts as investigation requests, not proof of a stall. Investigate the exact active PR, last diff/test result, admission decision and blocking owner. A running service or a fresh heartbeat does not prove useful output. Record the resolved blocker or the specific next action; do not merely repeat queue counts. Never kill a healthy turn or override a provider limit.
After existing PRs are drained, Dev1 takes eligible QA-returned repairs, ranked by user impact, then the next eligible task. The captured backlog gate remains until existing work is resolved or the CEO explicitly releases it. Production emergencies retain their established exception. Definitions and repeated status messages do not count as output.

## Finish existing work
1. Clear existing open PRs first. Handle QA feedback that blocks the current repair before switching away. Rank older QA returns by actual user exposure and severity, not the Bugs or Features label alone. An exposed broken feature can outrank an unrelated PR; an older feature behind a disabled flag can wait. Dev 1 clears existing open PRs and their repairs before fresh work. Cursor QA drains deployed QA tickets alongside this work. No fresh backlog while the captured PR/QA pileup remains or until the CEO releases the drain gate.
2. Assignment is ownership, not active work. Dev 1 may own the QA queue but runs one provider turn at a time. Keep at most one ticket waiting for QA plus one other pre-existing pileup item under repair. The persisted pileup-drain.json admission snapshot is the gate; never add fresh tickets to bypass it.
3. A QA result on the waiting ticket takes priority at the next safe handoff. Repair or close that ticket before continuing the secondary item. Never kill a healthy provider turn to preempt it. Save the current diff, tests, blocker and next step before switching or waiting.
4. After QA passes and records evidence, close the ticket as Done. A flagged feature stays flagged. No wider release is required to finish. If QA cannot move a passed ticket, Manager repairs the permission or board transition; Dev 1 still records the pass and waits for closure.
5. Once the pileup is cleared and CEO releases the gate, Bugs precede fresh Features. A confirmed severe production incident may interrupt the queue through CEO direction or the established incident procedure.

## QA contract
Start with acceptance criteria, the latest shipping comment, PR state and production revision. For eligible deployed work, verify customer exposure and severity first. Severe live failures and exposed unverified changes take precedence over routine PR cleanup; disabled Owner + QA features follow. Within the same risk level, finish the current ticket, then take the oldest eligible work. Manager records exposure as public, flagged, or unknown from evidence; a QA section alone proves none of these. An open PR or pending deployment is not eligible for a claimed QA turn. Skip it without a verdict or repeated comment; record a waiting reason only when useful. A deployment or permission wait is never a product FAIL.

A claimed verification ends with a verified board transition: Done on PASS; origin Bugs, Features or Backlog on FAIL or missing verification evidence, retaining Dev 1; HT Manager Review on the third genuine FAIL. Resolve origin from ticket history. If a permission failure prevents the move, preserve the verdict and exact blocked action once, notify Manager and defer the turn without counting a completed verdict. Never fabricate a failure to empty QA.

Judge acceptance criteria and actual errors. A product concern that meets the criteria passes; record the concern separately in Backlog. For UI work, verify production browser behavior and attach screenshots. Use 390x844 mobile evidence when the change affects mobile. Exercise neighboring behavior relevant to the change, not a universal checklist. Route-only checks may use redacted method, path, status and expected outcome from the web app's route. CLI/MCP evidence alone does not prove a web change.

Features require isolated flagged QA and normal-user control sessions, confirming account IDs 985 and 2343. Storage states are /home/valentin/.config/hypertask-videos/storageState-qa.json and storageState-qa-normal.json. Never print cookies. Confirm a logged-in app page before claiming a browser check passed. Clean up only QA-created fixtures through the product interface; create fixture tickets in Backlog, then archive them before the verdict.

Worker, CLI, CI and infrastructure work can pass without a browser screen. Require proof that the deployed revision is active and a safe acceptance check of the live command, service or job, with redacted output and timestamp. A merged PR or unit test alone is insufficient. If QA lacks access, Manager gathers that specific operational proof for QA to judge. Missing evidence returns to the origin column with the exact required proof, without an invented product FAIL.

## Manager hourly check
Read this contract and compact STATE first. Fetch only new report-ticket instructions since the saved comment cursor, current queue counts and the three agents' current states. Report ticket: https://app.hypertask.ai/detail/project-5156/2. New instructions require an answer once; retain their comment IDs to avoid repeats. Do not reread archived files, full ticket threads, whole repositories or every old PR diff each tick.

Check production incidents, existing PRs, ready QA, returned repairs and blockers in that order. Inspect changed heads or new failures; unchanged dispositions stay recorded. Use current aggregate GitHub required checks, not remembered check names. When Dev 1 is actively repairing a PR, leave the final push and auto-merge readiness with Dev 1. CEO and Manager must not enable auto-merge on its behalf during that repair. Green checks establish the tested revision, not that the producer has finished its remaining changes. Manager may still resolve stranded PRs after confirming no active producer owns the repair. Route code repairs to Dev 1. Manager never writes, rebases or pushes application code. Do not bypass checks or change deployment policy to make a queue look green. Before CI, runner, ruleset or deploy work, read https://hypertask.app/wiki/deployment and the repository deployment guide. Low-trust PRs follow openwiki/low-trust-agents.md.

Inventory every open PR, including dependency PRs. Flag existing PRs missing from the drain manifest for CEO reconciliation; do not treat those PRs as outside the drain objective. Record PR count, QA count, oldest ready QA age, production QA passes and returns since the previous tick, and the current blocked ticket with owner and next action. Report a growing queue, a ready queue with no progress since the last hourly tick, or an active turn with no observed progress. Investigate before claiming a stall; quiet hax output alone is not evidence. Stop duplicate retry loops through the existing scoped guard only after verifying the actual run. Never restart a healthy busy worker or clear a current budget/park marker to force progress.

Keep alerts to one per unchanged episode. A pileup alert names its size, trend, blocker and next action. A running service is not proof of useful work. A local delivery marked done is not proof of a QA verdict. Check the board outcome. Do not infer a dead fleet from one collector failure; retry a failed collector once and report unknown telemetry if it still fails.

At the start write a short partial tick report; update STATE after useful actions so timeout preserves progress. Finish with one UTC quiet|action line in ~/.cache/ht-manager-loop/report.log and a plain-text Agent Chat entry, at most 1200 characters, in ~/.cache/ht-manager-loop/tick-chat-report.txt. The wrapper posts it. Comment on the report ticket only for a changed blocker, action, incident, pileup alert or unanswered instruction. Do not start catch-up ticks or recurring loops. Keep STATE under 100 lines and DECISIONS to current approved decisions, not an accumulating journal.

## Idle workers drain Bugs (Valentin, 2026-09-12)
Cursor Dev and Cursor Dev 2 must not sit idle while unassigned Bugs remain. Their scope is the Bugs column: when idle they discover and claim the oldest unassigned Bug, one ticket at a time, through QA. When Bugs is empty, they stop. Do not widen to Features or any other column. Slack PR 484 and Calendar PR 450 stay paused. Stale red PRs that need an owner decision stay owner decisions. This supersedes "no fresh backlog until the pileup drain is cleared" for the live Cursor fleet.

## QA verifies mobile tickets at phone width (Valentin, 2026-09-11)
Cursor QA passed a mobile ticket after checking desktop width or code only, and the real feature was broken on Valentin's phone. Mobile and responsive tickets now require a screenshot at a real phone viewport (390x844) on production before PASS; anything else is CANNOT VERIFY.

## Manager role (Valentin, 2026-09-11)
The Manager is the escalation target, not a loop. It runs only when the blocker script or Valentin calls it. Duties: 1) decide every ticket in HT Manager Review within the hour: retry with a note to the dev, park to Backlog, or push to Valentin Review (only money, auth, security, irreversible data, product direction). 2) Give agents what they ask for: a test login, a config value, a label, a second identity. Never park a ticket on a request the Manager can fulfil. 3) Rewrite the blocked agent's mission the same day, so the block does not repeat. 4) Never touch app code, never run on a timer. Database changes and CI repairs stop at HT Manager Review, not Valentin Review.

## Product Bot identity (Valentin, 2026-09-15)

"Advisor Fable" is renamed "Product Bot". It is now the single system account behind both the advisor session and every script (gate timer, blocker detector, night watch, morning report, budget guard). Comments a script posts start with the script's name in bold, so Valentin can tell which one wrote it even though they share one login. Dev 1, Dev 2, and QA 1 stay separate logins: tickets get assigned to a single hand, so those keep their own identities.

## Board groom timer (Valentin, 2026-09-15)

`ht-board-groom.timer` runs `ht-board-groom` at 07:00/08:00/09:00/10:00 Europe/Berlin against the product board (project 15). Triage: classifies each ticket Bug vs Feature with `claude -p --model sonnet` and moves it (plus board labels), or asks Valentin one question and leaves it in Triage (never re-asked inside 7 days). In Progress: challenges tickets stalled 3+ days with no open PR, and if the challenge itself goes 48h+ unanswered, moves the ticket back to Bugs/Features and unassigns the agent. Valentin Review: read-only, lists tickets 7+ days old in the morning report, never touched. Agent Blocked (Infra) and HT Manager Review are owned by other timers and always skipped.

Manual-override guard: a ticket with a bare `{id:6, no agent field}` assignee (Valentin assigned himself) or the `valentin` label is left alone entirely. Writes go through `htbot` (Product Bot); reads through `ht GET`. State lives in `~/.local/state/ht-board-groom/state.json`, keyed per ticket, so the four daily runs never double-classify, double-ask, or double-challenge the same ticket. It posts to HYFA-70 only when it actually moved, labeled, commented, or unassigned something; the state-dir summary feeds a "Groom" block appended to `ht-morning-report`. Full behaviour: `docs/board-groom.md` in `hypertask-ai/agent-skills`.

## In Progress means a live run (Valentin, 2026-09-15)

In Progress holds only tickets a live agent is working: a "Claimed." comment by Dev 1, Dev 2, or QA 1 within the last 2 hours with no later "Run failed"/"Paused" comment, or an open PR on hypertask-ai/hypertask referencing the ticket. Anything else is a leftover.

Leftovers move back to Bugs (CLI/Bug label, or title starting "CLI bug"/"Retire"/"Agent factory") or Features (everything else). Writes go through Product Bot (`htbot`) only; never touch a ticket with userId 6 (Valentin Yeo) among assignees or the `valentin` label.

2026-09-15 cleanup found 15 unassigned In Progress tickets with no live Claimed comment and no open PR (all crashed at start on a bad Cursor model id): moved 14 to Bugs, 1 (HTPR-6459) to Features. Done by hand this run; Valentin flagged that future clearing should run through Product Bot's supervisor mechanism, not a manual delegate pass.
