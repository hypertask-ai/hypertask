const assert = require('node:assert/strict');
const test = require('node:test');
const { readFindings, formatFindings, main } = require('../.github/scripts/vercel-security-findings.cjs');
const { readFileSync } = require('node:fs');
const yaml = require('js-yaml');

test('secret-bearing reader runs only on the production branch and hosted runners', () => {
  const source = readFileSync('.github/workflows/vercel-security-findings.yml', 'utf8');
  const workflow = yaml.load(source);
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const job = workflow.jobs.findings;
  assert.equal(job.if, "github.ref == 'refs/heads/production'");
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.equal(job['timeout-minutes'], 5);
  assert.equal(job.steps[0].with['persist-credentials'], false);
  const step = job.steps.at(-1);
  assert.equal(step.run, 'node .github/scripts/vercel-security-findings.cjs');
  assert.equal(step.env.VERCEL_TOKEN, '${{ secrets.VERCEL_TOKEN }}');
  assert.doesNotMatch(source, /upload-artifact|pull_request_target/);
});

const finding = (overrides = {}) => ({
  findingId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', number: 12, status: 'closed', severity: 'medium',
  target: { kind: 'project', id: 'prj_oEok2iMNFPzj6AWe1KQBaIAcPaAf' }, environment: 'production',
  resolvedIn: { commitSha: 'a'.repeat(40) },
  title: 'secret-title', description: 'secret-description', fix: 'secret-code',
  ...overrides,
});
const page = (findings, nextCursor = null) => ({ ok: true, status: 200, json: async () => ({ findings, nextCursor }) });

test('reads every status and every page with production scope and GET only', async () => {
  let calls = 0;
  const result = await readFindings('fixture-token', async (url, options) => {
    assert.equal(url.origin, 'https://vercel.com');
    assert.equal(url.pathname, '/api/omniagent/v1/security-findings');
    assert.equal(url.searchParams.get('teamId'), 'team_yureFlJZ6ibwebaOOkKc5whs');
    assert.equal(url.searchParams.get('projectId'), 'prj_oEok2iMNFPzj6AWe1KQBaIAcPaAf');
    assert.equal(url.searchParams.get('environment'), 'production');
    assert.equal(url.searchParams.has('status'), false);
    assert.equal(options.method, undefined);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer fixture-token');
    if (calls++ === 0) return page([finding()], 'next-page');
    assert.equal(url.searchParams.get('cursor'), 'next-page');
    return page([finding({ status: 'open' }), finding({ status: 'dismissed' })]);
  });
  assert.deepEqual(result.map(row => row.status), ['closed', 'open', 'dismissed']);
  assert.equal(calls, 2);
});

test('refuses denied, challenged, malformed and incomplete responses', async () => {
  await assert.rejects(readFindings('', async () => assert.fail()), /missing/);
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(readFindings('token', async () => ({ ok: false, status })), new RegExp(`HTTP ${status}`));
  }
  await assert.rejects(readFindings('token', async () => ({ ok: true, json: async () => { throw Error('<html>'); } })), /invalid JSON/);
  await assert.rejects(readFindings('token', async () => ({ ok: true, json: async () => ({}) })), /schema/);
  await assert.rejects(readFindings('token', async () => page([], 'same')), /incomplete pagination/);
});

test('reports empty results distinctly and allows only state metadata', () => {
  assert.match(formatFindings([])[0], /No production findings returned/);
  const output = formatFindings([finding(), finding({ status: 'open' })]).join('');
  assert.match(output, /#12 01ARZ3NDEKTSV4RRFFQ69G5FAV closed medium resolved-in=a{40}/);
  assert.match(output, /open medium/);
  assert.doesNotMatch(output, /secret-title|secret-description|secret-code/);
  for (const override of [{ findingId: '<script>' }, { status: 'unknown' }, { severity: 'unknown' }, { environment: 'preview' }, { target: { id: 'other-project' } }, { resolvedIn: { commitSha: 'secret' } }]) {
    assert.throws(() => formatFindings([finding(override)]));
  }
  const chunks = formatFindings(Array.from({ length: 150 }, (_, i) => finding({ number: i + 1 })));
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.length <= 5000));
  assert.equal(chunks.join('').match(/resolved-in=/g).length, 150);
});

test('delivers only validated states to ticket activities and accepts queued writes', async () => {
  const env = { VERCEL_TOKEN: 'vercel-secret', MCP_TOKEN: 'mcp-secret', TICKET: '287', BOARD: '11514' };
  for (const status of [200, 201, 202]) {
    let posts = 0;
    await main(env, async (url, options) => {
      if (url instanceof URL) return page([finding()]);
      assert.equal(url, 'https://app.hypertask.ai/api/mcp/comments');
      assert.equal(options.method, 'POST');
      const body = JSON.parse(options.body);
      assert.equal(body.unique_index, 287);
      assert.equal(body.project_id, 11514);
      assert.equal(body.kind, undefined);
      assert.doesNotMatch(options.body, /secret-title|secret-description|secret-code|vercel-secret|mcp-secret/);
      posts++;
      return { status };
    });
    assert.equal(posts, 1);
  }
  await assert.rejects(main({ ...env, TICKET: '287; echo bad' }, async () => assert.fail()), /numeric/);
  await assert.rejects(main(env, async url => url instanceof URL ? page([finding({ status: 'bad' })]) : assert.fail()), /metadata/);
  await assert.rejects(main(env, async url => url instanceof URL ? page([]) : { status: 500 }), /delivery: HTTP 500/);
});
