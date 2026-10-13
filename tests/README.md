# Local test fixtures

On the shared VPS, run only the tests for the files you changed
(`npm run test:file -- <files>`) and leave the full suite to CI. A local full
`npm test` and the premerge `next build` take one shared exclusive slot, so a
second one waits; every local heavy job runs at `nice -n 10` and the full suite
uses 2 test workers locally, 4 in CI (YPER4-339).

Docker-backed tests use the digest-pinned images in `.github/ci-images.json`:
`ghcr.io/hypertask-ai/ci-postgres:16-alpine` for PostgreSQL suites,
`ghcr.io/hypertask-ai/ci-postgres:16-bookworm` for agent-token backfill verifiers,
and `ghcr.io/hypertask-ai/ci-redis:7-alpine` for MCP transports.
CI authenticates with its read-only `GITHUB_TOKEN` before running these tests.

For local Docker pulls, use your own GitHub token with `read:packages` access
to the `hypertask-ai` CI packages. Never use another session's credentials:

```bash
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io --username "$GITHUB_USER" --password-stdin
npm run test:file -- tests/mcp-transports.test.ts
npm run test:file -- tests/task-write-lock-postgres.test.cjs
```

If GHCR login is unavailable locally, a previously cached pinned image still
works. The transport test prefers an installed `redis-server`, so installing
that binary avoids Docker entirely. PostgreSQL suites and the backfill
verifiers honor `HTPR_PG_IMAGE` for an explicit locally available PostgreSQL 16
image (use the matching Alpine or Bookworm variant). No automatic upstream
registry fallback is enabled in CI.

See [local premerge smoke](../e2e/smoke/README.md#local-docker-fixtures) for the
three-image setup used by `scripts/premerge-local.sh`.

The dependency-free `ci-image-sources.test.cjs` guard scans every file under
`tests/`, `e2e/`, `scripts/`, and `.github/`, plus root CI Compose files. Only
`.github/ci-images.json` upstream source fields are exempt because the mirror
must copy those sources; its consumers are not exempt. The existing root
`docker-compose.yml` is local-only PostgreSQL 14 and is not used by CI, so it
is left unchanged rather than silently upgrading a developer's data directory.
