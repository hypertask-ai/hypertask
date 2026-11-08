'use strict';

const CODEX_LOGIN = 'chatgpt-codex-connector';
const CONTEXTS = ['ai-review', 'claude-review'];
const STATUS_DESCRIPTION_LIMIT = 140;
const REVIEW_STATE = /<!-- codex-review-state:v1 (\{.*?\}) -->/s;
const BADGES = [/\bP([0-9]) Badge/g, /badge\/P([0-9])-/g, /\[P([0-9])\]/g, /\bP([0-9])\b/g];

const isCodex = login => String(login ?? '').replace(/\[bot\]$/, '') === CODEX_LOGIN;

function priorityOf(body) {
  for (const pattern of BADGES) {
    const levels = [...String(body ?? '').matchAll(pattern)].map(match => Number(match[1]));
    if (levels.length) return Math.min(...levels);
  }
  return null;
}

const blocks = body => (priorityOf(body) ?? 0) <= 1;

const WIDEN_DEFAULT_MODE_PATTERNS = [
  /\bdefaultMode\s+(?:should|must|needs to)\s+(?:be\s+)?["']?EVERYONE\b/i,
  /\bdefault\s+mode\s+(?:should|must|needs to)\s+(?:be\s+)?EVERYONE\b/i,
  /\b(?:Set|Default)\s+defaultMode\s+to\s+EVERYONE\b/i,
  /\b(?:Default|Set)\s+(?:the\s+)?(?:feature\s+)?flag\s+to\s+Everyone\b/i,
  /\b(?:Default|Set)\s+(?:this\s+)?visible\s+UI[\s\S]{0,80}\b(?:to\s+)?Everyone\b/i,
];

function ownerQaVisualReleaseOnlyFinding(body) {
  const text = String(body ?? '');
  if (!WIDEN_DEFAULT_MODE_PATTERNS.some(pattern => pattern.test(text))) return false;
  const demandsEveryoneDefault = /\bdefaultMode\s+(?:should|must|needs to)\s+(?:be\s+)?["']?EVERYONE\b/i.test(text)
    || /\b(?:Set|Default)\s+defaultMode\s+to\s+EVERYONE\b/i.test(text);
  if (/\b(?:authorization|auth|security)\s+fix\b/i.test(text) && /\bbefore\b[\s\S]{0,160}\bEveryone\b/i.test(text) && !demandsEveryoneDefault) {
    return false;
  }
  if (/\bOWNER_AND_QA\b[\s\S]{0,120}\b(?:is\s+not|isn't)\s+protection\b/i.test(text) && !demandsEveryoneDefault) {
    return false;
  }
  return true;
}

function featureFlagGatePassed(contexts) {
  const entry = (contexts ?? []).find(c => c.context === 'feature-flag-gate');
  return entry && String(entry.state).toLowerCase() === 'success';
}

function waivedOwnerQaVisualReleaseFinding(body, contexts) {
  return featureFlagGatePassed(contexts) && ownerQaVisualReleaseOnlyFinding(body);
}

function codeReviewStateFor(comments, headOid) {
  for (const comment of [...comments].reverse()) {
    if (!isCodex(comment.author)) continue;
    const raw = REVIEW_STATE.exec(comment.body ?? '')?.[1];
    if (!raw) continue;
    try {
      const state = JSON.parse(raw).code_review;
      if (state?.commit_sha === headOid) return { ...state, url: comment.url ?? '' };
    } catch {
      continue;
    }
  }
  return null;
}

function evaluate(pr) {
  const short = pr.headOid.slice(0, 7);
  const reviews = pr.reviews.filter(review => isCodex(review.author) && review.commit === pr.headOid);

  const rawBlocking = reviews.flatMap(review => review.comments.length
    ? review.comments.filter(blocks)
    : priorityOf(review.body) !== null && blocks(review.body) ? [review.body] : []);
  const blocking = rawBlocking.filter(body => !waivedOwnerQaVisualReleaseFinding(body, pr.statusContexts));
  if (blocking.length) {
    const levels = blocking.map(priorityOf);
    const worst = levels.includes(0) ? 'P0' : levels.includes(1) ? 'P1' : 'unrated';
    return {
      state: 'failure',
      description: `Codex review of ${short} raised ${blocking.length} finding(s), worst ${worst}`,
      evidence: reviews.find(review => review.url)?.url ?? '',
    };
  }
  if (rawBlocking.length) {
    return {
      state: 'success',
      description: `Codex reviewed ${short}; feature-flag gate allowed Owner + QA release`,
      evidence: reviews.findLast(review => review.url)?.url ?? '',
    };
  }
  if (reviews.length) {
    return {
      state: 'success',
      description: `Codex reviewed ${short} and raised no P0 or P1 findings`,
      evidence: reviews.findLast(review => review.url)?.url ?? '',
    };
  }

  const summary = codeReviewStateFor(pr.comments, pr.headOid);
  if (summary?.status === 'completed' && summary.has_any_findings === false) {
    return { state: 'success', description: `Codex completed its review of ${short} with no findings`, evidence: summary.url };
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
        commits(last: 1) { nodes { commit { oid status { contexts { context state description } } } } }
        reviews(last: 100) { pageInfo { hasPreviousPage } nodes { author { login } url body commit { oid } comments(first: 50) { pageInfo { hasNextPage } nodes { body author { login } replyTo { id } } } } }
        comments(last: 100) { nodes { author { login } url body } }
      }
    }
  }
}`;

async function run({ github, context, core }) {
  const { owner, repo } = context.repo;
  const only = context.payload.pull_request?.number ?? context.payload.issue?.number ?? 0;

  const nodes = [];
  for (let after = null, more = true; more;) {
    const { repository: { pullRequests } } = await github.graphql(SWEEP, { owner, name: repo, after });
    nodes.push(...pullRequests.nodes);
    ({ hasNextPage: more, endCursor: after } = pullRequests.pageInfo);
  }

  for (const node of nodes.filter(node => !only || node.number === only)) {
    const head = node.commits.nodes[0]?.commit;
    if (node.isCrossRepository || head?.oid !== node.headRefOid || node.reviews.pageInfo.hasPreviousPage) continue;
    const result = evaluate({
      headOid: node.headRefOid,
      statusContexts: head?.status?.contexts ?? [],
      reviews: node.reviews.nodes.map(review => ({
        author: review.author?.login, url: review.url, body: review.body, commit: review.commit?.oid,
        comments: review.comments.nodes.filter(comment => !comment.replyTo && isCodex(comment.author?.login)).map(comment => comment.body ?? '').concat(review.comments.pageInfo.hasNextPage ? ['Further comments were not read.'] : []),
      })),
      comments: node.comments.nodes.map(comment => ({ ...comment, author: comment.author?.login })),
    });

    const description = [result.description, result.evidence].filter(Boolean).join(' ').slice(0, STATUS_DESCRIPTION_LIMIT);
    const existing = new Map((head.status?.contexts ?? []).map(entry => [entry.context, entry]));
    for (const statusContext of CONTEXTS) {
      const previous = existing.get(statusContext);
      const unchanged = previous && previous.state.toLowerCase() === result.state && previous.description === description;
      if (previous && (result.state === 'pending' || unchanged)) continue;
      await github.rest.repos.createCommitStatus({
        owner, repo, sha: node.headRefOid, state: result.state, context: statusContext, description,
        target_url: result.evidence || `${context.serverUrl}/${owner}/${repo}/pull/${node.number}`,
      });
    }

    const marker = `reviewed-commit: ${node.headRefOid}`;
    const alreadyApproved = node.comments.nodes.some(comment => (comment.body ?? '').includes(marker) && /^APPROVE/.test(comment.body));
    if (result.state === 'success' && !alreadyApproved) {
      await github.rest.issues.createComment({
        owner, repo, issue_number: node.number,
        body: `APPROVE\n\n${result.description}.${result.evidence ? ` Codex review: ${result.evidence}` : ''}\n\n${marker}\n<!-- codex-review-gate -->`,
      });
    }
    core.info(`PR #${node.number} ${node.headRefOid.slice(0, 7)}: ${result.state}. ${result.description}`);
  }
}

module.exports = {
  evaluate,
  priorityOf,
  blocks,
  isCodex,
  codeReviewStateFor,
  run,
  featureFlagGatePassed,
  ownerQaVisualReleaseOnlyFinding,
  waivedOwnerQaVisualReleaseFinding,
};
