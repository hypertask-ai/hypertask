# Repo workflow detail

Read [Repository Workflow](#repository-workflow) and the clean-up skill for the rest.

Merging to `production` deploys app.hypertask.ai in about 3 minutes.

9. **The old private repo is archived.** `valentinyeo/hypertasks`, now `hypertask-ai/hypertasks`, is read-only history with a 2023 `.env` commit: never push to it, base work on it, mirror it or make it public. Its `staging` and `main` branches are dead.

Every access or security fix adds a "still allowed" test next to its "now refused" test: a legitimate caller (owner, member, guest, agent or OAuth client, whichever the change touches) goes through the same changed boundary and still succeeds. AI review returns CONCERNS when such a PR lacks it; a green suite alone does not count. The required `mcp-cli-api-contract` check guards MCP, CLI and API for allowed callers. (Valentin, 2026-10-13, https://app.hypertask.ai/detail/project-4060/352)

## Hypertask project rules

- Public skills cover board work only. Keep roughly 3-6 skills: tickets, moves, comments, CLI/MCP. (2026-10-25, why: keep the public scope small)
- Internal agent tools stay outside public repositories. (2026-10-25, why: keep internal tooling private)
- Hypertask skills reuse the shared agent method. Never duplicate that method here. (2026-10-25, why: prevent conflicting copies)
- Plain ticket comments use the agent lane. Verbose is fine. `question`, `qa`, and `done` use human threads. Use plain words, eight words per sentence. (2026-10-25, why: separate agent notes from human updates)
- Hypertask AI task-writer changes need Valentin's approval. This covers prompts, models, and output formats. (2026-10-25, why: preserve the approved writing behavior)
- Switch flags through the [existing request path](../skills/ship/SKILL.md#switching-flags-from-a-session-yper4-215). Follow its current approval requirements. (2026-10-25, why: keep one flag approval path)

## Claude Code and Codex sessions

- Claim before investigating or coding. Use `ship-claim` with the session's resume command; a competing claim means step back. Never work Abdul's tickets.
- Keep the ticket In Progress through coding, review, merge, deployment, and live QA. The same session owns the whole path. Close only with production proof.
- Use the current token ladder and explicit role models. Helpers never write to boards; the owner remains responsible for their work. Follow house rules for provider and delegation limits.
- Check `ship-identity` before board writes. Use only that identity through `vcc`; never copy credentials or write as Valentin. Read through `hypertask`, approved MCP, or product APIs. Never use Prisma, SQL, or database clients for ticket content, even for reads.
- Add only your own agent. Never replace assignees, remove a human, or assign Valentin, userId 6. Preserve his manual assignments and moves.

## Repository Workflow

- Branch from `origin/production` in your own worktree. Target `production`; `main` is frozen rollback history. Never base work on or push to archived `hypertask-ai/hypertasks`.
- One ticket, one PR. Recover an existing PR instead of duplicating it. Titles use a real HTPR, HYFA, or YPER4 ticket and an accepted type. Leave auto-merge off.
- Inspect existing worktree changes before committing. Never stash, discard, reset, or revert another session's work.
- Merge only after required checks pass on the current head. Resolve conflicts before diagnosing checks. Protected Agent Kit changes require HT Product Lead review and merge; see /ship.
- Production is Vercel `hypertasks-prod`, deploying `production` to `app.hypertask.ai`. Require successful deployment for the merge SHA, then live QA.
- Previews share production data and are visual-only. Use them only when requested or justified by runtime risk. Never create extra previews or treat them as a merge gate. Check readiness headlessly, never with repeated browser reloads.
- After Done, remove only this session's clean, unused worktree and merged branch from another directory. Keep dirty worktrees, open-PR branches, and other sessions' work. Follow [clean-up](../../.claude/skills/clean-up/SKILL.md).

## Worktree cleanup

Sessions must clean up after shipping: after the PR is merged into `production`, production is health-checked, and the worktree is clean and unused, record its absolute path and branch and remove only your own unused worktree and merged branch from another cwd. Never delete your own active cwd, another session's worktree, a dirty worktree, or an open-PR branch.
