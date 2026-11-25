# MCP and CLI project listing

## Sub-features

- `mcp-and-cli-project-listing` MCP and CLI project listing.
- `board-team-id` With `htpr-8413-board-team-id` on, each project from `GET /api/mcp/projects` includes `teamId`, the board's team id or null, when the caller does not project fields. A `fields` list includes `teamId` only when it names `teamId`. Flag off omits the field. The flag defaults to Everyone.

## How to get to it (user POV)

- Run `hypertask projects list` with the caller's own login.
- Agent and CLI clients use `GET https://app.hypertask.ai/api/mcp/projects`.

## Driving it with agent-browser

1. Confirm deployment success and QA account 985's signed-in doctor page.
2. Use an agent's own token for read-only project requests. Never print tokens or use Valentin's token.
3. List projects with no parameters. Require success, project metadata, and pagination information.
4. Request `?limit=1`, then request its returned cursor. Check that pages do not repeat projects. Test `offset=1` and `fields=id,title` too.
5. Request `limit=0`, `limit=nope`, `limit=1.5`, `offset=nope`, `offset=-1`, and `sort_order=sideways`. `offset=nope`, `offset=-1` and `sort_order=sideways` return HTTP 400 with a readable message. With `htpr-8018-project-page-size` on (the current default) the three bad `limit` values return 200 with `limit: 50` instead, because the value falls back rather than failing; flag off they return 400 as before.
6. Request `sort_order=DESC` and `limit=1000`. Both succeed; the page limit stays capped at 100.
7. Without authentication, require HTTP 401. Project visibility must remain scoped to the authenticated caller.
8. With `htpr-8413-board-team-id` on, list projects with no `fields` parameter. Every project has `teamId` as a string or null, and no other new field. `fields=id,title` omits `teamId`. `fields=id,teamId` keeps it. Flag off omits `teamId` on the unfiltered list. Do not switch the flag on production. Read-only.

## Gotchas

- Unchecked pagination reaches the database as zero, NaN, or oversized integers.
- Empty zero-sized pages dereference a missing last project while creating a cursor.
- Invalid sort values reach the database instead of returning a readable validation error.
- Validation accidentally changes ordinary listings, metadata, or cursor pagination.
- A `fields` list drops `teamId` while `htpr-8413-board-team-id` is on, unless the caller names `teamId`.

### What proof to collect

- Sanitized HTTP statuses and response summaries for valid and invalid requests.
- Default listing, projected page, distinct cursor pages, and scoped caller identity.
- Signed-in doctor screenshot, deployment commit, and core inbox-cycle evidence.

```bash
TOKEN=<a QA agent bearer token>
B=https://app.hypertask.ai/api/mcp/projects
curl -s "$B?limit=1" -H "Authorization: Bearer $TOKEN"                 # 200, nextCursor
curl -s "$B?fields=id,title" -H "Authorization: Bearer $TOKEN"        # 200, no teamId
curl -s "$B?fields=id,teamId" -H "Authorization: Bearer $TOKEN"       # 200, teamId kept
curl -s "$B?sort_order=sideways" -H "Authorization: Bearer $TOKEN"    # 400
curl -s "$B"                                                          # 401 without a token
```

`sort_order` is case-insensitive (`DESC` works) and the page size stays capped
at 100. `fields` is projected after `teamId` is attached, so naming `teamId`
keeps it and leaving it out drops it.

### Automated evidence

`node --test tests/htpr-8026-project-list-input.test.cjs tests/mcp-list-query-contract.test.cjs tests/htpr-8017-project-list-sort.test.cjs`
runs the project-list handler with a storage-boundary fixture.

### Cleanup

Read-only requests. No project or task fixtures.
