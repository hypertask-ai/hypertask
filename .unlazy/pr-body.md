Summary for non-engineers
Check the post-deploy browser smoke result to see whether the live app opens its main views on desktop and phone.

What went wrong
The renewed login uses QA user 985, but the smoke paths still pointed at board 6859 and ticket 43. That board belongs solely to QA user 2343. QA user 985 gets HTTP 403 reading it, so the board, ticket and New Task checks failed despite a healthy login and generated Prisma client.

What changes
1. Point production browser smoke at QA user 985's existing private Midscene nightly QA fixture board, project 6121, and its persistent browser target ticket, number 1.
2. Pin both matching paths in the workflow instead of reading the stale repository variables.
3. Document the fixture and add a regression test for the configured paths.

What you will see
The smoke opens an accessible board and ticket, clicks the real card on desktop and phone, and checks that it stays open for ten seconds without reloading. The fixture stays unchanged.

Watch out for
Keep the persistent fixture board and ticket available to QA user 985. No new fixture is created, no account access is widened, and no production board content is written. The existing login, alert and rollback logic stay unchanged. This PR is intentionally left open for the owning session.

Evidence
- Branch Prod Health smoke passed on production as QA user 985: 16 checks passed, including desktop and mobile card-click retention. https://github.com/hypertask-ai/hypertask/actions/runs/37986069165
- Production failure on a7373f470: https://github.com/hypertask-ai/hypertask/actions/runs/37984280764
- Normal app API reads verified old board owner 2343 with no members, and replacement board owner 985 with no members and a visible normal ticket.
- Live read-only desktop and mobile card clicks passed as QA user 985.
- Targeted regression and UI-pattern checks: 54 passed. Full lint passed with 21 existing warnings.
- Ticket: https://app.hypertask.ai/detail/project-4060/227

🤖 Generated with [Claude Code](https://claude.com/claude-code)
