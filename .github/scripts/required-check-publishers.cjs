const API = 'https://api.github.com';
const APP = 'https://app.hypertask.ai';
const TICKET = 'HTPR-9357';
const QUIET_HOURS = 3;
const QUIET_MS = QUIET_HOURS * 60 * 60 * 1000;
const SAMPLE = 20;
const PAGE = 100;
const PAGES = 5;

async function getJson(fetchImpl, token, path) {
  const response = await fetchImpl(`${API}${path}`, {
    redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!response.ok) throw new Error(`GitHub ${path.split('?')[0]} returned HTTP ${response.status}`);
  return response.json();
}

async function collect(fetchImpl, token, path, read) {
  const rows = [];
  const joiner = path.includes('?') ? '&' : '?';
  for (let page = 1; page <= PAGES; page += 1) {
    const list = read(await getJson(fetchImpl, token, `${path}${joiner}per_page=${PAGE}&page=${page}`));
    if (!Array.isArray(list)) throw new Error(`GitHub ${path.split('?')[0]} returned an unexpected list.`);
    rows.push(...list);
    if (list.length < PAGE) break;
  }
  return rows;
}

const html = (value) => String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));

function listed(names) {
  const shown = names.map(html);
  if (shown.length < 2) return shown[0] ?? '';
  if (shown.length === 2) return `${shown[0]} and ${shown[1]}`;
  return `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
}

const STATUS_BOT = { 15368: 'github-actions[bot]', 5264284: 'hypertask-runners[bot]' };

function requiredFrom(ruleset) {
  const seen = new Set();
  return (ruleset.rules ?? []).flatMap((rule) => (rule.type === 'required_status_checks' ? rule.parameters?.required_status_checks ?? [] : [])).flatMap((check) => {
    const context = check?.context;
    const integrationId = check?.integration_id;
    if (typeof context !== 'string' || !context) return [];
    if (!Number.isSafeInteger(integrationId) || integrationId <= 0) throw new Error('A required check has no integration; no publisher report.');
    const id = `${integrationId}\n${context}`;
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ context, integrationId }];
  });
}

function eligible(pull, now) {
  if (!pull || typeof pull !== 'object') throw new Error('GitHub returned an unexpected pull request.');
  if (pull.draft === true || pull.base?.ref !== 'production') return null;
  const updated = Date.parse(pull.updated_at);
  if (!Number.isFinite(updated)) throw new Error('A pull request has no updated time; no publisher report.');
  if (now - updated < QUIET_MS) return null;
  if (!Number.isSafeInteger(pull.number) || pull.number <= 0 || !/^[0-9a-f]{40}$/.test(pull.head?.sha ?? '')) {
    throw new Error('A pull request head could not be read; no publisher report.');
  }
  return { number: pull.number, sha: pull.head.sha, updated };
}

async function observe(fetchImpl, token, repository, sha, missing) {
  const [statuses, runs] = await Promise.all([
    collect(fetchImpl, token, `/repos/${repository}/commits/${sha}/statuses`, (body) => body),
    collect(fetchImpl, token, `/repos/${repository}/commits/${sha}/check-runs`, (body) => body.check_runs),
  ]);
  for (const check of [...missing]) {
    const bot = STATUS_BOT[check.integrationId];
    const statusHit = !!bot && statuses.some((status) => status?.context === check.context && status?.creator?.login === bot);
    const runHit = runs.some((run) => run?.name === check.context && run?.app?.id === check.integrationId);
    if (statusHit || runHit) missing.delete(check);
  }
}

async function main({
  fetchImpl = fetch,
  token = process.env.GITHUB_TOKEN,
  boardToken = process.env.HYPERTASK_MCP_TOKEN,
  repository = process.env.GITHUB_REPOSITORY,
  now = Date.now(),
  log = (message) => console.log(message),
} = {}) {
  if (!token) throw new Error('GITHUB_TOKEN is missing; required checks cannot be listed.');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) {
    throw new Error('GITHUB_REPOSITORY is missing; required checks cannot be listed.');
  }
  const rulesets = await collect(fetchImpl, token, `/repos/${repository}/rulesets`, (body) => body);
  const active = rulesets.filter((row) => row.name === 'production-required-checks' && row.enforcement === 'active');
  if (active.length !== 1 || !Number.isSafeInteger(active[0].id) || active[0].id <= 0) {
    throw new Error('Expected one active production-required-checks ruleset.');
  }
  const ruleset = await getJson(fetchImpl, token, `/repos/${repository}/rulesets/${active[0].id}`);
  const required = requiredFrom(ruleset);
  if (!required.length) {
    log('The production ruleset requires no checks; nothing to report.');
    return { posted: false, reason: 'none-required' };
  }
  const missing = new Set(required);
  const pulls = [];
  for (let page = 1; page <= PAGES && missing.size > 0 && pulls.length < SAMPLE; page += 1) {
    const list = await getJson(fetchImpl, token, `/repos/${repository}/pulls?state=open&base=production&sort=updated&direction=desc&per_page=${PAGE}&page=${page}`);
    if (!Array.isArray(list)) throw new Error('GitHub returned an unexpected pull request list.');
    for (const row of list) {
      if (pulls.length >= SAMPLE || missing.size === 0) break;
      const pull = eligible(row, now);
      if (!pull) continue;
      pulls.push(pull);
      await observe(fetchImpl, token, repository, pull.sha, missing);
    }
    if (list.length < PAGE) break;
  }
  const silent = [...new Set([...missing].map((check) => check.context))].sort();
  if (!pulls.length) {
    log(`No open production pull request is at least ${QUIET_HOURS} hours old; nothing to report.`);
    return { posted: false, reason: 'too-soon' };
  }
  if (!silent.length) {
    log('Every required check has a result on a recent pull request; nothing to report.');
    return { posted: false, reason: 'healthy' };
  }
  if (!boardToken) throw new Error('HYPERTASK_MCP_TOKEN is missing; the missing publisher cannot reach the ticket.');
  const shown = listed(silent);
  const text = `<p>The required ${silent.length === 1 ? 'check' : 'checks'} ${shown} ${silent.length === 1 ? 'has' : 'have'} no result from the ruleset app on open production pull requests that have been waiting at least ${QUIET_HOURS} hours.</p><p>Removing a required check stays Valentin's call. This report does not change the ruleset.</p>`;
  const key = `required-check-publishers-${TICKET}-${new Date(now).toISOString().slice(0, 10)}-${silent.map((name) => name.replace(/[^\w.-]+/g, '-')).join('+')}`.slice(0, 200);
  const response = await fetchImpl(`${APP}/api/mcp/comments`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${boardToken}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ ticket_number: TICKET, kind: 'qa', text }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success !== true || result.routedTo === 'log' || result.visibleToPeople === false) {
    const hidden = result.routedTo === 'log' || result.visibleToPeople === false ? ' (hidden from people)' : '';
    throw new Error(`Posting the missing publisher to ${TICKET} failed: HTTP ${response.status}${hidden}`);
  }
  log(`Commented on ${TICKET}: ${silent.join(', ')} ${silent.length === 1 ? 'has' : 'have'} no publisher.`);
  return { posted: true, silent };
}

module.exports = Object.assign(main, { QUIET_HOURS, TICKET, SAMPLE });

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
