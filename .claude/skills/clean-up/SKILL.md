---
name: clean-up
description: Remove the git worktrees and branches this session created, once their work is finished, so they do not clog the VPS. /ship runs it after a ticket is Done; Valentin can also type /clean-up in any session. It only ever touches this session's own worktrees and branches, never another session's.
---

# Clean up

Valentin, 2026-10-01: "I don't want this stuff to linger around as it clogs up the VPS." Valentin, 2026-10-02: "i need the clean up skill inside the session and should be scoped to the session."

**Scope: this session only.** Remove only worktrees and branches this session created (you made them with `git worktree add` or `git checkout -b` in this conversation). Never another session's, even if it looks abandoned. Server-wide cleanup is not this skill: Valentin does that in a separate session he asks for it by name.

Work from the main checkout (`~/projects/hypertask`), never from inside a worktree you are removing. Never `git stash`, never discard changes.

## For each worktree this session created

1. `git -C <worktree> status --porcelain` must be empty. If not, commit the work or ask Valentin; never discard it.
2. Skip it while its PR is still open (`gh pr list -R hypertask-ai/hypertask --head <branch> --state open`); say so in the report.
3. `git worktree remove <worktree>` (no `--force`).
4. Delete the local branch only when its PR is **merged** and the branch has nothing beyond what was merged: `git rev-parse <branch>` equals the PR's `headRefOid` (`gh pr view <pr> --json headRefOid`). Then `git branch -D <branch>` (we squash-merge, so lowercase `-d` always refuses). A closed but unmerged PR, or extra local commits: keep the branch and say so in the report.
5. `git push origin --delete <branch>` only when its PR is merged.
6. Keep QA evidence in `~/.local/state/vcc-evidence/`; it is never cleaned.

From /ship, `~/.agents/skills/ship/scripts/ship-check cleaned <TICKET>` must print `cleaned ok`; it is the last gate on the /ship checklist. If the session's ledger (`.unlazy/`) sits inside the worktree you remove, it goes with it: run `ship-gates` from the main checkout so the ledger survives.

## Report

- From /ship: one agent activity line on the ticket (`vcc activity add <TICKET> "Removed worktree <path> and branch <branch>"`).
- When Valentin typed /clean-up: one or two lines saying what was removed and what stayed and why (for example "1 kept: its PR is still open").
