---
name: clean-up
description: Remove finished git worktrees and branches so they do not clog the VPS. /ship runs it after a ticket is Done (this session's own worktree and branch). Valentin can also type /clean-up by hand to clear leftovers from every session on the server, using the safe rules below.
---

# Clean up

Valentin, 2026-10-01: "I don't want this stuff to linger around as it clogs up the VPS." Valentin, 2026-10-02: "put the clean up routine that is inside /ship into its OWN skill so that i can also trigger it manually."

Work from the main checkout (`~/projects/hypertask`), never from inside a worktree you are removing. Never `git stash`, never discard changes.

## Which worktrees and branches

- **From /ship (ticket is Done):** only the worktree and branch this session created for that ticket.
- **By hand (`/clean-up`):** every worktree of `~/projects/hypertask` that is safe to remove. Safe means all of these:
  1. `git -C <worktree> status --porcelain` is empty.
  2. Its branch has a merged or closed PR (`gh pr list -R hypertask-ai/hypertask --head <branch> --state all`), or no commits beyond `origin/production`.
  3. No file in it changed in the last 48 hours (Valentin, 2026-10-01: "Or forty eight hours").
  4. No running process has its cwd inside it (`readlink /proc/*/cwd`).
  5. It is not locked (`git worktree list --porcelain` shows no `locked`) and is not the main checkout.
  Anything that fails a rule stays. List it in the report with the reason; never force it.

## Steps for each one

1. `git worktree remove <worktree>` (no `--force`).
2. `git branch -d <branch>` (lowercase `-d`: refuses unmerged work).
3. `git push origin --delete <branch>` only when its PR is merged or closed and no open PR uses it.
4. Keep QA evidence in `~/.local/state/vcc-evidence/`; it is never cleaned.

Finish with `git worktree prune`.

## Report

- From /ship: one agent activity line on the ticket (`vcc activity add <TICKET> "Removed worktree <path> and branch <branch>"`).
- By hand: tell Valentin in one or two lines how many worktrees and branches were removed, how many are left, and why the rest stayed (for example "3 still have open PRs, 1 has unsaved changes").
