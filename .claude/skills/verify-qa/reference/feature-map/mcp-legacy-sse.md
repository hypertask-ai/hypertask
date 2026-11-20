# Legacy MCP SSE transport

## Sub-features

- `legacy-mcp-sse-transport` Legacy MCP SSE transport.

## How to get to it (user POV)

- Legacy MCP clients connect to `GET https://app.hypertask.ai/sse` and send messages to `POST https://app.hypertask.ai/message` with their own bearer token.
- `/sse` exports POST and DELETE and `/message` exports GET and DELETE, but every method other than those two returns 405 Method Not Allowed. Only `GET /sse` and `POST /message` do transport work.
- Current clients use `/mcp`; their requests must not count as legacy SSE usage.

## Driving it with agent-browser

1. Doctor: confirm the merge deployment succeeded and a QA account is signed in on `/my-tasks`.
2. Use a QA account's own bearer token, never the owner's token. Make a GET `/sse` request with a unique user agent and `Accept: text/event-stream`. Bound the connection (for example `timeout 12 curl -sN`) and close it after the first `event: endpoint` frame, which carries `data: /message?sessionId=<id>`. Expect HTTP 200 and `content-type: text/event-stream`.
3. Query PostHog for `mcp_legacy_sse_request` with that unique user agent, using a read-only API credential that holds `query:read`. Check endpoint, verified user id, user agent, and timestamp against the request. Allow bounded ingestion time before judging absence. Without a `query:read` key this step is verified-unreachable; the closest real check is the 200 and the `event: endpoint` frame.
4. Probe `POST /message?sessionId=test` with no token: 401 JSON-RPC `-32001`. Probe `POST /mcp` with no token: 401 JSON-RPC `-32001`.
5. Probe `POST /sse` with a valid token: 405 Method Not Allowed.

## Gotchas

- Long-lived streams can lose buffered events when a serverless invocation ends. Capture immediately and keep the promise alive with `waitUntil`.
- Query strings can contain session ids or tokens. Record only the endpoint pathname, never headers or the full URL.
- `GET /sse` needs `Accept` containing `text/event-stream`, `*/*` or `text/*`, else 406. `POST /message` needs `?sessionId=` (400 without it) and `Content-Type: application/json` (400 without it). A missing `REDIS_URL`/`KV_URL` answers 503.
- A failed or absent PostHog client must not fail or delay the transport response.
- Reconnects count as requests, not unique clients; bots and unauthorized traffic are distinct from authenticated use.

### What proof to collect

- Signed-in `/my-tasks` desktop 1440x900 and phone 390x844 screenshots, plus a short video for doctor.
- Request status, response headers and bounded body, without tokens or cookies.
- A read-only PostHog result showing the unique user agent and all requested event fields.
- Account user id and tier, merge sha and deployment success, and local regression test results.

### Automated evidence

`node --test tests/mcp-sse-analytics.test.cjs` exercises legacy-route analytics with mocked transports: verified and anonymous identity, sanitized metadata, exclusion of current MCP requests, and unchanged responses when analytics fails.

### Cleanup

Close the SSE connection. No board writes or fixtures are needed. Keep only non-sensitive request and analytics evidence.
