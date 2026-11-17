# Agent rule checks

Every rule in the `Always` list of [AGENTS.md](../../AGENTS.md) names the check that enforces it,
or says `nothing yet`. A missing check is an honest gap, not permission to skip the rule.
`tests/agent-rule-check-table.test.cjs` fails when a row drifts from that list,
or when a row names a check file that is not in the repository.

| Rule | Enforced by |
| --- | --- |
| Board reads use `hypertask`; writes use `vcc`. | nothing yet |
| Check `ship-identity` before writing. Never copy credentials. | `.github/workflows/gitleaks.yml` |
| Never access ticket content through database tools. | nothing yet |
| Claim before investigating or coding. Respect active claims. | `.claude/skills/ship/scripts/ship-claim.test.sh`, `.github/workflows/ship-scripts-tests.yml` |
| Add only your agent. Preserve human assignees. | nothing yet |
| Branch from `origin/production`; target `production`. | nothing yet |
| One ticket, one PR. Leave auto-merge off. | `.github/scripts/pr-title.cjs` binds this pull request only. A second pull request and auto-merge are nothing yet |
| Never stash or discard another session's changes. | nothing yet |
| Never use the archived `hypertask-ai/hypertasks` repository. | nothing yet |
| Verify the successful production deployment and live behavior before Done. | `.github/workflows/prod-health.yml` |
| Clean only your own finished worktree and branch. | nothing yet |
| No explanatory code comments. Express intent in code. | `eslint-local-rules/no-comments.mjs` |
