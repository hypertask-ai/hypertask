# Repo workflow detail

Read AGENTS.md Repository Workflow and the clean-up skill for the rest.

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
