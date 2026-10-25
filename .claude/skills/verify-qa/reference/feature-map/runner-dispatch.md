# Runner dispatch

## How a customer reaches it

HT Product Lead and the runner timers run `.claude/skills/ship/scripts/runner-dispatch` from the live copy that `runner-selfupdate` installs (`~/projects/ht-skills-live`). It reads runner panes through `runner-snapshot` (next to it, else `~/.claude/skills/runners/scripts/runner-snapshot`), reads the boards, and plans which free ticket goes to which idle runner. This is infrastructure, with no app UI.

## How to drive it

After the change is merged, wait until the live copy contains the change (`grep` a new name in the live script), then run it without `--go`: it only prints the plan, one line per runner with state, held tickets and the planned ticket. Load the live script in Python and call `snapshot_script()` and `snapshots()` to see which snapshot script it uses and how many runner rows it reads.

For a runner takeover, `ship-claim` first resolves the claim race, then shows existing question links and records one handoff in agent activity. Read each question's replies and reactions, including older comment pages. Reuse an unanswered question; edit only your own question, otherwise bump its original link in agent activity. Never ask it again.

Verify takeover changes with `bash .claude/skills/ship/scripts/ship-claim.test.sh` from the installed production copy. The full-flow replay must keep the original question, show its link, and write an agent-lane handoff without another question. Read the original incident's comments through the CLI to confirm their links and replies remain available. Never claim another runner's real ticket for QA.

## What usually breaks

- A helper script the dispatcher calls is not where it looks (YPER4-577: `runner-snapshot` stayed in the runners skill).
- The live copy is still the old version because selfupdate has not run yet.
- A runner shows the wrong state because its pane title changed.
- `--go` claims a ticket another runner already holds.

## What proof to collect

The resolved snapshot path, the runner row count, and the read-only plan output with its exit code, rendered to a PNG. Never run `--go` for QA. Never print tokens.

## Cleanup

None. Read-only without `--go`.
