# PR queue picker

The installed `~/.local/bin/pr-drain-pick` runs before a hax runner chooses new
work. The runner first finishes its own PR or an answered assigned ticket.
An urgent board-15 Bug or Error Log ticket may take precedence.

## Verify without taking work

1. Run `SHIP_SESSION_NAME="RUNNER <number>" ~/.local/bin/pr-drain-pick --dry-run`.
   It reads GitHub with a freshly minted runner App token, never human login.
2. Compare the result against open production PRs. App drafts come first,
   oldest updated first; dependency drafts follow; failed non-draft PRs idle
   over six hours come last. Recently updated PRs stay with active owners.
3. `PR <number> <branch> <ticket-or-dash> <title>` names the next eligible PR.
   Dry-run does not create, renew or replace a PR claim.
4. `WAIT` means queued PRs exist but are active or claimed. No new ticket may
   be taken. `NONE` alone permits normal board selection. A failed read or
   unreadable claim must exit nonzero, never return `NONE`.
5. Replay `python3 .claude/skills/ship/scripts/pr-drain-pick.test.py` for
   concurrent claims, expiry, ordering, incomplete reads and error handling.
   Replay `ht-hax-runner.test.py` for installation and the delivered prompt.

The normal command publishes one claim directory under
`~/.local/state/pr-drain/claims/<PR>/owner`. Existing owner records remain
compatible. A shared file lock serializes inspection and replacement; claims
expire after three hours and the same runner renews its own claim. Keep active
board claims authoritative when adopting a PR. Resolve or close obsolete work
with evidence; never mark a PR ready just to lower the draft count.

## Fleet outcome

Record the live draft count separately. Shipping this picker does not prove
all drafts merged or closed. The ticket's zero-draft acceptance remains unmet
until a fresh GitHub read returns zero.
