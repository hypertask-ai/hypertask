const assert = require('node:assert/strict');
const test = require('node:test');
const { readFindings, readCoverage, formatCoverage, formatFindings, main } = require('../.github/scripts/vercel-security-findings.cjs');
const { readFileSync } = require('node:fs');
const yaml = require('js-yaml');

test('secret-bearing reader runs only on the production branch and hosted runners', () => {
  const source = readFileSync('.github/workflows/vercel-security-findings.yml', 'utf8');
  const workflow = yaml.load(source);
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.deepEqual(workflow.permissions, { contents: 'read', checks: 'read' });
  const job = workflow.jobs.findings;
  assert.equal(job.if, "github.ref == 'refs/heads/production'");
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.equal(job['timeout-minutes'], 5);
  assert.equal(job.steps[0].with['persist-credentials'], false);
  const step = job.steps.at(-1);
  assert.equal(step.run, 'node .github/scripts/vercel-security-findings.cjs');
  assert.equal(step.env.VERCEL_TOKEN, '${{ secrets.VERCEL_TOKEN }}');
  assert.equal(step.env.GITHUB_TOKEN, '${{ github.token }}');
  assert.deepEqual(Object.keys(step.env), ['VERCEL_TOKEN', 'GITHUB_TOKEN']);
  assert.equal(job.env, undefined);
  assert.equal(job.steps.some(other => other.uses?.startsWith('actions/upload-artifact')), false);
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
const commit = (digit, date) => ({ sha: String(digit).repeat(40), commit: { committer: { date } } });
const head = commit('b', '2026-11-11T19:40:22Z');
const reviewed = commit('c', '2026-11-08T18:48:05Z');
const unreviewed = commit('d', '2026-11-07T23:19:30Z');
const reviewRuns = runs => ({ ok: true, status: 200, json: async () => ({ check_runs: runs }) });
const review = startedAt => ({ name: 'Vercel Security Review', started_at: startedAt });
const repo = 'hypertask-ai/hypertask';
const commitsPage = commits => ({ ok: true, status: 200, json: async () => commits });

const coverageRequest = (commits, runsBySha) => async (url, options) => {
  assert.equal(options.headers.Authorization, 'Bearer github-secret');
  assert.equal(options.headers['X-GitHub-Api-Version'], '2022-11-28');
  if (url.endsWith(`/repos/${repo}/commits?sha=production&per_page=100&page=1`)) return commitsPage(commits);
  if (url.endsWith(`/repos/${repo}/commits?sha=production&per_page=100&page=2`)) return commitsPage([]);
  const match = url.match(/\/commits\/([a-f0-9]{40})\/check-runs\?check_name=Vercel%20Security%20Review&filter=latest&per_page=1$/);
  assert.ok(match, `unexpected URL ${url}`);
  return reviewRuns(runsBySha[match[1]] ?? []);
};

test('reads every status and every page with production scope and GET only', async () => {
  let calls = 0;
  const result = await readFindings('fixture-token', async (url, options) => {
    assert.equal(url.origin, 'https://vercel.com');
    assert.equal(url.pathname, '/api/omniagent/v1/security-findings');
    assert.equal(url.searchParams.get('teamId'), 'team_yureFlJZ6ibwebaOOkKc5whs');
    assert.equal(url.searchParams.get('projectId'), 'prj_oEok2iMNFPzj6AWe1KQBaIAcPaAf');
    assert.equal(url.searchParams.get('environment'), 'production');
    assert.equal(url.searchParams.get('status'), 'open,closed,dismissed');
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
  await assert.rejects(readFindings('token', async () => ({ ok: true, json: async () => ({ findings: [], nextCursor: 42 }) })), /schema/);
  await assert.rejects(readFindings('token', async () => page([], 'same')), /incomplete pagination/);
});

test('accepts a final page with no cursor and findings for the project or its repositories', async () => {
  let calls = 0;
  const result = await readFindings('fixture-token', async () => {
    calls += 1;
    return { ok: true, json: async () => ({ findings: [finding({ target: { kind: 'repository', id: 'repo_123' }, environment: undefined })] }) };
  });
  assert.equal(calls, 1);
  assert.equal(result.length, 1);
  assert.match(formatFindings(result, { reviewedSha: reviewed.sha, reviewedAt: '2026-11-10T00:00:00.000Z', head, checked: 2, horizon: reviewed.at }), /#12 01ARZ3NDEKTSV4RRFFQ69G5FAV closed medium resolved-in=a{40}/);
});

test('names the newest production commit a Vercel review covered and whether it covers HEAD', async () => {
  const covered = await readCoverage(repo, 'github-secret', coverageRequest([head, reviewed, unreviewed], { [head.sha]: [review('2026-11-10T00:31:00Z')] }));
  assert.equal(covered.reviewedSha, head.sha);
  assert.equal(covered.reviewedAt, '2026-11-10T00:31:00.000Z');
  assert.equal(covered.checked, 1);
  assert.match(formatCoverage(covered), /Scan coverage: Vercel last reviewed production b{40} at 2026-11-10T00:31:00.000Z, 1 commit\(s\) back\. Production HEAD is b{40} at 2026-11-11T19:40:22Z, so this review covers it\./);

  const behind = await readCoverage(repo, 'github-secret', coverageRequest([head, reviewed, unreviewed], { [reviewed.sha]: [review('2026-11-08T18:50:00Z')] }));
  assert.equal(behind.reviewedSha, reviewed.sha);
  assert.equal(behind.checked, 2);
  assert.match(formatCoverage(behind), /HEAD is b{40} at 2026-11-11T19:40:22Z, so this review does not cover it\./);
});

test('states plainly when no production commit in the window carries a review', async () => {
  const coverage = await readCoverage(repo, 'github-secret', coverageRequest([head, reviewed, unreviewed], {}));
  assert.equal(coverage.reviewedSha, null);
  assert.equal(coverage.checked, 3);
  assert.equal(coverage.horizon, '2026-11-07T23:19:30Z');
  assert.match(formatCoverage(coverage), /Scan coverage: no Vercel Security Review on any of the 3 production commits checked, back to 2026-11-07T23:19:30Z \(HEAD b{40} at 2026-11-11T19:40:22Z\)\. Security Reviews are off or not running, so no scan covers production until they report again\./);
});

test('refuses a coverage read that cannot be trusted', async () => {
  await assert.rejects(readCoverage(repo, '', async () => assert.fail()), /GITHUB_TOKEN is missing/);
  await assert.rejects(readCoverage('', 'github-secret', async () => assert.fail()), /GITHUB_REPOSITORY is missing/);
  await assert.rejects(readCoverage('not a repo', 'github-secret', async () => assert.fail()), /GITHUB_REPOSITORY is missing/);
  await assert.rejects(readCoverage(repo, 'github-secret', async () => ({ ok: false, status: 403 })), /commits read: HTTP 403/);
  await assert.rejects(readCoverage(repo, 'github-secret', async () => ({ ok: true, json: async () => { throw Error('<html>'); } })), /commits read: invalid JSON/);
  await assert.rejects(readCoverage(repo, 'github-secret', async () => commitsPage([])), /commits read: unexpected schema/);
  await assert.rejects(readCoverage(repo, 'github-secret', async () => commitsPage([{ sha: 'short' }])), /commits read: unexpected schema/);
  await assert.rejects(readCoverage(repo, 'github-secret', async () => commitsPage([{ sha: 'a'.repeat(40), commit: { committer: { date: 'not-a-date' } } }])), /commits read: unexpected schema/);
  await assert.rejects(readCoverage(repo, 'github-secret', async url => url.includes('/check-runs') ? { ok: false, status: 500 } : commitsPage([head])), /check read: HTTP 500/);
  await assert.rejects(readCoverage(repo, 'github-secret', async url => url.includes('/check-runs') ? { ok: true, json: async () => ({}) } : commitsPage([head])), /check read: unexpected schema/);
  await assert.rejects(readCoverage(repo, 'github-secret', async url => url.includes('/check-runs') ? { ok: true, json: async () => { throw Error('<html>'); } } : commitsPage([head])), /check read: invalid JSON/);
});

test('reports empty results distinctly, requires coverage, and allows only state metadata', () => {
  const empty = { reviewedSha: null, head, checked: 1, horizon: head.commit.committer.date };
  assert.match(formatFindings([], empty), /No production findings returned/);
  const output = formatFindings([finding(), finding({ status: 'open' })], { reviewedSha: head.sha, reviewedAt: '2026-11-10T00:31:00.000Z', head, checked: 1, horizon: head.at });
  assert.match(output, /Scan coverage: Vercel last reviewed production/);
  assert.match(output, /#12 01ARZ3NDEKTSV4RRFFQ69G5FAV closed medium resolved-in=a{40}/);
  assert.match(output, /open medium/);
  assert.doesNotMatch(output, /secret-title|secret-description|secret-code/);
  assert.throws(() => formatFindings([finding()]), /Scan coverage is missing/);
  for (const override of [{ findingId: '<script>' }, { status: 'unknown' }, { severity: 'unknown' }, { environment: 'preview' }, { target: { kind: '', id: 'x' } }, { target: { id: 'other-project' } }, { resolvedIn: { commitSha: 'secret' } }]) {
    assert.throws(() => formatFindings([finding(override)], empty));
  }
  const report = formatFindings(Array.from({ length: 150 }, (_, i) => finding({ number: i + 1 })), empty);
  assert.match(report, /^BEGIN COMPLETE PRODUCTION SECURITY FINDINGS\n/);
  assert.match(report, /All statuses, 150 findings/);
  assert.match(report, /\nEND COMPLETE PRODUCTION SECURITY FINDINGS$/);
  assert.equal(report.match(/resolved-in=/g).length, 150);
});

test('publishes one complete redacted report with coverage after every read validates', async () => {
  const env = { VERCEL_TOKEN: 'vercel-secret', GITHUB_TOKEN: 'github-secret', GITHUB_REPOSITORY: repo };
  const reports = [];
  let calls = 0;
  await main(env, async (url, options) => {
    const href = url instanceof URL ? url.href : String(url);
    assert.equal(reports.length, 0);
    if (href.startsWith('https://api.github.com/')) {
      if (href.includes('/check-runs')) return reviewRuns([review('2026-11-10T00:31:00Z')]);
      return commitsPage([head]);
    }
    assert.equal(url.origin, 'https://vercel.com');
    assert.equal(options.method, undefined);
    return calls++ === 0 ? page([finding()], 'next') : page([finding({ number: 8 })]);
  }, report => reports.push(report));
  assert.equal(reports.length, 1);
  assert.match(reports[0], /All statuses, 2 findings/);
  assert.match(reports[0], /Scan coverage: Vercel last reviewed production b{40} at 2026-11-10T00:31:00.000Z/);
  assert.match(reports[0], /#8 /);
  assert.doesNotMatch(reports[0], /secret-title|secret-description|secret-code|vercel-secret|github-secret/);
  const coverageOk = href => href.includes('/check-runs') ? reviewRuns([review('2026-11-10T00:31:00Z')]) : commitsPage([head]);
  const route = vercel => async (url) => {
    const href = url instanceof URL ? url.href : String(url);
    return href.startsWith('https://api.github.com/') ? coverageOk(href) : vercel(url);
  };
  for (const [vercel, error] of [
    [() => page([finding({ status: 'bad' })]), /unexpected finding metadata/],
    [url => url.searchParams.has('cursor') ? page([finding({ status: 'bad' })]) : page([finding()], 'next'), /unexpected finding metadata/],
    [url => url.searchParams.has('cursor') ? { ok: false, status: 500 } : page([finding()], 'next'), /HTTP 500/],
    [() => page([], 'same'), /incomplete pagination/],
  ]) {
    await assert.rejects(main(env, route(vercel), () => assert.fail('Incomplete results must not be published')), error);
  }
  await assert.rejects(main(env, async url => String(url).includes('api.github.com') ? commitsPage([]) : page([finding()]), () => assert.fail('Incomplete results must not be published')), /commits read: unexpected schema/);
  await assert.rejects(main({}, async () => assert.fail(), () => assert.fail()), /missing/);
});
