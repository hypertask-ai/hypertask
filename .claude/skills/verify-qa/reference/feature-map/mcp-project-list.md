# MCP and CLI project listing

## How a customer reaches it

- Run `hypertask projects list` with the caller's own login.
- Agent and CLI clients use `GET https://app.hypertask.ai/api/mcp/projects`.

## How to drive it

1. Confirm deployment success and QA account 985's signed-in doctor page.
2. Use an agent's own token for read-only project requests. Never print tokens or use Valentin's token.
3. List projects with no parameters. Require success, project metadata, and pagination information.
4. Request `?limit=1`, then request its returned cursor. Check that pages do not repeat projects. Test `offset=1` and `fields=id,title` too.
5. Request `limit=0`, `limit=nope`, `limit=1.5`, `offset=nope`, `offset=-1`, and `sort_order=sideways`. Each returns HTTP 400, not 500.
6. Request `sort_order=DESC` and `limit=1000`. Both succeed; the page limit stays capped at 100.
7. Without authentication, require HTTP 401. Project visibility must remain scoped to the authenticated caller.

## What usually breaks

- Unchecked pagination reaches the database as zero, NaN, or oversized integers.
- Empty zero-sized pages dereference a missing last project while creating a cursor.
- Invalid sort values reach the database instead of returning a readable validation error.
- Validation accidentally changes ordinary listings, metadata, or cursor pagination.

## What proof to collect

- Sanitized HTTP statuses and response summaries for valid and invalid requests.
- Default listing, projected page, distinct cursor pages, and scoped caller identity.
- Signed-in doctor screenshot, deployment commit, and core inbox-cycle evidence.

### Automated evidence

`node --test tests/htpr-8026-project-list-input.test.cjs tests/mcp-project-list-metadata.test.cjs tests/mcp-list-query-contract.test.cjs` runs the real project-list handler with a storage-boundary fixture.

## Cleanup

Read-only requests. No project or task fixtures.
