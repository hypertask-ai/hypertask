const reportSize = require('./pr-size.cjs');
const policy = require('./pr-size-policy.json');

const APP = 'https://app.hypertask.ai';
const WORKFLOW_FILE = 'pr-size-day-one.yml';
const GUARD_WORKFLOW = policy.dayOne.guardWorkflow;
const blockFrom = Date.parse(policy.blockFrom);

const repoUrl = context => `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}`;
const pullUrl = (context, number) => `${repoUrl(context)}/pull/${number}`;

async function openPulls({ github, context }) {
  const pulls = await github.paginate(github.rest.pulls.list, {
    ...context.repo, state: 'open', base: 'production', sort: 'created', direction: 'desc', per_page: 100,
  });
  return pulls.filter(pull => pull.base?.ref === 'production' && pull.state === 'open');
}

async function sweptAlready({ github, context, log }) {
  const runs = await github.rest.actions.listWorkflowRuns({
    ...context.repo, workflow_id: WORKFLOW_FILE, status: 'success', event: 'schedule', per_page: 20,
    created: `>=${new Date(blockFrom).toISOString()}`,
  });
  const done = (runs.data?.workflow_runs ?? []).find(run => String(run.id) !== String(context.runId));
  if (done) log(`Counts already posted by scheduled run ${done.id}; nothing to do.`);
  return Boolean(done);
}

// reportSize fails the guard step on purpose; the sweep measures without stopping.
const quietCore = core => ({
  info: message => core.info(message),
  warning: message => core.warning(message),
  setOutput: (name, value) => core.setOutput(name, value),
  setFailed: message => core.info(`Over the cap: ${message}`),
  summary: core.summary,
});

// The trusted guard publishes every pr-title verdict. The sweep only asks it to
// look at an unchanged change again: re-running the guard's own completed run
// whose payload already carries this head, so the guard re-reads the change,
// rechecks size-ok and the human reason, and keeps its own per-change ordering.
async function requestGuard({ github, context, pull, log }) {
  const { data } = await github.rest.actions.listWorkflowRuns({
    ...context.repo, workflow_id: GUARD_WORKFLOW, head_sha: pull.head.sha, status: 'completed', per_page: 30,
  });
  const run = (data?.workflow_runs ?? [])
    .filter(candidate => candidate.head_sha === pull.head.sha
      && (candidate.pull_requests ?? []).some(linked => linked.number === pull.number)
      && candidate.conclusion !== 'skipped')
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))[0];
  if (!run) throw new Error(`no completed ${GUARD_WORKFLOW} run at ${pull.head.sha}; the change cannot be re-decided`);
  await github.rest.actions.rerunWorkflowRun({ ...context.repo, run_id: run.id });
  log(`Change #${pull.number} goes back to the guards as run ${run.id}.`);
}

async function sweep({ github, context, core, now = Date.now(), log = message => core.info(message) }) {
  if (!policy.dayOne?.ticket) throw new Error('pr-size-policy.json is missing dayOne.ticket.');
  const enforcing = now >= blockFrom;
  const dispatch = context.eventName === 'workflow_dispatch';
  if (!enforcing && !dispatch) {
    log(`Blocking starts ${policy.blockFrom}; the scheduled day-one sweep waits.`);
    return { swept: false, waiting: true };
  }
  if (!dispatch && await sweptAlready({ github, context, log })) return { swept: false, alreadySwept: true };
  const quiet = quietCore(core);
  const counts = { agentChanges: 0, sent: [], allowed: [], withinCap: 0, unavailable: [] };
  let unrequested = 0;
  for (const pull of await openPulls({ github, context })) {
    if (!reportSize.isAgent(pull)) continue;
    counts.agentChanges += 1;
    let report;
    try {
      const { data: current } = await github.rest.pulls.get({ ...context.repo, pull_number: pull.number });
      report = await reportSize({ github, context, core: quiet, pr: current, reportDirectory: process.env.RUNNER_TEMP, now });
    } catch (error) {
      counts.unavailable.push(pull.number);
      log(`Change #${pull.number} could not be measured: ${error.message}`);
      continue;
    }
    const state = report.overCap && report.exception?.by ? 'allowed' : report.verdict;
    if (state === 'blocked') {
      try {
        await requestGuard({ github, context, pull, log });
        counts.sent.push(pull.number);
      } catch (error) {
        unrequested += 1;
        counts.unavailable.push(pull.number);
        log(`Change #${pull.number} is over the cap but was not sent to the guards: ${error.message}`);
      }
    } else if (state === 'would-block') counts.sent.push(pull.number);
    else if (state === 'allowed') counts.allowed.push(pull.number);
    else if (state === 'within-cap') counts.withinCap += 1;
    else counts.unavailable.push(pull.number);
  }
  log(`Day one: ${counts.sent.length} of ${counts.agentChanges} open agent changes go back to the guards.`);
  if (unrequested) throw new Error(`${unrequested} over-cap change(s) were not sent to the guards; the sweep is incomplete.`);
  await postCounts({ context, core, counts, enforcing });
  return { swept: true, enforcing, counts };
}

const named = (context, numbers) => numbers.length
  ? ` ${numbers.map(number => `<a href="${pullUrl(context, number)}">#${number}</a>`).join(', ')}.`
  : '';

function ticketText(context, counts, enforcing) {
  const heading = enforcing
    ? 'Day one: big agent changes go back to the size check.'
    : `Day one rehearsal: what the size check fails on ${new Date(blockFrom).toISOString().slice(0, 10)}.`;
  const overCap = enforcing
    ? `Over 400 hand-written lines, sent to fail: ${counts.sent.length}.${named(context, counts.sent)}`
    : `Over 400 hand-written lines, would fail: ${counts.sent.length}.${named(context, counts.sent)}`;
  const rows = [
    `Open agent changes: ${counts.agentChanges}.`,
    overCap,
    `Allowed by ${policy.exceptionLabel} and a human reason: ${counts.allowed.length}.${named(context, counts.allowed)}`,
    `Under the cap, still passing: ${counts.withinCap}.`,
    `Could not check or ask: ${counts.unavailable.length}.${named(context, counts.unavailable)}`,
  ];
  return [
    `<p><strong>${heading}</strong></p>`,
    '<ul>' + rows.map(row => `<li>${row}</li>`).join('') + '</ul>',
    `<p>Run: <a href="${repoUrl(context)}/actions/runs/${context.runId}">size sweep</a>.</p>`,
  ].join('\n');
}

async function postCounts({ context, core, counts, enforcing }) {
  const boardToken = process.env.HYPERTASK_MCP_TOKEN;
  if (!boardToken) throw new Error('HYPERTASK_MCP_TOKEN is missing; the day-one counts cannot reach the ticket.');
  const key = enforcing ? `pr-size-day-one-${policy.blockFrom}` : 'pr-size-day-one-rehearsal';
  const response = await fetch(`${APP}/api/mcp/comments`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${boardToken}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ ticket_number: policy.dayOne.ticket, kind: 'qa', text: ticketText(context, counts, enforcing) }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success !== true) {
    throw new Error(`Posting the counts to ${policy.dayOne.ticket} failed: HTTP ${response.status} ${result.error ?? result.message ?? ''}`.trim());
  }
  core.info(`Posted the counts to ${policy.dayOne.ticket}.`);
  return result;
}

module.exports = sweep;
module.exports.ticketText = ticketText;
