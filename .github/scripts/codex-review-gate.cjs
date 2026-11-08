'use strict';

// Turns Codex's built-in GitHub code review into the required `ai-review`
// commit status. Codex (the chatgpt-codex-connector bot) posts a standard
// pull request review on a push, with one inline comment per finding and a
// P0/P1 badge on each. This file reads that review for a pull request's
// current head and sets the status. It never checks out or runs PR code.

const CODEX_LOGIN = 'chatgpt-codex-connector';
const CONTEXTS = ['ai-review', 'claude-review'];
const STATUS_DESCRIPTION_LIMIT = 140;
const NO_ISSUES_COMMENT = /didn['’]t find any major issues|no major issues/i;
const BADGE = /\bP([0-9])\b/g;

const isCodex = login => String(login ?? '').replace(/\[bot\]$/, '') === CODEX_LOGIN;

// Highest priority badge in a finding, or null when it carries none.
function priorityOf(body) {
  const levels = [...String(body ?? '').matchAll(BADGE)].map(match => Number(match[1]));
  return levels.length ? Math.min(...levels) : null;
}

// A finding blocks unless it names a badge below P1. A finding with no badge
// at all fails closed: the gate cannot tell how serious it is.
const blocks = body => {
  const level = priorityOf(body);
  return level === null || level <= 1;
};

// pr: { headOid, committedDate, reviews, comments, thumbsUp }
//   reviews:  [{ author, commit, body, comments: [body] }]
//   comments: [{ author, body, createdAt }]
//   thumbsUp: () => Promise<Date[]> creation times of the bot's thumbs-up
// Returns { state, description, evidence } where evidence is an https URL or ''.
async function evaluate(pr) {
  const short = pr.headOid.slice(0, 7);
  const reviews = pr.reviews.filter(review => isCodex(review.author) && review.commit === pr.headOid);

  const blocking = [];
  for (const review of reviews) {
    for (const body of review.comments) if (blocks(body)) blocking.push(body);
    if (!review.comments.length && priorityOf(review.body) !== null && blocks(review.body)) blocking.push(review.body);
  }
  if (blocking.length) {
    const levels = blocking.map(priorityOf);
    const label = levels.includes(0) ? 'P0' : levels.includes(1) ? 'P1' : 'unrated';
    return {
      state: 'failure',
      description: `Codex review of ${short} raised ${blocking.length} finding(s), worst ${label}`,
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
  if (clean) {
    return {
      state: 'success',
      description: `Codex found no major issues in ${short}`,
      evidence: clean.url ?? '',
    };
  }

  const reactions = await pr.thumbsUp();
  if (reactions.some(at => at.getTime() >= since)) {
    return { state: 'success', description: `Codex reacted with a thumbs up on ${short}`, evidence: '' };
  }

  return { state: 'pending', description: `Waiting for the Codex review of ${short}`, evidence: '' };
}

const PR_FIELDS = `
fragment pr on PullRequest {
  number
  state
  baseRefName
  isCrossRepository
  headRefOid
  commits(last: 1) { nodes { commit { oid committedDate status { contexts { context state description } } } } }
  reviews(last: 30) { nodes { author { login } url body commit { oid } comments(first: 50) { nodes { body } } } }
  comments(last: 30) { nodes { author { login } url body createdAt } }
}`;

const ALL_OPEN = `
query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 25, after: $after, baseRefName: "production") {
      pageInfo { hasNextPage endCursor }
      nodes { ...pr }
    }
  }
}${PR_FIELDS}`;

const ONE = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { ...pr }
  }
}${PR_FIELDS}`;

function shape(node, thumbsUp) {
  const head = node.commits.nodes[0]?.commit;
  return {
    number: node.number,
    headOid: node.headRefOid,
    head,
    reviews: node.reviews.nodes.map(review => ({
      author: review.author?.login,
      url: review.url,
      body: review.body,
      commit: review.commit?.oid,
      comments: review.comments.nodes.map(comment => comment.body ?? ''),
    })),
    comments: node.comments.nodes.map(comment => ({
      author: comment.author?.login,
      url: comment.url,
      body: comment.body,
      createdAt: comment.createdAt,
    })),
    committedDate: head?.committedDate,
    thumbsUp,
  };
}

async function run({ github, context, core }) {
  const { owner, repo } = context.repo;
  const eventNumber = context.payload.pull_request?.number ?? context.payload.issue?.number ?? Number(context.payload.inputs?.pr || 0);

  const reactionsFor = number => async () => {
    const reactions = await github.paginate(github.rest.reactions.listForIssue, {
      owner, repo, issue_number: number, content: '+1', per_page: 100,
    });
    return reactions.filter(reaction => isCodex(reaction.user?.login)).map(reaction => new Date(reaction.created_at));
  };

  let nodes;
  if (eventNumber) {
    const { repository } = await github.graphql(ONE, { owner, name: repo, number: eventNumber });
    const node = repository.pullRequest;
    nodes = node && node.state === 'OPEN' && node.baseRefName === 'production' ? [node] : [];
  } else {
    nodes = [];
    let after = null;
    do {
      const { repository } = await github.graphql(ALL_OPEN, { owner, name: repo, after });
      nodes.push(...repository.pullRequests.nodes);
      after = repository.pullRequests.pageInfo.hasNextPage ? repository.pullRequests.pageInfo.endCursor : null;
    } while (after);
  }

  const summary = { success: 0, failure: 0, pending: 0, unchanged: 0, skipped: 0 };
  for (const node of nodes) {
    if (node.isCrossRepository) { summary.skipped++; continue; }
    const pr = shape(node, reactionsFor(node.number));
    if (!pr.head || pr.head.oid !== pr.headOid) { summary.skipped++; continue; }
    const result = await evaluate(pr);
    summary[result.state]++;

    const description = (result.evidence ? `${result.description} ${result.evidence}` : result.description).slice(0, STATUS_DESCRIPTION_LIMIT);
    const existing = new Map(pr.head.status?.contexts?.map(entry => [entry.context, entry]) ?? []);
    for (const statusContext of CONTEXTS) {
      const previous = existing.get(statusContext);
      // Never overwrite a terminal result that something else set (for example
      // the one-time bootstrap) with a weaker one, and skip identical writes.
      if (previous && previous.state.toLowerCase() === result.state && previous.description === description) { summary.unchanged++; continue; }
      if (result.state === 'pending' && previous && previous.state !== 'PENDING') continue;
      await github.rest.repos.createCommitStatus({
        owner, repo, sha: pr.headOid, state: result.state, context: statusContext, description,
        target_url: result.evidence || `${context.serverUrl}/${owner}/${repo}/pull/${pr.number}`,
      });
    }

    // Auto-merge looks for an APPROVE comment that names the exact head
    // commit; the old reviewer posted it, so this posts the same marker.
    if (result.state === 'success') {
      const marker = `reviewed-commit: ${pr.headOid}`;
      const posted = pr.comments.some(comment => (comment.body ?? '').includes(marker) && /^APPROVE/.test(comment.body ?? ''));
      if (!posted) {
        await github.rest.issues.createComment({
          owner, repo, issue_number: pr.number,
          body: `APPROVE\n\n${result.description}.${result.evidence ? ` Codex review: ${result.evidence}` : ''}\n\n${marker}\n<!-- codex-review-gate -->`,
        });
      }
    }
    core.info(`PR #${pr.number} ${pr.headOid.slice(0, 7)}: ${result.state}. ${result.description}`);
  }
  core.info(`Codex review gate: ${JSON.stringify(summary)}`);
  return summary;
}

module.exports = { evaluate, priorityOf, blocks, isCodex, run, CODEX_LOGIN, CONTEXTS };
