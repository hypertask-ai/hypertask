const policy = require('./pr-size-policy.json');
const { countChangedFiles, isAgent } = require('./pr-size.cjs');

const API = 'https://api.github.com';
const APP = 'https://app.hypertask.ai';
const PER_PAGE = 100;
const MAX_PAGES = 40;

const startedAt = Date.parse(policy.observation.startedAt);
const endsAt = Date.parse(policy.observation.endsAt);

async function readPage({ fetchImpl, token, path }) {
  const response = await fetchImpl(`${API}${path}`, {
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GitHub ${path} returned HTTP ${response.status}`);
  return response.json();
}

async function windowPullRequests({ fetchImpl = fetch, token, repository }) {
  const pulls = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const list = await readPage({
      fetchImpl, token,
      path: `/repos/${repository}/pulls?state=all&base=production&sort=created&direction=desc&per_page=${PER_PAGE}&page=${page}`,
    });
    if (!Array.isArray(list)) throw new Error('GitHub returned an unexpected pull request list.');
    const created = list.map(pr => Date.parse(pr.created_at));
    pulls.push(...list.filter((_, index) => created[index] >= startedAt && created[index] <= endsAt));
    if (list.length < PER_PAGE || created.at(-1) < startedAt) break;
  }
  return pulls;
}

async function pullRequestFiles({ fetchImpl = fetch, token, repository, number }) {
  const files = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const list = await readPage({
      fetchImpl, token,
      path: `/repos/${repository}/pulls/${number}/files?per_page=${PER_PAGE}&page=${page}`,
    });
    if (!Array.isArray(list)) throw new Error(`GitHub returned an unexpected file list for PR #${number}.`);
    files.push(...list);
    if (list.length < PER_PAGE) break;
  }
  return files;
}

async function postedAlready({ fetchImpl = fetch, token, repository, workflowFile, runId, log = () => {} }) {
  if (!workflowFile) return false;
  const runs = await readPage({
    fetchImpl, token,
    path: `/repos/${repository}/actions/workflows/${workflowFile}/runs?status=success&per_page=20&created=${new Date(startedAt).toISOString()}`,
  });
  const posted = (runs.workflow_runs ?? []).find(run => String(run.id) !== String(runId));
  if (posted) log(`Counts already posted by run ${posted.id}; nothing to do.`);
  return Boolean(posted);
}

async function measure({ fetchImpl = fetch, token, repository, log = () => {} }) {
  const pulls = await windowPullRequests({ fetchImpl, token, repository });
  const counts = { agentPullRequests: 0, humanPullRequests: 0, overCap: 0, biggest: 0, unreadable: 0 };
  for (const pull of pulls) {
    if (!isAgent(pull)) {
      counts.humanPullRequests += 1;
      continue;
    }
    counts.agentPullRequests += 1;
    try {
      const files = await pullRequestFiles({ fetchImpl, token, repository, number: pull.number });
      if (files.length === 0) throw new Error('no changed files returned');
      const { counted } = countChangedFiles(files);
      counts.biggest = Math.max(counts.biggest, counted);
      if (counted > policy.cap) counts.overCap += 1;
    } catch (error) {
      counts.unreadable += 1;
      log(`PR #${pull.number} left out of the count: ${error.message}`);
    }
  }
  if (counts.unreadable > 0) throw new Error(`${counts.unreadable} pull request(s) could not be measured; no counts posted.`);
  return counts;
}

const share = counts => counts.agentPullRequests === 0
  ? '0%'
  : `${Math.round((counts.overCap / counts.agentPullRequests) * 100)}%`;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const readableDate = iso => {
  const date = new Date(iso);
  const time = `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${time} UTC`;
};

function ticketText(counts, runUrl, late = false) {
  const rows = [
    `<strong>Week one: how many changes would be blocked.</strong>`,
    `Agent changes measured: ${counts.agentPullRequests}.`,
    `Over ${policy.cap} hand-written lines: ${counts.overCap} (${share(counts)}).`,
    `Biggest single change: ${counts.biggest} lines.`,
    `Human and Dependabot changes measured: ${counts.humanPullRequests}, never blocked.`,
    late ? `Blocking started ${readableDate(policy.blockFrom)}.` : `Blocking starts ${readableDate(policy.blockFrom)}.`,
    `A human allows a big change with ${policy.exceptionLabel} and a reason.`,
  ];
  return [
    '<p>' + rows[0] + '</p>',
    '<ul>' + rows.slice(1).map(row => `<li>${row}</li>`).join('') + '</ul>',
    runUrl ? `<p>Run: <a href="${runUrl}">size report</a>.</p>` : '',
  ].filter(Boolean).join('\n');
}

async function postCounts({ fetchImpl = fetch, boardToken, text, key }) {
  const response = await fetchImpl(`${APP}/api/mcp/comments`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${boardToken}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: JSON.stringify({ ticket_number: policy.observation.ticket, kind: 'qa', text }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success !== true) {
    throw new Error(`Posting the counts to ${policy.observation.ticket} failed: HTTP ${response.status} ${result.error ?? result.message ?? ''}`.trim());
  }
  return result;
}

async function main({
  fetchImpl = fetch,
  token = process.env.GITHUB_TOKEN,
  boardToken = process.env.HYPERTASK_MCP_TOKEN,
  repository = process.env.GITHUB_REPOSITORY,
  workflowRef = process.env.GITHUB_WORKFLOW_REF ?? '',
  runId = process.env.GITHUB_RUN_ID ?? '',
  runUrl = '',
  now = Date.now(),
  log = message => console.log(message),
} = {}) {
  if (now < endsAt) {
    log(`Observation window closes ${policy.observation.endsAt}; no counts posted yet.`);
    return { posted: false, waiting: true };
  }
  if (!token) throw new Error('GITHUB_TOKEN is missing; the counts cannot be measured.');
  if (!boardToken) throw new Error('HYPERTASK_MCP_TOKEN is missing; the counts cannot reach the ticket.');
  if (!repository) throw new Error('GITHUB_REPOSITORY is missing; the counts cannot be measured.');
  const workflowFile = workflowRef.split('@')[0].split('/').pop();
  if (await postedAlready({ fetchImpl, token, repository, workflowFile, runId, log })) {
    return { posted: false, alreadyPosted: true };
  }
  const counts = await measure({ fetchImpl, token, repository, log });
  const late = now >= Date.parse(policy.blockFrom);
  const text = ticketText(counts, runUrl, late);
  const key = `pr-size-observation-${policy.observation.endsAt}`;
  const result = await postCounts({ fetchImpl, boardToken, text, key });
  log(`Posted ${counts.overCap}/${counts.agentPullRequests} over cap to ${policy.observation.ticket}: ${result.url ?? 'saved'}`);
  return { posted: true, counts, late };
}

module.exports = main;
module.exports.measure = measure;
module.exports.postedAlready = postedAlready;
module.exports.ticketText = ticketText;
module.exports.postCounts = postCounts;
module.exports.share = share;
module.exports.readableDate = readableDate;

if (require.main === module) {
  main({ runUrl: process.env.RUN_URL }).catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
