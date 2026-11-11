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
    if (!Array.isArray(page?.findings) || !Object.hasOwn(page, 'nextCursor') || !(page.nextCursor === null || typeof page.nextCursor === 'string')) {
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
        finding.target?.kind !== 'project' || finding.target.id !== PROJECT_ID || finding.environment !== 'production') {
      throw new Error('Vercel findings read: unexpected finding metadata');
    }
    const resolvedSha = finding.resolvedIn?.commitSha;
    if (resolvedSha != null && !/^[a-f0-9]{40}$/.test(resolvedSha)) throw new Error('Invalid resolved commit');
    return `#${finding.number} ${finding.findingId} ${finding.status} ${finding.severity}${resolvedSha ? ` resolved-in=${resolvedSha}` : ''}`;
  });
  const header = `<p><strong>Production security findings</strong></p><p>Read at ${new Date().toISOString()}. All statuses, ${rows.length} findings. Titles, descriptions, code and secret values are omitted. Identify warnings by their project number or finding ID.</p>`;
  const budget = 4800 - header.length;
  const chunks = [];
  let lines = [];
  let size = 0;
  for (const row of rows) {
    if (size + row.length + 1 > budget) {
      chunks.push(`${header}<pre>${lines.join('\n')}</pre>`);
      lines = [];
      size = 0;
    }
    lines.push(row);
    size += row.length + 1;
  }
  chunks.push(`${header}<pre>${lines.join('\n') || 'No production findings returned.'}</pre>`);
  return chunks;
}

async function main(env = process.env, request = fetch) {
  if (!/^[0-9]{1,7}$/.test(env.TICKET ?? '') || !/^[0-9]{1,7}$/.test(env.BOARD ?? '') || !env.MCP_TOKEN) {
    throw new Error('A numeric ticket, board and MCP_TOKEN are required');
  }
  const findings = await readFindings(env.VERCEL_TOKEN, request);
  const comments = formatFindings(findings);
  for (const text of comments) {
    const response = await request('https://app.hypertask.ai/api/mcp/comments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.MCP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ unique_index: Number(env.TICKET), project_id: Number(env.BOARD), content_type: 'html', text }),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (![200, 201, 202].includes(response.status)) throw new Error(`Findings delivery: HTTP ${response.status}`);
  }
  console.log(`Delivered ${findings.length} production finding states in ${comments.length} ticket activities.`);
}

module.exports = { readFindings, formatFindings, main };
if (require.main === module) main().catch(() => {
  console.error('Security findings read or delivery failed. No raw response was logged. Check credential validity and read permissions.');
  process.exitCode = 1;
});
