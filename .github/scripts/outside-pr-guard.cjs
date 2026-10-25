module.exports = async ({ github, context, core }) => {
  const marker = '<!-- outside-pr-guard -->';

  async function run() {
    const { owner, repo } = context.repo;
    const base = `${owner}/${repo}`;
    const dispatch = context.eventName === 'workflow_dispatch';
    const inputs = context.payload.inputs || {};
    let pr;

    if (dispatch && inputs.simulate_author) {
      const author = inputs.simulate_author;
      const fork = inputs.simulate_fork === true || inputs.simulate_fork === 'true';
      pr = {
        number: 0,
        user: { login: author, type: 'User' },
        head: { repo: { full_name: fork ? `${author}/${repo}` : base } },
        base: { repo: { full_name: base } },
      };
    } else {
      const prNumber = context.payload.pull_request?.number || inputs.pr_number;
      if (!prNumber) {
        core.setFailed('Provide pr_number or simulate_author to inspect a PR.');
        return;
      }
      // Read fresh metadata, not the potentially stale webhook payload.
      ({ data: pr } = await github.rest.pulls.get({
        owner, repo, pull_number: Number(prNumber),
      }));
    }

    if (!dispatch) core.setOutput('sha', pr.head.sha);

    const login = pr.user.login;
    const head = pr.head.repo?.full_name || '(deleted fork)';
    let trusted = false;
    let reason;
    if (head === base) {
      trusted = true;
      reason = 'same-repo branch';
    } else if (pr.user.type === 'Bot' && login === 'dependabot[bot]') {
      trusted = true;
      reason = 'Dependabot bot';
    } else {
      try {
        const { data: { permission } } = await github.rest.repos.getCollaboratorPermissionLevel({
          owner, repo, username: login,
        });
        trusted = ['admin', 'maintain', 'write'].includes(permission);
        reason = `author has ${permission || 'none'} access`;
      } catch (err) {
        if (err.status !== 404) throw err;
        reason = 'author is not a collaborator';
      }
    }

    const decision = `PR #${pr.number} by ${login} from ${head}: ${trusted ? 'trusted' : 'outside'} (${reason})`;
    core.info(decision);
    await core.summary.addRaw(decision).write();
    if (trusted || context.eventName !== 'pull_request_target') return;

    const comments = await github.paginate(github.rest.issues.listComments, {
      owner, repo, issue_number: pr.number,
    });
    if (!comments.some((comment) => (comment.body || '').includes(marker))) {
      await github.rest.issues.createComment({
        owner, repo, issue_number: pr.number,
        body: `${marker}\n\nThanks for taking the time to contribute! This project does not accept pull requests from outside the team. Please [open an issue describing the bug or idea](https://github.com/${base}/issues/new) and the team will pick it up and do the code work. See [CONTRIBUTING.md](https://github.com/${base}/blob/HEAD/CONTRIBUTING.md) for more information.`,
      });
    }
    await github.rest.pulls.update({ owner, repo, pull_number: pr.number, state: 'closed' });
  }

  try {
    await run();
  } catch (err) {
    core.setFailed(`outside-pr-guard failed: ${err.message}`);
  }
};
