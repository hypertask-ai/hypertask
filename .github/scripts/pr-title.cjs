module.exports = async ({ github, context, core, fetchImpl = fetch, pr }) => {
  const PREFIXES = ['HTPR', 'HYFA', 'YPER4', 'HYCI'];
  const TAGS = [
    'BUGFIX', 'FEATURE', 'IMPROVE', 'CLI/MCP/AI', 'SPEED', 'FEEDBACK',
    'DASH', 'QA', 'BOARD', 'COST', 'PLAN', 'INFRA', 'REFACTOR',
  ];
  const shape = new RegExp(
    '^(?:' + PREFIXES.join('|') + ')-\\d+ \\[(' +
    TAGS.join('|') +
    ')\\] \\S'
  );

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
    const boardIdByPrefix = { HYCI: '11514', HTPR: '15', HYFA: '2060', YPER4: '15' };
    const ticketPrefix = ticket.split('-')[0];
    const projectQuery = boardIdByPrefix[ticketPrefix]
      ? `&project_id=${boardIdByPrefix[ticketPrefix]}`
      : '';
    const pullUrlPattern = new RegExp(
      String.raw`${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![0-9])`,
    );
    const ticketDocumentsPull = async () => {
      const queries = [
        `ticket_number=${encodeURIComponent(ticket)}${projectQuery}`,
        `ticket_number=${encodeURIComponent(ticket)}`,
      ];
      for (const query of queries) {
        const lookup = await fetchImpl(
          `https://app.hypertask.ai/api/mcp/tasks?${query}`,
          { redirect: 'error', signal: AbortSignal.timeout(30_000), headers: authHeaders },
        );
        if (!lookup.ok) continue;
        const body = await lookup.json();
        const row = body.tasks?.[0];
        if (!row || row.ticketNumber !== ticket) continue;
        if (row.pullRequests?.some((link) => link.url === url)) return true;
        const description = row.description ?? '';
        if (pullUrlPattern.test(description)) return true;
      }
      return false;
    };
    const response = await fetchImpl('https://app.hypertask.ai/api/mcp/tasks/update', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket_number: ticket, pull_request_url: url }),
    });
    if (!response.ok) {
      const canTrustTicketRecord = response.status === 409 || response.status >= 500;
      if (canTrustTicketRecord && await ticketDocumentsPull()) {
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
      `  expected: (${PREFIXES.join('|')})-<n> [TAG] <summary>`,
      ``,
      `Valid tags: ${TAGS.join(', ')}`,
      ``,
      `Example: HTPR-5626 [INFRA] Move every job off GitHub-hosted runners`,
      `         HYFA-43 [INFRA] Add Factory acceptance routes`,
      `         YPER4-17 [INFRA] Step 4: rules enforced in code`,
      `         HYCI-27 [INFRA] Fail the run when a known-bug todo starts passing`,
      ``,
      `Edit the title and this check re-runs on its own.`,
    ].join('\n')
  );
};
