# Production schema audit — YPER4-322

Ticket: https://app.hypertask.ai/detail/project-4060/322

Audit: 2026-10-12; migration/datamodel reference commit `2e49dfbb8c0a7a092aec0c51829b1ec8741543d0` (includes PR #1425). Only PostgreSQL catalogs and `_prisma_migrations` were read. No application rows were read or modified. The repair below is **not applied to production by this session**.

## Production identity and reader

Vercel `hypertasks-prod` production `DATABASE_URL` points to Neon project `raspy-sunset-94817994` (`hypertask-production`), branch `br-curly-glade-ab476077` (`import`), database `neondb`, owner `neondb_owner`. Endpoint: `ep-gentle-grass-abgtcv1y.eu-west-2.aws.neon.tech` (application uses its pooler).

Independent build evidence: READY deployment `dpl_43u6CmyzHYXaYNs25SQneHA7meyt`, production commit `20f9111585347686edb415e35afba2f1abac50e5`, aliases include `app.hypertask.ai`. Its build log runs `npx prisma generate && next build --webpack && node scripts/run-production-migrations.mjs`, reports that same direct endpoint/database, `282 migrations found`, and `No pending migrations to apply`. The sensitive DIRECT_URL value is not returned by Vercel's environment API; the build log confirms its destination without disclosing credentials.

Neon's other branches are `dev-valentin` (`br-fragrant-sunset-abog6ih1`, child of import), `staging-mirror` (`br-wild-credit-ab1av3ly`, child of import), and an unrelated root named `production` (`br-square-meadow-abalo5fh`, endpoint `ep-withered-credit-abi74lu2.eu-west-2.aws.neon.tech`). Do not infer the production database from that branch's name.

Using the owner URI returned by Neon, **SQL**, not the role API, created `schema_reader`: LOGIN, strong random password, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOINHERIT, NOREPLICATION, NOBYPASSRLS; no memberships. Only CONNECT on `neondb`, USAGE on public, SELECT on public `_prisma_migrations`; `default_transaction_read_only=on`. Catalog proof returned all elevated attributes false and only that one table grant. Credentials were saved only to `~/.local/state/yper4-322/schema-reader.url` with mode 600.

Permission controls (no rows accessed):

- `SELECT "id" FROM public."Task" WHERE false`: psql exit 3, `permission denied for table Task`.
- `DELETE FROM public."_prisma_migrations" WHERE false`: psql exit 3, `cannot execute DELETE in a read-only transaction`.

## Diff method and exhaustive differences

Prisma 7.10 removed `--to-url`, `--shadow-database-url`, and `--from-schema-datamodel`. Their equivalents are config `datasource.url` / `shadowDatabaseUrl`, `--to-config-datasource`, and `--from-schema`. Both script and summary runs used `--exit-code`.

A direct reader diff was run for migrations and datamodel. It produced false removals of application columns/keys because Prisma's information_schema queries hide columns without table privileges. This is **permission-visibility noise, not missing schema**. The reader cannot be granted SELECT on boards. `pg_dump --schema-only` also fails because its table LOCKs require SELECT.

The detector instead reads pg_catalog in a repeatable-read READ ONLY transaction, reconstructs the empty public schema in a uniquely named disposable local database, and compares that with migrations replayed in a separate local shadow database. It copies enum definitions, sequence definitions (not values), column types/nullability/defaults, constraints and indexes; never application data. PostgreSQL 18 represents NOT NULL twice (`attnotnull` plus `pg_constraint` type `n`); only `attnotnull` is reconstructed. This preserves nullability without duplicate/version-specific constraint syntax. Unhandled relation kinds or generated/identity columns fail closed.

The **unfiltered** migration and datamodel comparisons agreed, both exit 2, with exactly these differences (expected -> actual):

| Object | Actual production difference | Classification / decision |
| --- | --- | --- |
| `AiUsage.cacheWriteInputTokens` | integer NOT NULL DEFAULT 0 instead of nullable integer without default | **Real drift.** Current recorder explicitly supplies null when the provider has no cache-write count; requiredness can reject usage rows. Repair to nullable/no default. |
| `AiUsage.cacheReadInputTokens` | extra integer NOT NULL DEFAULT 0 | **Harmless legacy additive column.** Neither current model, migration history nor application code references it; current cache-read tracking uses `cachedInputTokens`. Preserve values and exclude only this named unmanaged column from normal monitoring. |
| `UserSetting.savedCrossBoardViews` | extra jsonb NOT NULL DEFAULT '[]' | **Harmless legacy additive column.** No current model/migration/code references; retain stored values, exclude only this named unmanaged column. |
| `AI_Knowledge_Source` | extra table, primary key, two indexes and project FK | **Harmless legacy additive table.** No current model/migration/code references. Preserve it and any data; exclude only this named table from normal monitoring. |

All columns of the extra `AI_Knowledge_Source` table:

- `id`: serial, required, primary key.
- `projectId`: integer, required; ordinary index and FK to `Project.id` (CASCADE delete/update).
- `provider`: text, required, default 'github'.
- `repo`: text, required; unique index with `projectId, ref`.
- `ref`: text, required, default 'main'; same composite unique index.
- `includeGlob`: text, nullable.
- `fileShas`: jsonb, required, default '{}'.
- `status`: text, required, default 'idle'.
- `lastError`: text, nullable.
- `lastSyncedAt`: timestamp(3), nullable.
- `fileCount`, `chunkCount`: integer, required, default 0.
- `createdAt`: timestamp(3), required, default CURRENT_TIMESTAMP.
- `updatedAt`: timestamp(3), required, no default.

The indexes are `AI_Knowledge_Source_projectId_idx` and `AI_Knowledge_Source_projectId_repo_ref_key`; the FK is `AI_Knowledge_Source_projectId_fkey`; primary key `AI_Knowledge_Source_pkey`. No other differences, ordering differences or Neon-specific objects appeared. Only extension `plpgsql` 1.0 is installed. `AiUsage.userId` is already nullable, and all six original generation-metadata columns exist.

Normal monitoring logs each retained legacy object. `SCHEMA_DRIFT_INCLUDE_LEGACY=1` includes them for a full forensic comparison; `SCHEMA_DRIFT_SOURCE=datamodel` compares schema.prisma instead of migrations; `SCHEMA_DRIFT_FORMAT=script` prints expected -> actual DDL, **not repair SQL**. Never execute that output on production.

## Migration records and root cause

All times UTC. `logs=NULL` on successful rows. SHA-256 hashes match both the currently checked-in files and the committed revision that was successfully applied.

| Migration | started_at | finished_at | rolled_back_at | steps | checksum |
| --- | --- | --- | --- | --- | --- |
| `20261004065050_add_ai_generation_metadata` | 2026-10-04 00:28:47.665026 | 2026-10-04 00:28:48.220699 | NULL | 1 | `4c2f6b88ac092f1647564aca83ff6acea89425a6e9bcb700f9de5f2da7e09c7d` |
| `20261012030000_htpr_7140_ai_usage_user_nullable` | 2026-10-12 02:57:06.116329 | 2026-10-12 02:57:06.566036 | NULL | 1 | `761f8f959f8e9d5ab9bd4d8f46772168c64d38eb0c4c12d07b6ac5b16137ca92` |
| `20261011010000_htpr_7076_ai_usage_cache_tokens`, failed attempt | 2026-10-10 23:53:30.409 | NULL | 2026-10-11 00:45:38.739 | 0 | `34544b8a3ad0c9ab32800f32fd71631b212e5566932d7864eca040b03778661b` |
| same migration, retry | 2026-10-11 00:45:42.739 | 2026-10-11 00:45:43.183 | NULL | 1 | `31a43aa0dd6a7fa5d4ee000d26789d1fff01d36fe89698261b37dc8cf00e9418` |

The failed cache migration's logs explicitly say PostgreSQL `42701`: `column "cacheWriteInputTokens" of relation "AiUsage" already exists`. The original SQL at `4e0ff2ea6` matches its failed checksum. Commit `b5df0dffd` (PR #1308) changed it to lock-safe `ADD COLUMN IF NOT EXISTS` and temporarily resolved failed attempts as rolled back before deploy. The retry checksum matches today's file. That repair added `cachedInputTokens` but skipped the pre-existing incompatible cache-write column; it did not reconcile its NOT NULL or default. This is the **proven root cause of the remaining real drift**. Commit `751a2a9ca` (PR #1332) removed the one-off migration rescue; production now runs only `migrate deploy`.

For the earlier userId incident, `7d66d1f5b` (PR #1025) introduced the exact current SQL (`DROP NOT NULL` followed by six metadata additions); git history contains no later edit to that migration, and the applied checksum matches. The incident described in PR #1425 is therefore **not explained by editing that file after apply**. The ledger on the actual production endpoint contains both successful migrations, and the current catalog confirms #1425 repaired userId. A successful migrate-deploy row is history, not a continuing schema assertion: it will not reapply a migration if later DDL undoes an effect. The legacy additions and already-existing cache column demonstrate schema changes outside the committed migration history, but the retained catalog/ledger evidence cannot identify which actor/DDL originally restored userId NOT NULL, or distinguish later DDL from an earlier manual history reconciliation. No attribution or exact historical cause is claimed. There is no evidence that current production deploys target the misleading Neon branch named `production`; direct build logs confirm `import`.

## Repair and monitoring

New migration `20261012130000_yper4_322_schema_drift_repair` conditionally drops NOT NULL and DEFAULT from `AiUsage.cacheWriteInputTokens`, without changing existing values. It uses `information_schema` existence/shape checks, `ALTER TABLE IF EXISTS`, a 2s lock_timeout, and at most 20 lock attempts with 1s delays, matching the existing repair style. It is a no-op on already-correct/fresh schemas; no destructive cleanup of legacy objects. The migration is staged for the owning session's PR/deploy, not executed here against production.

`schema-drift.yml` runs nightly (02:23 UTC), after successful GitHub Production deployment events, and on production-only workflow_dispatch. It always checks out trusted `production`, with contents:read, no persisted git credentials, GitHub-hosted ubuntu-latest and disposable PostgreSQL. It is **not a required check**, does not write statuses/tickets, repair production or roll back. Failures are visible in Actions with named table/column differences.

Runner handoff: set repository secret `SCHEMA_READER_DATABASE_URL` from the private reader file; this helper does not set it. The shadow URL is job-local. Run `node scripts/schema-drift-check.mjs` with both `SCHEMA_READER_DATABASE_URL` and `SCHEMA_SHADOW_DATABASE_URL` supplied in the environment (never command arguments). Exit 0 = clean, 2 = drift, 1 = error. URLs/passwords are redacted from child output/errors; temp config contains only environment-variable references. Snapshot database and temp config are removed after each check.

Scope: Prisma-supported application schema in public, not data, grants, triggers/functions or CHECK/exclusion semantics that Prisma migrate diff does not compare. The three explicitly retained unmanaged legacy objects are not app schema assertions. This monitor detects the reported nullability class of drift, not an arbitrary database security audit.

## Verification

Disposable PostgreSQL 16 received all 283 committed migrations via `prisma migrate deploy` (exit 0). The final production monitor run exited 2 and named only `AiUsage.cacheWriteInputTokens`, while explicitly logging the three retained legacy objects. A SQL-created local reader with the same minimal grants successfully audited it while Task SELECT and migration-table DELETE were denied.

- `ALTER TABLE "AiUsage" ALTER COLUMN "userId" SET NOT NULL` -> detector exit **2**: `Schema drift: AiUsage.userId — [*] Altered column userId (changed from Nullable to Required)`.
- Restore `DROP NOT NULL` -> exit **0**, `Schema drift check: clean.`
- Recreate cacheWriteInputTokens NOT NULL/default 0, apply new repair twice -> exit **0**, clean. Thus both repair correctness and idempotence are exercised.
- `tests/schema-drift-check.test.cjs`: six tests pass including the opt-in real PostgreSQL control (no skips when the disposable env is supplied). Cheap default tests also cover exit/error distinction, cleanup, redaction, source arguments, FK/index reconstruction, legacy exclusions, and trusted workflow wiring.
- Existing production migration, app-smoke workflow, prod-health workflow and prompt-cache tests: **67 passed**. Initial prompt-cache run lacked a generated Prisma client; generating the isolated worktree client fixed the environment, and rerun passed.
- Existing PostgreSQL migration-history regression: **1 passed**, confirms migrations match schema.prisma.
- ESLint on changed script/test and `git diff --check`: passed. `actionlint` is not installed; workflow YAML/wiring is tested directly.
- The canonical deployment wiki was requested first but redirects to Cloudflare Access login. No Cloudflare configuration/access was changed; the checked-in `docs/ci.md` and `docs/ci-policy.yml` supplied the CI contract.
