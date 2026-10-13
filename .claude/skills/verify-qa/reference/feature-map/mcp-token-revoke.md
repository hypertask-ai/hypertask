# MCP token revoke

## How a customer reaches it

- Settings, Connections: revoke one connection, or "revoke all".
- The MCP tool `hypertask_revoke_token` (one token, or `revoke_all`), and `/api/mcp/token` revoke.
- "Revoke all" sets the user's revoke time: every MCP token that user issued before it stops working, agent tokens included.

## Which account to test on

- Never test revoke-all on QA account 2343: it runs the 5-minute MCP watcher (YPER4-352, https://app.hypertask.ai/detail/project-4060/352). Use 985 for that test.

## Proof

- Before: a token issued by the test account answers `tools/list` on `https://app.hypertask.ai/mcp`.
- After revoke: the same token gets 401, and a newly issued token works.
