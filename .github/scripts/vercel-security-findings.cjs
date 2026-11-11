const TEAM_ID = 'team_yureFlJZ6ibwebaOOkKc5whs';
const PROJECT_ID = 'prj_oEok2iMNFPzj6AWe1KQBaIAcPaAf';
const ENDPOINT = 'https://vercel.com/api/omniagent/v1/security-findings';

async function readFindings(token, request = fetch) {
  if (!token) throw new Error('VERCEL_TOKEN is missing');
  const findings = [];
  const cursors = new Set();
  let cursor;
  do {
    const url = new URL(ENDPOINT);
    for (const [key, value] of Object.entries({ teamId: TEAM_ID, projectId: PROJECT_ID, environment: 'production', limit: '100', cursor })) {
      if (value) url.searchParams.set(key, value);
    }
    const response = await request(url, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
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

function formatFindings(findings) {
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
    ...rows,
    ...(rows.length ? [] : ['No production findings returned.']),
    'END COMPLETE PRODUCTION SECURITY FINDINGS',
  ].join('\n');
}

async function main(env = process.env, request = fetch, log = console.log) {
  const findings = await readFindings(env.VERCEL_TOKEN, request);
  const report = formatFindings(findings);
  log(report);
}

module.exports = { readFindings, formatFindings, main };
if (require.main === module) main().catch(() => {
  console.error('Security findings read failed. No raw response was logged. Check credential validity and read permissions.');
  process.exitCode = 1;
});
