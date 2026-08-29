# Agent token backfill verifiers (HTPR-4671)

The migration `20260824120000_hash_agent_mcp_tokens` reads each agent's stored
plaintext JWT, derives a sha256 digest and the token's `jti`, and then drops the
plaintext column. That drop is irreversible: a wrong `jti` extraction would
silently invalidate every live agent credential with nothing left to recompute
from. These scripts are the proof the SQL was right before the drop shipped.

Both need Docker (they start a throwaway `postgres:16`) and both carry a
positive control, so a broken oracle fails loudly instead of passing vacuously.

```bash
node tests/fixtures/agent-token-backfill/verify-backfill-sql.mjs
# HTPR4671_BACKFILL_SQL_OK
#   200 synthetic tokens across every base64url padding class (0, 2, 3);
#   the jti and sha256 the SQL derives match what Node computes, exactly.

node tests/fixtures/agent-token-backfill/verify-migration-e2e.mjs
# HTPR4671_MIGRATION_E2E_OK
#   applies the real migration.sql to 120 plaintext rows plus malformed edge
#   rows, then checks every row's stored digest and generation against its
#   original token and confirms the plaintext column is gone.
```

They live under `tests/fixtures/` rather than `scripts/` on purpose: they query
the old `mcpToken` column by name, and the plaintext guard in
`tests/agent-token-hash.test.cjs` walks `src/`, `scripts/` and `prisma/`.
