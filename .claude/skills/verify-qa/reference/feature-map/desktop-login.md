# Desktop human CLI login

## How a customer reaches it

The desktop pilot exchanges a sign-in code at `POST /api/cli/token-exchange`, then sends that human token in `Authorization: Bearer ...` to the same feature APIs as the web app. The existing `htpr-7699-desktop-cli-token` access flag controls these shared login paths; do not change its audience during QA.

## How to drive it

1. Doctor: confirm the merge SHA's successful Production deployment and QA 985 via cookie-authenticated `POST /api/app-shell/bootstrap`. Capture signed-in `/my-tasks` using the designated QA storage state.
2. Generate a code with the QA cookie at `POST /api/cli/generate-code`, exchange it without cookies, and retain the token in memory only. Never persist code, token, credential-bearing responses, HAR, trace or storage-state copies.
3. With bearer only, read creation defaults on QA Sandbox 7049. Create one uniquely named fixture through `POST /api/tasks/createGlobally` with those defaults, QA user 985 and board 7049. Read it again through the product API and confirm its board, title and author. No production board 15/4060 writes.
4. Exercise shared bootstrap, user profile, favorites, preferences and AI skills reads. Confirm the identity is QA 985 rather than a body/query actor. Exercise invalid-input POST validation for a legacy draft route and task creation; never modify another user's drafts.
5. Pair allowed Sandbox reads with a known foreign-board refusal, missing/invalid bearer refusals, and an existing runner agent token refusal on a newly supported human-only web route. Do not create or rotate agents for this test.
6. Repeat cookie reads, including a cookie plus conflicting/invalid bearer control. Repeat the human CLI exchange for plain account 2343 and require its newly supported paths to remain refused while the flag excludes it.
7. Local entry-point tests cover signed-cookie revocation, token revocation, expired/agent/scoped tokens, flag failure, origin checks and foreign ownership without changing live credentials, permissions, billing, integrations or webhook destinations. Browser-origin requirements remain for selected cookie sessions; verified CLI transport is not a browser session. The agent-run authenticator retains its existing invalid-bearer refusal.
8. Run the core live Inbox cycle after deployment. No paid AI generation is needed for an authentication change.

## What usually breaks

- GET defaults accepts desktop sign-in while POST save still returns 401.
- A shared fallback skips a direct cookie reader or loses the authenticated actor at a legacy adapter.
- A raw Authorization header bypasses an origin guard despite a different selected cookie identity.
- Agent/scoped credentials gain human access, or revoked signed cookies borrow another token.
- Full-login changes silently alter the agent-run authenticator's invalid-bearer refusal.

## What proof to collect

Record request method/path, status, asserted actor/board IDs, fixture persistence and cleanup. Keep response projections sanitized; never save credentials or full account objects. Use desktop and phone doctor screenshots plus a short recording of the isolated fixture's real detail view. Mark live credential revocation, administrative actions, billing and external integrations UNREACHABLE when intentionally not mutated; cite their local boundary checks instead of claiming live coverage.

## Cleanup

Delete only the fixture IDs created by this run through the supported product task APIs. Confirm they are no longer normal tasks. Never delete real tasks, credentials, agents, integrations, teams or boards.
