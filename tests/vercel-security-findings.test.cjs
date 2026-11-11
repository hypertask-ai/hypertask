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
  assert.deepEqual(Object.keys(step.env), ['VERCEL_TOKEN']);
  assert.doesNotMatch(source, /upload-artifact|pull_request_target|MCP_TOKEN/);
  const manifest = readFileSync('.github/actions/action-archive-cache-manifest.txt', 'utf8');
  const actions = job.steps.map(step => step.uses).filter(Boolean);
  assert.equal(actions.length, 2);
  for (const action of actions) {
    const [name, sha] = action.split('@');
    assert.match(sha, /^[a-f0-9]{40}$/, `${name} must be pinned to an immutable commit`);
    assert.ok(manifest.includes(`${name} ${sha}`), `${name}@${sha} must be recorded in the action manifest`);
  }
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
  assert.match(formatFindings([]), /No production findings returned/);
  const output = formatFindings([finding(), finding({ status: 'open' })]);
  assert.match(output, /#12 01ARZ3NDEKTSV4RRFFQ69G5FAV closed medium resolved-in=a{40}/);
  assert.match(output, /open medium/);
  assert.doesNotMatch(output, /secret-title|secret-description|secret-code/);
  for (const override of [{ findingId: '<script>' }, { status: 'unknown' }, { severity: 'unknown' }, { environment: 'preview' }, { target: { id: 'other-project' } }, { resolvedIn: { commitSha: 'secret' } }]) {
    assert.throws(() => formatFindings([finding(override)]));
  }
  const report = formatFindings(Array.from({ length: 150 }, (_, i) => finding({ number: i + 1 })));
  assert.match(report, /^BEGIN COMPLETE PRODUCTION SECURITY FINDINGS\n/);
  assert.match(report, /All statuses, 150 findings/);
  assert.match(report, /\nEND COMPLETE PRODUCTION SECURITY FINDINGS$/);
  assert.equal(report.match(/resolved-in=/g).length, 150);
});

test('publishes one complete redacted report only after every read validates', async () => {
  const env = { VERCEL_TOKEN: 'vercel-secret' };
  const reports = [];
  let calls = 0;
  await main(env, async (url, options) => {
    assert.ok(url instanceof URL);
    assert.equal(url.origin, 'https://vercel.com');
    assert.equal(options.method, undefined);
    assert.equal(reports.length, 0);
    return calls++ === 0 ? page([finding()], 'next') : page([finding({ number: 8 })]);
  }, report => reports.push(report));
  assert.equal(reports.length, 1);
  assert.match(reports[0], /All statuses, 2 findings/);
  assert.match(reports[0], /#8 /);
  assert.doesNotMatch(reports[0], /secret-title|secret-description|secret-code|vercel-secret/);
  for (const [request, error] of [
    [async () => page([finding({ status: 'bad' })]), /unexpected finding metadata/],
    [async url => url.searchParams.has('cursor') ? page([finding({ status: 'bad' })]) : page([finding()], 'next'), /unexpected finding metadata/],
    [async url => url.searchParams.has('cursor') ? { ok: false, status: 500 } : page([finding()], 'next'), /HTTP 500/],
    [async () => page([], 'same'), /incomplete pagination/],
  ]) {
    await assert.rejects(main(env, request, () => assert.fail('Incomplete results must not be published')), error);
  }
  await assert.rejects(main({}, async () => assert.fail(), () => assert.fail()), /missing/);
});
