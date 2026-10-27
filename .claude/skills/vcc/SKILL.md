---
name: vcc
description: Own a Hypertask ticket through board writes, review, merge, deployment, and live verification.
---

# Own the ticket

Start with [/ship](../ship/SKILL.md). It owns selection, claims, the proof ledger, exceptions, and cleanup. This skill covers board identity and the release routine. Follow [repository policy](../../../AGENTS.md), the current token ladder, and house rules. A runner handles one ticket end to end; helpers do not write to boards. Helper models follow the Sol, Terra, Luna ladder in [/ship](../ship/SKILL.md).

## Board identity

Read `ship-identity` before writing. Use `vcc` for every board mutation, including comments, assignments, moves, attachments, pages, and activity. Never use human credentials, another agent's token, or plain `hypertask` for writes. Reads use the approved CLI, MCP, or product APIs, never direct database access.

Use `ship-claim` with your actual resume command before investigating. It assigns your agent before posting the claim to agent activity, then checks activity and legacy comments for collisions. Stop on failed assignment or a losing claim. Preserve existing human assignees and manual moves; add only your own agent, never Valentin. Read back each board write. If `vcc` fails, stop and record the blocker through the authorized path when available; never switch identity to work around it.

Keep the ticket In Progress while actively working. Resume AI Review tickets there before fixing them. Use the shared `tickets` skill: human decisions and QA use their kinds; plans, tests, and progress go to agent activity. Keep technical status, session names, resume commands, and handoffs in agent activity only; people comments contain results and evidence links. Runners report on tickets, never through Valentin's browser or another session's chat.

## Before opening the PR

Use your own worktree and the repository's correct base. Keep one ticket and one PR together. Recover the existing PR when present. Follow the current flag policy and release risk; do not widen an existing flag or introduce a new component without required approval.

Push the branch and require targeted checks in CI. Never run tests or builds on the VPS. A killed local check, SIGKILL, or exit 137 alone is not a blocker; let CI decide. Use the repo's [fix-bug](../fix-bug/SKILL.md) or feature workflow, including its simplification and UI checks. Start the PR body with **Summary for non-engineers** and use an honest accepted type. Leave auto-merge off and bind the PR to the ticket through `ship-check`.

## Merge and deploy

1. Read the PR merge state. Resolve conflicts before investigating checks. Read fresh ticket comments and reactions before merging; later corrections still apply.
2. Mint a runner App token for GitHub commands. Stop if minting fails; never fall back to Valentin's saved login. Wait with `~/.local/lib/hypertask/runner-pickup/ci-wait <PR> --repo hypertask-ai/hypertask --timeout 1800` using the runner App token. GitHub notifications trigger fresh reads; the fallback is ten minutes. Never use `gh pr checks --watch` or `gh run watch`. Refresh an expired token rather than starting duplicate watchers.
3. Require all required checks on the current PR head and the latest completed production App Smoke health check to pass. A skipped required test is not a pass. Run `ship-check guard` explicitly in hookless sessions. Do not bypass branch protection or approvals.
4. Merge only self-mergeable work. Protected Agent Kit changes go to HT Product Lead on the ticket for review and merge. Money, access, security, irreversible changes, and release changes retain their required decision/review path. A guard block names work to finish, not a check to evade.
5. Require Production deployment `success` for the merge SHA. Use headless deployment status, never browser reloads. Record merge and deployment evidence in agent activity. A merged PR is not proof that production changed.

## Verify and close

Load [verify-qa](../verify-qa/SKILL.md) after deployment and read the matching feature-map recipe. Write the checklist first. Use headless Playwright and the authorized QA identity for the path, never Valentin's account or browser. Confirm the doctor before judging the feature. Every app deployment includes the core inbox cycle.

Drive the real parse or dispatch entry point, prove side effects, and reload saved results. Include the declared flag mode and flag-off case where relevant. Changed UI needs desktop and phone captures in all four themes plus a short main-path video. Mocks, previews, and helper-only tests do not replace live proof. Record unreachable paths and the closest real check instead of inventing success.

Store proof, checklist, captures, and the self-contained HTML report in the ticket's evidence folder outside the worktree. Publish the report as a ticket page. Post one QA verdict with report link and key attachments; read it back. Run the proof and documentation gates before closing.

- PASS: explain what changed for the user, link the merged PR and report, and move to Done only after the gates pass. Give the exact place and short steps to try it.
- FAIL: keep In Progress. For flagged behavior, use the emergency failure path to hold it at Owner + QA before repairs. Re-run deployment and live verification after repair. After two failed attempts, record the blocker and hand off; do not claim completion.

A real human decision uses one Question in the house-rules tickets skill format: max 3 plain bullets, then Question, My recommendation, Why, Yes, No. No outside links or product precedents. Never use Valentin Review simply to ask for a flag switch. Keep decisions, flags, and follow-up work on their existing product surfaces; never build another decision inbox. Finish with /ship's session-scoped cleanup and proof.
