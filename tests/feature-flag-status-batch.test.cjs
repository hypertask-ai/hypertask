const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

const batch = import(path.join(__dirname, '../.github/scripts/feature-flag-status-batch.mjs'));
const sha = 'b'.repeat(40);

test('one GraphQL page becomes the REST status shape the skip check already reads', async () => {
  const { statusesFromGraphql } = await batch;
  const { map, pageInfo } = statusesFromGraphql({
    data: { repository: { pullRequests: {
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [{
        headRefOid: sha,
        commits: { nodes: [{ commit: { oid: sha, status: { contexts: [
          { context: 'feature-flag-gate', state: 'SUCCESS', description: 'ok', targetUrl: 'https://example.invalid/run#ffg=1', createdAt: '2026-10-27T15:00:00Z' },
          { context: 'ci-tests', state: 'FAILURE', description: null, targetUrl: null, createdAt: null },
        ] } } }] },
      }],
    } } },
  });
  assert.equal(pageInfo.hasNextPage, false);
  assert.deepEqual(map[sha], [
    { context: 'feature-flag-gate', state: 'success', description: 'ok', target_url: 'https://example.invalid/run#ffg=1', updated_at: '2026-10-27T15:00:00Z' },
    { context: 'ci-tests', state: 'failure', description: null, target_url: null, updated_at: null },
  ]);
});

test('a header-prefixed gh body still parses as JSON', async () => {
  const { parseGhBody } = await batch;
  assert.equal(JSON.parse(parseGhBody('HTTP/2.0 200 OK\r\n\r\n{"data":{}}')).data !== undefined, true);
});

test('a simulated installation rate limit exits 78 and warns instead of failing the reconcile', async () => {
  const { runStatusBatch } = await batch;
  const result = runStatusBatch({
    repository: 'fixture/repository',
    exec() {
      return {
        status: 1,
        stdout: 'HTTP/2.0 403 Forbidden\nX-Ratelimit-Remaining: 0\nX-Ratelimit-Reset: 1000\n\n{"message":"API rate limit exceeded for installation"}',
        stderr: 'gh: API rate limit exceeded for installation. (HTTP 403)',
      };
    },
  });
  assert.equal(result.exitCode, 78);
  assert.match(result.warning, /skipped: GitHub rate limited until/);
  assert.match(result.warning, /next push or pull request event reconciles again/);
});

test('a non-rate-limit batch error falls open for the per-commit read', async () => {
  const { runStatusBatch } = await batch;
  const result = runStatusBatch({
    repository: 'fixture/repository',
    exec() {
      return { status: 1, stdout: '', stderr: 'gh: HTTP 500' };
    },
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.error, /HTTP 500/);
});
