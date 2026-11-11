const TEAM_ID = 'team_yureFlJZ6ibwebaOOkKc5whs';
const PROJECT_ID = 'prj_oEok2iMNFPzj6AWe1KQBaIAcPaAf';
const ENDPOINT = 'https://vercel.com/api/omniagent/v1/security-findings';
const ALL_STATUSES = 'open,closed,dismissed';
const GITHUB_API = 'https://api.github.com';
const REVIEW_CHECK = 'Vercel Security Review';
const REVIEW_WINDOW_DAYS = 7;
const REVIEW_PAGES = 3;
const MAX_CHECKED = 200;
const READ_BUDGET_MS = 120_000;
const TIMEOUT_MS = 30_000;

async function readFindings(token, request = fetch) {
  if (!token) throw new Error('VERCEL_TOKEN is missing');
  const findings = [];
  const cursors = new Set();
  let cursor;
  do {
    const url = new URL(ENDPOINT);
    for (const [key, value] of Object.entries({ teamId: TEAM_ID, projectId: PROJECT_ID, environment: 'production', status: ALL_STATUSES, limit: '100', cursor })) {
      if (value) url.searchParams.set(key, value);
    }
    const response = await request(url, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Vercel findings read: HTTP ${response.status}`);
    let page;
    try { page = await response.json(); } catch { throw new Error('Vercel findings read: invalid JSON'); }
    if (!Array.isArray(page?.findings) || !(page.nextCursor == null || typeof page.nextCursor === 'string')) {
      throw new Error('Vercel findings read: unexpected schema');
    }
    findings.push(...page.findings);
    cursor = page.nextCursor;
    if (cursor) {
      if (cursors.has(cursor) || cursors.size >= 99) throw new Error('Vercel findings read: incomplete pagination');
      cursors.add(cursor);
    }
  } while (cursor);
  return findings;
}

function readCommit(commit) {
  const sha = commit?.sha;
  const at = commit?.commit?.committer?.date;
  if (typeof sha !== 'string' || !/^[a-f0-9]{40}$/.test(sha) || typeof at !== 'string' || Number.isNaN(Date.parse(at))) {
    throw new Error('GitHub commits read: unexpected schema');
  }
  return { sha, at };
}

async function readCoverage(repository, token, request = fetch) {
  if (!token) throw new Error('GITHUB_TOKEN is missing');
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('GITHUB_REPOSITORY is missing');
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const startedAt = Date.now();
  const oldestWanted = startedAt - REVIEW_WINDOW_DAYS * 86_400_000;
  const commits = [];
  for (let page = 1; page <= REVIEW_PAGES && commits.length < MAX_CHECKED; page += 1) {
    const response = await request(`${GITHUB_API}/repos/${repository}/commits?sha=production&per_page=100&page=${page}`, {
      headers, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`GitHub commits read: HTTP ${response.status}`);
    let batch;
    try { batch = await response.json(); } catch { throw new Error('GitHub commits read: invalid JSON'); }
    if (!Array.isArray(batch)) throw new Error('GitHub commits read: unexpected schema');
    if (batch.length === 0) break;
    commits.push(...batch.map(readCommit));
    if (Date.parse(commits.at(-1).at) < oldestWanted) break;
  }
  if (commits.length === 0) throw new Error('GitHub commits read: unexpected schema');
  const head = commits[0];
  let checked = 0;
  for (const candidate of commits.slice(0, MAX_CHECKED)) {
    if (Date.now() - startedAt > READ_BUDGET_MS) break;
    checked += 1;
    const checkResponse = await request(`${GITHUB_API}/repos/${repository}/commits/${candidate.sha}/check-runs?check_name=${encodeURIComponent(REVIEW_CHECK)}&filter=latest&per_page=1`, {
      headers, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!checkResponse.ok) throw new Error(`GitHub check read: HTTP ${checkResponse.status}`);
    let page;
    try { page = await checkResponse.json(); } catch { throw new Error('GitHub check read: invalid JSON'); }
    if (!Array.isArray(page?.check_runs)) throw new Error('GitHub check read: unexpected schema');
    const run = page.check_runs.find(candidate => candidate?.name === REVIEW_CHECK && typeof candidate.started_at === 'string' && !Number.isNaN(Date.parse(candidate.started_at)));
    if (run) {
      return { repository, head, reviewedSha: candidate.sha, reviewedAt: new Date(run.started_at).toISOString(), checked, horizon: candidate.at };
    }
  }
  const horizon = checked === 0 ? head.at : commits[checked - 1].at;
  return { repository, head, reviewedSha: null, checked, horizon };
}

function formatCoverage(coverage) {
  if (coverage.reviewedSha) {
    const coversHead = coverage.reviewedSha === coverage.head.sha;
    return `Scan coverage: Vercel last reviewed production ${coverage.reviewedSha} at ${coverage.reviewedAt}, ${coverage.checked} commit(s) back. Production HEAD is ${coverage.head.sha} at ${coverage.head.at}, ${coversHead ? 'so this review covers it' : 'so this review does not cover it'}.`;
  }
  return `Scan coverage: no ${REVIEW_CHECK} on any of the ${coverage.checked} production commits checked, back to ${coverage.horizon} (HEAD ${coverage.head.sha} at ${coverage.head.at}). Security Reviews are off or not running, so no scan covers production until they report again.`;
}

function formatFindings(findings, coverage) {
  if (!coverage) throw new Error('Scan coverage is missing');
  const rows = findings.map(finding => {
    if (!/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(finding.findingId ?? '') ||
        !Number.isSafeInteger(finding.number) || finding.number < 1 ||
        !['open', 'closed', 'dismissed'].includes(finding.status) ||
        !['critical', 'high', 'medium', 'low'].includes(finding.severity) ||
        typeof finding.target?.kind !== 'string' || finding.target.kind === '' ||
        typeof finding.target?.id !== 'string' || finding.target.id === '' ||
        (finding.environment != null && finding.environment !== 'production')) {
      throw new Error('Vercel findings read: unexpected finding metadata');
    }
    const resolvedSha = finding.resolvedIn?.commitSha;
    if (resolvedSha != null && !/^[a-f0-9]{40}$/.test(resolvedSha)) throw new Error('Invalid resolved commit');
    return `#${finding.number} ${finding.findingId} ${finding.status} ${finding.severity}${resolvedSha ? ` resolved-in=${resolvedSha}` : ''}`;
  });
  return [
    'BEGIN COMPLETE PRODUCTION SECURITY FINDINGS',
    `Read at ${new Date().toISOString()}. All statuses, ${rows.length} findings.`,
    'Titles, descriptions, code and secret values are omitted.',
    formatCoverage(coverage),
    ...rows,
    ...(rows.length ? [] : ['No production findings returned.']),
    'END COMPLETE PRODUCTION SECURITY FINDINGS',
  ].join('\n');
}

async function main(env = process.env, request = fetch, log = console.log) {
  const [findings, coverage] = await Promise.all([
    readFindings(env.VERCEL_TOKEN, request),
    readCoverage(env.GITHUB_REPOSITORY, env.GITHUB_TOKEN, request),
  ]);
  const report = formatFindings(findings, coverage);
  log(report);
}

module.exports = { readFindings, readCoverage, formatCoverage, formatFindings, main };
if (require.main === module) main().catch(() => {
  console.error('Security findings read failed. No raw response was logged. Check credential validity and read permissions.');
  process.exitCode = 1;
});
