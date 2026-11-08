'use strict';

// Turns Codex's built-in GitHub code review (the chatgpt-codex-connector bot)
// into the required `ai-review` commit status. Codex posts a standard pull
// request review on a push, one inline comment per finding, each with a P0 or
// P1 badge. This reads that review for the PR's current head and sets the
// status. It never checks out or runs PR code.

const CODEX_LOGIN = 'chatgpt-codex-connector';
const CONTEXTS = ['ai-review', 'claude-review'];
const STATUS_DESCRIPTION_LIMIT = 140;
const NO_ISSUES_COMMENT = /didn['’]t find any major issues|no major issues/i;
// Codex renders ![P1 Badge](https://img.shields.io/badge/P1-orange) and a
// bracketed [P1] title. The bare form is the fallback for any other rendering.
const BADGES = [/\bP([0-9]) Badge/g, /badge\/P([0-9])-/g, /\[P([0-9])\]/g, /\bP([0-9])\b/g];

const isCodex = login => String(login ?? '').replace(/\[bot\]$/, '') === CODEX_LOGIN;

function priorityOf(body) {
  for (const pattern of BADGES) {
    const levels = [...String(body ?? '').matchAll(pattern)].map(match => Number(match[1]));
    if (levels.length) return Math.min(...levels);
  }
  return null;
}

// A finding passes only with a badge below P1. No badge at all fails closed.
const blocks = body => (priorityOf(body) ?? 0) <= 1;

// pr: { headOid, committedDate, reviews: [{ author, commit, url, body, comments: [body] }],
//       comments: [{ author, url, body, createdAt }], thumbsUp: () => Promise<Date[]> }
// Returns { state, description, evidence }; evidence is an https URL or ''.
async function evaluate(pr) {
  const short = pr.headOid.slice(0, 7);
  const reviews = pr.reviews.filter(review => isCodex(review.author) && review.commit === pr.headOid);

  const blocking = reviews.flatMap(review => review.comments.length
    ? review.comments.filter(blocks)
    : priorityOf(review.body) !== null && blocks(review.body) ? [review.body] : []);
  if (blocking.length) {
    const levels = blocking.map(priorityOf);
    const worst = levels.includes(0) ? 'P0' : levels.includes(1) ? 'P1' : 'unrated';
    return {
      state: 'failure',
      description: `Codex review of ${short} raised ${blocking.length} finding(s), worst ${worst}`,
      evidence: reviews.find(review => review.url)?.url ?? '',
    };
  }
  if (reviews.length) {
    return {
      state: 'success',
      description: `Codex reviewed ${short} and raised no P0 or P1 findings`,
      evidence: reviews.findLast(review => review.url)?.url ?? '',
    };
  }

  const since = Date.parse(pr.committedDate);
  const clean = pr.comments.find(comment =>
    isCodex(comment.author) && Date.parse(comment.createdAt) >= since && NO_ISSUES_COMMENT.test(comment.body ?? ''));
  if (clean) return { state: 'success', description: `Codex found no major issues in ${short}`, evidence: clean.url ?? '' };

  if ((await pr.thumbsUp()).some(at => at.getTime() >= since)) {
    return { state: 'success', description: `Codex reacted with a thumbs up on ${short}`, evidence: '' };
  }
  return { state: 'pending', description: `Waiting for the Codex review of ${short}`, evidence: '' };
}

const SWEEP = `
query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 25, after: $after, baseRefName: "production") {
      pageInfo { hasNextPage endCursor }
      nodes {
        number isCrossRepository headRefOid
        commits(last: 1) { nodes { commit { oid committedDate status { contexts { context state description } } } } }
        reviews(last: 30) { nodes { author { login } url body commit { oid } comments(first: 50) { nodes { body } } } }
        comments(last: 30) { nodes { author { login } url body createdAt } }
      }
    }
  }
}`;

async function run({ github, context, core }) {
  const { owner, repo } = context.repo;
  const only = context.payload.pull_request?.number ?? context.payload.issue?.number ?? Number(context.payload.inputs?.pr || 0);
  const thumbsUp = number => async () => (await github.paginate(github.rest.reactions.listForIssue, {
    owner, repo, issue_number: number, content: '+1', per_page: 100,
  })).filter(reaction => isCodex(reaction.user?.login)).map(reaction => new Date(reaction.created_at));

  const nodes = [];
  for (let after = null, more = true; more;) {
    const { repository: { pullRequests } } = await github.graphql(SWEEP, { owner, name: repo, after });
    nodes.push(...pullRequests.nodes);
    ({ hasNextPage: more, endCursor: after } = pullRequests.pageInfo);
  }

  const summary = { success: 0, failure: 0, pending: 0, skipped: 0 };
  for (const node of nodes.filter(node => !only || node.number === only)) {
    const head = node.commits.nodes[0]?.commit;
    if (node.isCrossRepository || head?.oid !== node.headRefOid) { summary.skipped++; continue; }
    const result = await evaluate({
      headOid: node.headRefOid,
      committedDate: head.committedDate,
      reviews: node.reviews.nodes.map(review => ({
        author: review.author?.login, url: review.url, body: review.body, commit: review.commit?.oid,
        comments: review.comments.nodes.map(comment => comment.body ?? ''),
      })),
      comments: node.comments.nodes.map(comment => ({ ...comment, author: comment.author?.login })),
      thumbsUp: thumbsUp(node.number),
    });
    summary[result.state]++;

    const description = [result.description, result.evidence].filter(Boolean).join(' ').slice(0, STATUS_DESCRIPTION_LIMIT);
    const existing = new Map((head.status?.contexts ?? []).map(entry => [entry.context, entry]));
    for (const statusContext of CONTEXTS) {
      const previous = existing.get(statusContext);
      // Skip identical writes, and never replace a result already set on this
      // head (the old reviewer's, or the one-time bootstrap) with "pending".
      if (previous && (result.state === 'pending' || (previous.state.toLowerCase() === result.state && previous.description === description))) continue;
      await github.rest.repos.createCommitStatus({
        owner, repo, sha: node.headRefOid, state: result.state, context: statusContext, description,
        target_url: result.evidence || `${context.serverUrl}/${owner}/${repo}/pull/${node.number}`,
      });
    }

    // Auto-merge also wants an APPROVE comment naming the exact head commit,
    // as the old reviewer posted. This posts the same marker.
    const marker = `reviewed-commit: ${node.headRefOid}`;
    if (result.state === 'success' && !node.comments.nodes.some(comment => (comment.body ?? '').includes(marker) && /^APPROVE/.test(comment.body))) {
      await github.rest.issues.createComment({
        owner, repo, issue_number: node.number,
        body: `APPROVE\n\n${result.description}.${result.evidence ? ` Codex review: ${result.evidence}` : ''}\n\n${marker}\n<!-- codex-review-gate -->`,
      });
    }
    core.info(`PR #${node.number} ${node.headRefOid.slice(0, 7)}: ${result.state}. ${result.description}`);
  }
  core.info(`Codex review gate: ${JSON.stringify(summary)}`);
  return summary;
}

module.exports = { evaluate, priorityOf, blocks, isCodex, run };
