# Legacy MCP SSE transport

## How a customer reaches it

- Legacy MCP clients connect to `GET https://app.hypertask.ai/sse` and send messages to `POST https://app.hypertask.ai/message` with their own bearer token.
- The routes also expose POST and DELETE on `/sse`, and GET and DELETE on `/message`.
- Current clients use `/mcp`; their requests must not count as legacy SSE usage.

## How to drive it

1. Doctor: confirm the merge deployment succeeded and a QA account is signed in on `/my-tasks`.
2. Use a QA account's own valid bearer token, never the owner's token. Make a GET `/sse` request with a unique user agent. Bound the connection duration and close it after collecting its first response.
3. Query PostHog using the existing read-only API credential for `mcp_legacy_sse_request` with that unique user agent. Check endpoint, verified user id, user agent, and timestamp against the request. Allow bounded ingestion time before judging absence.
4. Probe `/message` without a token and confirm the existing 401 response plus an event with `user_id` null.
5. Probe `/mcp` without a token and confirm its existing 401 response without a legacy event for its unique user agent.

## What usually breaks

- Long-lived streams can lose buffered events when a serverless invocation ends. Capture immediately and keep the promise alive with `waitUntil`.
- Query strings can contain session ids or tokens. Record only the endpoint pathname, never headers or the full URL.
- The SSE route may already respond 405 for accounts on the stateless flag. Compare with its pre-change response; tracking must preserve it.
- A failed or absent PostHog client must not fail or delay the transport response.
- Reconnects count as requests, not unique clients; bots and unauthorized traffic are distinct from authenticated use.

## What proof to collect

- Signed-in `/my-tasks` desktop 1440x900 and phone 390x844 screenshots, plus a short video for doctor.
- Request status, response headers and bounded body, without tokens or cookies.
- A read-only PostHog result showing the unique user agent and all requested event fields.
- Account user id and tier, merge sha and deployment success, and local regression test results.

## Cleanup

Close the SSE connection. No board writes or fixtures are needed. Keep only non-sensitive request and analytics evidence.
