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
| Name the pull request author family: a bare `Author-Model:` line, or a matching commit trailer. | `scripts/pstack-verifier.mjs`, `tests/pstack-verifier.test.cjs` |
| One ticket, one PR. Leave auto-merge off. | `.github/scripts/pr-title.cjs` binds this pull request only. `.claude/skills/fix-bug/scripts/open-pr.sh` refuses a second open PR for the same runner, tested by `tests/open-pr-script.test.cjs`. Auto-merge is nothing yet |
| Never stash or discard another session's changes. | nothing yet |
| Never use the archived `hypertask-ai/hypertasks` repository. | nothing yet |
| Verify the successful production deployment and live behavior before Done. | `.github/workflows/prod-health.yml` |
| Clean only your own finished worktree and branch. | nothing yet |
| No explanatory code comments. Express intent in code. | `eslint-local-rules/no-comments.mjs` |
| Hypertask board: 15 (https://app.hypertask.ai/project?id=15). | `tests/board-sync-stop-hook.test.cjs` |
| Mobile tap targets >= 44x44 at 390x844 touch across all 4 themes. | `e2e/smoke/mobile-design.spec.ts`, `tests/mobile-design.test.cjs`, `.github/workflows/mobile-verify.yml` |
| Mobile text inputs compute to >= 16px font size. | `e2e/smoke/mobile-design.spec.ts`, `tests/mobile-design.test.cjs`, `.github/workflows/mobile-verify.yml` |
| Mobile surfaces use 0, 2, or 4px corners (avatars/status-dots exempt). | `e2e/smoke/mobile-design.spec.ts`, `tests/mobile-design.test.cjs`, `.github/workflows/mobile-verify.yml` |
| Mobile screens have zero horizontal overflow or unellipsized clipping. | `e2e/smoke/mobile-design.spec.ts`, `tests/mobile-design.test.cjs`, `.github/workflows/mobile-verify.yml` |
| Mobile non-AI elements use no purple. | `e2e/smoke/mobile-design.spec.ts`, `tests/mobile-design.test.cjs`, `.github/workflows/mobile-verify.yml` |
| Mobile text fields expose the standard right-bound mic button. | `e2e/smoke/mobile-design.spec.ts`, `tests/mobile-design.test.cjs`, `.github/workflows/mobile-verify.yml` |
| Mobile user journeys pass with real taps at 390x844 touch. | `e2e/smoke/journeys.spec.ts`, `.github/workflows/mobile-verify.yml`, `.github/scripts/feature-map-live-daily.mjs` |
