## Provider-neutral Done enforcement

`vcc` checks section changes through the installed `ship-check move` entry point.
Completed columns require the same merged PR, deployment, documentation and
app QA evidence as the Claude hook. Numeric references, section IDs and renamed
completed columns use board reads. Failed reads or a missing checker refuse writes.
The checker comes from the installed production skill, never the caller's worktree.
Protected wrapper and guard changes require an independent lead merge.
This is workflow enforcement, not an OS sandbox against same-user file edits.

`ship-scripts-tests` runs the offline wrapper fixtures. They cover refusal before
the board write and successful forwarding with completed proof, without real
credentials or live board mutations. No new required check is added.
