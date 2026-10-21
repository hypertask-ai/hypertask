# Repo workflow detail

Read AGENTS.md Repository Workflow and the clean-up skill for the rest.

Merging to `production` deploys app.hypertask.ai in about 3 minutes.

9. **The old private repo is archived.** `valentinyeo/hypertasks`, now `hypertask-ai/hypertasks`, is read-only history with a 2023 `.env` commit: never push to it, base work on it, mirror it or make it public. Its `staging` and `main` branches are dead.

Every access or security fix adds a "still allowed" test next to its "now refused" test: a legitimate caller (owner, member, guest, agent or OAuth client, whichever the change touches) goes through the same changed boundary and still succeeds. AI review returns CONCERNS when such a PR lacks it; a green suite alone does not count. The required `mcp-cli-api-contract` check guards MCP, CLI and API for allowed callers. (Valentin, 2026-10-13, https://app.hypertask.ai/detail/project-4060/352)
