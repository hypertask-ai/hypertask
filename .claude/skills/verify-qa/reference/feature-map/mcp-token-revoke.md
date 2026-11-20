# MCP token revoke

## Sub-features

- `which-account-to-test-on` Which account to test on.

## How to get to it (user POV)

- Settings > Connect > MCP (`/settings/mcp`): the TOKEN card shows **Token active**, the expiry, and **Copy**, **Revoke**, **Renew**. The same section lists **Connect AI assistants** for each client.
- The MCP tool `hypertask_revoke_token` (one token, or `revoke_all`), and `/api/mcp/token` revoke.

### Which account to test on

- Never test revoke-all on QA account 2343: it runs the 5-minute MCP watcher (YPER4-352, https://app.hypertask.ai/detail/project-4060/352). Use 985 for that test.
- Revoke-all also kills the QA 985 agent token other runners share, so a single-token revoke is the safe production check. Prove revoke-all only on a dedicated QA account whose agent credentials nobody else uses.

## Driving it with agent-browser

- Revoking the page token sets the revocation on that token's `jti`; every MCP call with it then gets 401. "Revoke all" (the clients list's disconnect-all) sets the user's revoke time instead: every token that user issued before it stops working, agent tokens included.
- Before: a token issued by the test account answers `tools/list` on `https://app.hypertask.ai/mcp`.
- After revoke: the same token gets 401, and a newly issued token works.

```bash
ht-verify api POST /api/mcp/token --data '{}' --state <qa-state> --confirm      # 200, { token }
curl -s -o /dev/null -w '%{http_code}' -X POST https://app.hypertask.ai/mcp \
  -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'                       # 200
curl -s -X DELETE https://app.hypertask.ai/api/mcp/token -H "Authorization: Bearer <token>"  # 200 revoked
# repeat the tools/list call: 401 -32001
```

Minting a new token revokes the previous page token held in the browser cookie,
so re-read `/settings/mcp` after a mint or the page still shows the old state.
Never print the token value.

## Gotchas

- A revoked token still works, or a newly issued token is rejected after revoke-all.
- `GET /api/mcp/token` only decodes the cookie and checks expiry, so it says `Token active` for a token that was revoked server-side. A revoked page token still needs its `jti` in the revocation table for the 401.
- The **Revoke** button on `/settings/mcp` sent no request on 2026-11-20 (HTPR-9515 b2); check it before claiming the GUI path.

### What proof to collect

Record the before/after `tools/list` HTTP statuses and the newly issued token's successful response. Never record token values.

### Automated evidence

`node --test tests/app/api/mcp/token/route.test.ts` exercises the revoke-all and page-token routes with mocked storage: old tokens stay rejected after a new working token is minted.

### Cleanup

Revoke any tokens issued for the test on account 985.
