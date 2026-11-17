# Desktop human CLI login

## Sub-features

- `desktop-human-cli-login` Desktop human CLI login.
- `cli-auth` Open `/cli-auth`. A signed-out person sees Authenticating HyperTask CLI and Checking your session. A signed-in person can allow a short-lived code for the terminal, or cancel and stay unlinked. Allow calls `POST /api/cli/generate-code`. The callback URL and one-time code then expire in about 2 minutes. The screen shows Local port from the `port` query, and 3456 when that query is missing.
- `login-agent` Open `/login/agent`. A signed-out person is sent to `/login?returnTo=%2Flogin%2Fagent`. A signed-in person who is not an agent is sent to `/cli-auth?agent=1` when `htpr-7552-agent-code-signin` is on and device pairing is enabled. An agent, a CLI bearer, a flag that is off, or pairing that is disabled gets a not-found page.
- `agent-code-signin` With `htpr-7552-agent-code-signin` on, `/cli-auth?agent=1` shows Sign in an agent and Create a free board for your agent. Get a five-minute code calls `POST /api/cli/device/start`. The screen then shows the command `hypertask login --code` plus that code, and the MCP server `https://mcp.hypertask.ai/mcp`. After the code is issued, the page polls `POST /api/cli/device/status`. After the agent asks, Approve and connect calls `POST /api/cli/device/approve`, and Decline calls `POST /api/cli/device/deny`. Connected shows Your agent is connected. When the flow includes a board URL, the page links to that board. The agent can read and change that new board only.
- `desktop-ai-chat-bearer` With `htpr-7684-desktop-ai-chat-bearer` on, a human desktop CLI bearer can call `POST /api/ai/chat/stream`, `POST /api/ai/chat/cancel`, and `GET /api/ai-chat/all-sessions` for that person's own chats. Agent, management, and team-scoped bearers are refused. A bearer that is not a human CLI token is refused. A sidebar chat header is refused. Flag off removes this bearer path. Cookie chat access stays as it is.

## How to get to it (user POV)

The desktop pilot exchanges a sign-in code at `POST /api/cli/token-exchange`, then sends that human token in `Authorization: Bearer ...` to the same feature APIs as the web app. The existing `htpr-7699-desktop-cli-token` access flag controls these shared login paths; do not change its audience during QA.

Open `/cli-auth` from the terminal sign-in link. Open `/login/agent` to start an agent code. That page continues at `/cli-auth?agent=1` only when `htpr-7552-agent-code-signin` is on. The human CLI bearer from this login is what `htpr-7684-desktop-ai-chat-bearer` allows into that person's AI chats.

## Driving it with agent-browser

1. Doctor: confirm the merge SHA's successful Production deployment and QA 985 via cookie-authenticated `POST /api/app-shell/bootstrap`. Capture signed-in `/my-tasks` using the designated QA storage state.
2. Generate a code with the QA cookie at `POST /api/cli/generate-code`, exchange it without cookies, and retain the token in memory only. Never persist code, token, credential-bearing responses, HAR, trace or storage-state copies.
3. With bearer only, read creation defaults on QA Sandbox 7049. Create one uniquely named fixture through `POST /api/tasks/createGlobally` with those defaults, QA user 985 and board 7049. Read it again through the product API and confirm its board, title and author. No production board 15/4060 writes.
4. Exercise shared bootstrap, user profile, favorites, preferences and AI skills reads. Confirm the identity is QA 985 rather than a body/query actor. Exercise invalid-input POST validation for a legacy draft route and task creation; never modify another user's drafts.
5. Pair allowed Sandbox reads with a known foreign-board refusal, missing/invalid bearer refusals, and an existing runner agent token refusal on a newly supported human-only web route. Do not create or rotate agents for this test.
6. Repeat cookie reads, including a cookie plus conflicting/invalid bearer control. Repeat the human CLI exchange for plain account 2343 and require its newly supported paths to remain refused while the flag excludes it.
7. Local entry-point tests cover signed-cookie revocation, token revocation, expired/agent/scoped tokens, flag failure, origin checks and foreign ownership without changing live credentials, permissions, billing, integrations or webhook destinations. Browser-origin requirements remain for selected cookie sessions; verified CLI transport is not a browser session. The agent-run authenticator retains its existing invalid-bearer refusal.
8. Run the core live Inbox cycle after deployment. No paid AI generation is needed for an authentication change.
9. Open `/cli-auth` while signed out and confirm Authenticating HyperTask CLI. Sign in as QA 985, open `/cli-auth?port=3456`, and confirm Allow and continue and Cancel. Do not press Allow unless you will discard the code. Press Cancel and confirm the declined copy, then Close.
10. Open `/login/agent` signed out and confirm the return to login. Sign in as QA 985 with `htpr-7552-agent-code-signin` on and confirm the redirect to `/cli-auth?agent=1`. Press Get a five-minute code. Confirm the command, the MCP server line, and a countdown from five minutes. Stop before Approve and connect. Let the code expire, or Decline if a claim appears.
11. With `htpr-7684-desktop-ai-chat-bearer` on, call `GET /api/ai-chat/all-sessions` with the human CLI bearer and confirm the sessions belong to that person. Repeat with the flag off, and with an agent bearer, and confirm both are refused. Do not start a paid chat generation.

## Gotchas

- GET defaults accepts desktop sign-in while POST save still returns 401.
- A shared fallback skips a direct cookie reader or loses the authenticated actor at a legacy adapter.
- A raw Authorization header bypasses an origin guard despite a different selected cookie identity.
- Agent/scoped credentials gain human access, or revoked signed cookies borrow another token.
- Full-login changes silently alter the agent-run authenticator's invalid-bearer refusal.
- `/login/agent` returns not found when `htpr-7552-agent-code-signin` is off. That is the flag, not a missing route.
- Approve only the agent you just started. The human CLI code lasts about 2 minutes. The agent code lasts five minutes.
- Do not send a paid AI chat to prove `htpr-7684-desktop-ai-chat-bearer`. The session list is the check.

### What proof to collect

Record request method/path, status, asserted actor/board IDs, fixture persistence and cleanup. Keep response projections sanitized; never save credentials or full account objects. Use desktop and phone doctor screenshots plus a short recording of the isolated fixture's real detail view. Mark live credential revocation, administrative actions, billing and external integrations UNREACHABLE when intentionally not mutated; cite their local boundary checks instead of claiming live coverage.

For `/cli-auth` and `/login/agent`, screenshot the consent screen, the declined screen, and the five-minute code screen. Record the session-list status for the human bearer, the flag-off bearer, and an agent bearer. Do not save the code or the bearer.

### Cleanup

Delete only the fixture IDs created by this run through the supported product task APIs. Confirm they are no longer normal tasks. Never delete real tasks, credentials, agents, integrations, teams or boards.

If you approved an agent, remove only that new agent board from this run. If you only generated a code, let it expire. Do not revoke the QA browser session.
