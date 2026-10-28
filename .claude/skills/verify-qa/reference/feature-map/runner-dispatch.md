# Runner dispatch

## How a customer reaches it

HT Product Lead and the runner timers run `.claude/skills/ship/scripts/runner-dispatch` from the live copy that `runner-selfupdate` installs (`~/projects/ht-skills-live`). It reads Claude panes through `runner-snapshot` (next to it, else `~/.claude/skills/runners/scripts/runner-snapshot`), adds hax panes from tmux, reads the boards, and plans which free ticket goes to which idle Claude runner. Hax panes prevent false outage alarms but never receive Claude commands. This is infrastructure, with no app UI.

## How to drive it

After the change is merged, wait until the live copy contains the change (`grep` a new name in the live script), then run it without `--go`: it only prints the plan, one line per runner with state, held tickets and the planned ticket. Load the live script in Python and call `snapshot_script()` and `snapshots()` to see which snapshot script it uses and how many runner rows it reads.

For a runner takeover, `ship-claim` first resolves the claim race, then shows existing question links and records one handoff in agent activity. Read each question's replies and reactions, including older comment pages. Reuse an unanswered question; edit only your own question, otherwise bump its original link in agent activity. Never ask it again.

Verify takeover changes with `bash .claude/skills/ship/scripts/ship-claim.test.sh` from the installed production copy. The full-flow replay must keep the original question, show its link, and write an agent-lane handoff without another question. Read the original incident's comments through the CLI to confirm their links and replies remain available. Never claim another runner's real ticket for QA.

For completion holds, run `ship-claim hold <ticket>` from the installed production copy, with your own `SHIP_SESSION_NAME` and runner App GitHub authentication. This is read-only: never run a real claim as a test. A runner's other assigned In Progress, QA or AI Review ticket with a merged production PR must print `HOLD`, its full ticket URL, the live-QA/flag/Done next step, and exit 4. Resuming recognized unfinished work remains allowed, even with another open PR or unfinished merged ticket. Done and flag columns do not create completion holds.

Replay `ship-claim.test.sh` for permitted claims and failed, malformed or incomplete reads, including both boards and later pages. Save the actual command output and exit status. A live fleet-cap claim additionally needs twenty-four hours of open-PR counts at or below the configured runner count; a single snapshot is not that proof.

The installed `~/.local/bin/session-policy-guard` runs first, even for a
read-only plan. It audits active subscription settings and refuses fast or
router drift before any board read or work delivery. The private company pack
owns the guard. A missing guard is a refusal, never an implicit approval.

The standing hax pool source is `.claude/skills/ship/scripts/ht-hax-runner`.
`ht-hax-runner check` validates its exact pinned launch options without creating
an identity, pane, prompt or model request. It also checks admission before
creating a new pool pane and before each subsequent ticket session. Install
updates only after its owning runner finishes; never interrupt active tickets.

## What usually breaks

- A helper script the dispatcher calls is not where it looks (YPER4-577: `runner-snapshot` stayed in the runners skill).
- The live copy is still the old version because selfupdate has not run yet.
- A runner shows the wrong state because its pane title changed.
- `--go` claims a ticket another runner already holds.

## What proof to collect

The resolved snapshot path, the runner row count, the subscription guard verdict, `ht-hax-runner check`, and the read-only plan output with exit codes, rendered to a PNG. Never run `--go` for QA. Never print tokens.

## Zero-runner alarm

With no runner panes, each tick logs `runner-dispatch: 0 runner panes found`.
Only `--go` queues an alarm, at most once per hour, using the existing
`runner-inbox/infra-manager.events.jsonl` lock and event schema. Load above 12
and `token-ladder/reserve.json` with `runners_paused: true` suppress the alarm.
Hax sessions named `hax-pool-*`, `hax-runner-*`, `ht-hax-runner-*` or
`tl-*-hax` count, as do panes titled `RUNNER N hax`.

For outage QA, use an isolated tmux socket and temporary HOME/state. Call the
installed dispatcher's real `snapshots()` and `run()`; replace only board reads
with empty fixtures. Create one hax pane, delete it, tick twice, and restart it.
Require no alarm while present, the warning on both empty ticks, exactly one
queued event, and no warning after restart. Never stop real runner panes.

## Cleanup

Remove only the isolated tmux server and temporary QA state.

## Freeze recovery

Entry points: installed `runner-pickup run <n>` (queue only),
`runner-pickup drain <n>` (one audited move), and keeper startup.
The recovery epoch is recorded only after successfully lifting a real freeze;
see `docs/ci.md`. Never invent a shared epoch to make a real ticket eligible.

For live proof, use disposable Fleet Infra fixtures assigned only to this
runner, clearly marked as synthetic. Give both a same-runner freeze-block
comment and the Agent Blocked section. Use an isolated `RUNNER_INBOX_DIR`,
record the synthetic lift there, then post a newer block on the control.
Run the installed drain command: the older fixture must move to In Progress
and gain an agent audit; the newer control must stay blocked. Drain again: the
ready handoff must repeat without another move or audit. Acknowledge only this
synthetic ticket with `runner-pickup ack <n> <ticket>`, then drain must be empty. Read both back
through the CLI and delete only these fixtures afterward. Keep the live
runner's normal inbox and freeze record untouched. Record that existing
running keeper processes use their original code until a safe restart.

Offline: `python3 .claude/skills/ship/scripts/runner-pickup.recovery.test.py`
exercises missing epochs, fresh/human/decision blocks, complete pagination,
one-ticket recovery, pickup invalidation, failed moves, failed-readback replay,
conditional-write races, reassignment, mixed blockers and repeat drains.
The dispatch path is `vcc raw POST /mcp/tasks/update` → MCP section update →
`/api/tasks/moveTask` → `updateTaskSingle` with section/revision preconditions.
A post-read concurrent hold must return 409 and remain untouched.
