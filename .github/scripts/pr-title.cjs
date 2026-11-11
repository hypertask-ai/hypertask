const SERVER_ERRORS = new Set([500, 502, 503, 504]);
const { shape, expected, TAGS, examples } = require('./pr-title-shape.cjs');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithServerRetries(fetchImpl, url, options, log) {
  let serverRetries = 0;
  for (;;) {
    const response = await fetchImpl(url, options);
    if (response.ok || !SERVER_ERRORS.has(response.status) || serverRetries >= 2) return response;
    serverRetries += 1;
    log(`Ticket binding got HTTP ${response.status}; retry ${serverRetries}/2 after ${serverRetries}s`);
    await sleep(serverRetries * 1000);
  }
}

module.exports = async ({ github, context, core, fetchImpl = fetch, pr }) => {
  const prNumber = context.payload.pull_request?.number ?? context.payload.inputs?.pr_number;
  if (prNumber !== undefined && !/^[1-9]\d*$/.test(String(prNumber))) throw new Error("Invalid PR number");
  if (!prNumber) {
    core.info('No pull_request payload; skipping title check.');
    return;
  }

  if (!pr) ({ data: pr } = await github.rest.pulls.get({
    ...context.repo,
    pull_number: Number(prNumber),
  }));

  core.setOutput('sha', pr.head.sha);
  core.setOutput('title', pr.title);

  if (pr.user.login.endsWith('[bot]') && !shape.test(pr.title)) {
    core.info(`Skipping ${pr.user.login}: bots do not follow the agent title rule.`);
    return;
  }

  if (/^Revert "/.test(pr.title)) {
    core.info(`Skipping revert PR title: ${pr.title}`);
    return;
  }

  if (shape.test(pr.title)) {
    const repository = `${context.repo.owner}/${context.repo.repo}`;
    if (pr.base.ref !== 'production' ||
        pr.base.repo?.full_name !== repository || pr.head.repo?.full_name !== repository) {
      core.info('Skipping ticket binding outside a same-repository production PR.');
      return;
    }
    const token = process.env.HYPERTASK_MCP_TOKEN;
    if (!token) throw new Error('HYPERTASK_MCP_TOKEN is missing; ticket binding cannot run.');
    const ticket = pr.title.split(' ')[0];
    const url = `https://github.com/${repository}/pull/${pr.number}`;
    const authHeaders = { Authorization: `Bearer ${token}` };
    const ticketDocumentsPull = async () => {
      const lookup = await fetchWithServerRetries(
        fetchImpl,
        `https://app.hypertask.ai/api/mcp/tasks?ticket_number=${encodeURIComponent(ticket)}`,
        { redirect: 'error', signal: AbortSignal.timeout(30_000), headers: authHeaders },
        (message) => core.info(message),
      );
      if (!lookup.ok) return false;
      const body = await lookup.json();
      const row = body.tasks?.[0];
      if (!row || row.ticketNumber !== ticket) return false;
      if (row.pullRequests?.some((link) => link.url === url)) return true;
      const description = row.description ?? '';
      return description.includes(url);
    };
    const response = await fetchWithServerRetries(
      fetchImpl,
      'https://app.hypertask.ai/api/mcp/tasks/update',
      {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_number: ticket, pull_request_url: url }),
      },
      (message) => core.info(message),
    );
    if (!response.ok) {
      if ((response.status === 409 || SERVER_ERRORS.has(response.status)) && await ticketDocumentsPull()) {
        core.info(`Title OK: ${pr.title}; ${ticket} already documents ${url}`);
        return;
      }
      throw new Error(`Ticket binding returned HTTP ${response.status}`);
    }
    const result = await response.json();
    if (result.success !== true || result.tasks?.length !== 1 ||
        result.tasks[0].ticketNumber !== ticket ||
        !result.tasks[0].pullRequests?.some(link => link.url === url)) {
      throw new Error('Ticket binding was not confirmed by the app.');
    }
    core.info(`Title OK: ${pr.title}; linked ${ticket} to ${url}`);
    return;
  }

  core.setFailed(
    [
      `Pull request title does not match the required shape.`,
      ``,
      `  got:      ${pr.title}`,
      `  expected: ${expected}`,
      ``,
      `Valid tags: ${TAGS.join(', ')}`,
      ``,
      ...examples.map((example, index) => `${index === 0 ? 'Example: ' : '         '}${example}`),
      ``,
      `Edit the title and this check re-runs on its own.`,
    ].join('\n')
  );
};
