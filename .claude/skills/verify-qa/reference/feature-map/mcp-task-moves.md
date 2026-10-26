# MCP task moves

## How a customer reaches it

Agents use `hypertask task move` or `POST /api/mcp/tasks/update` with `sectionId`.
The section adapter calls the ordinary task move route.

## How to drive it

1. Confirm the production deployment and QA 985 doctor screenshot.
2. Create one disposable child ticket through `vcc`, tagged MCP and qa-fixture.
3. On board 15, give it a flag link whose current mode is not Everyone.
4. Move that fixture to `Flag: Everyone`. Require a refusal, not a server failure.
5. Read the fixture back. Its original column must remain unchanged.
6. Move it between two ordinary columns. Read back both successful moves.
7. Check real server failures, partial updates and flag rollback locally with `node --test tests/htpr-7990-task-move-refusal.test.cjs`; never induce production server failures.

## What usually breaks

The internal move route's 409 response becomes a plain Error. Persistence then
returns 500 and opens a false crash alert. Successful moves must remain intact.

## What proof to collect

CLI replies and exit codes, before/after columns, flag mode, regression output,
deployment SHA, QA 985 doctor screenshot and the core inbox cycle.

## Cleanup

Mark only the fixture created by this run Deleted through `vcc`.
