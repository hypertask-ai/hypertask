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

const UNREAD = 'Further comments were not read.';
const commentBody = comment => (typeof comment === 'string' ? comment : String(comment?.body ?? ''));
const commentCommit = (comment, review) => (typeof comment === 'string' ? review.commit : comment?.commit ?? review.commit);

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

const CLEAN_RECEIPT = /Didn['’]t find any major issues[\s\S]{0,500}?Reviewed commit:\**\s*`([0-9a-f]{10,40})`/i;

function cleanHeadReceipt(comments, headOid) {
  for (const comment of comments ?? []) {
    if (!isCodex(comment.author)) continue;
    const match = CLEAN_RECEIPT.exec(String(comment.body ?? ''));
    if (match && headOid.startsWith(match[1])) return comment.url ?? '';
  }
  return '';
}

function evaluate(pr) {
  const short = pr.headOid.slice(0, 7);
  const codexReviews = pr.reviews.filter(review => isCodex(review.author));
  const headReviews = codexReviews.filter(review => review.commit === pr.headOid);
  const staleReviews = codexReviews.filter(review => review.commit !== pr.headOid);
  const remappedBodies = staleReviews.flatMap(review => review.comments.filter(
    comment => commentCommit(comment, review) === pr.headOid)).map(commentBody);
  const summary = codeReviewStateFor(pr.comments, pr.headOid);
  const receiptUrl = cleanHeadReceipt(pr.comments, pr.headOid);
  const summaryClean = summary?.status === 'completed' && (
    summary.has_any_findings === false || summary.has_unresolved_findings === false);
  const headReviewed = headReviews.length > 0 || summaryClean || (summary?.status === 'completed' && Boolean(receiptUrl));
  const unreadStale = !headReviewed && staleReviews.some(review => review.comments.some(comment => commentBody(comment) === UNREAD));

  const rawBlocking = headReviews.flatMap(review => review.comments.length
    ? review.comments.map(commentBody).filter(blocks)
    : priorityOf(review.body) !== null && blocks(review.body) ? [review.body] : [])
    .concat(headReviewed ? [] : remappedBodies.filter(blocks), unreadStale ? [UNREAD] : []);
  const blocking = rawBlocking.filter(body => !waivedOwnerQaVisualReleaseFinding(body, pr.statusContexts));
  if (blocking.length) {
    const levels = blocking.map(priorityOf);
    const worst = levels.includes(0) ? 'P0' : levels.includes(1) ? 'P1' : 'unrated';
    return {
      state: 'failure',
      description: `Codex review of ${short} raised ${blocking.length} finding(s), worst ${worst}`,
      evidence: codexReviews.find(review => review.url)?.url ?? '',
    };
  }
  if (rawBlocking.length) {
    return {
      state: 'success',
      description: `Codex reviewed ${short}; feature-flag gate allowed Owner + QA release`,
      evidence: codexReviews.findLast(review => review.url)?.url ?? '',
    };
  }
  if (headReviews.length || (!headReviewed && remappedBodies.length)) {
    return {
      state: 'success',
      description: `Codex reviewed ${short} and raised no P0 or P1 findings`,
      evidence: codexReviews.findLast(review => review.url)?.url ?? '',
    };
  }
  if (summary?.status === 'completed' && receiptUrl) {
    return {
      state: 'success',
      description: `Codex reviewed ${short} and raised no P0 or P1 findings`,
      evidence: receiptUrl,
    };
  }

  if (summary?.status === 'completed') {
    if (summary.has_unresolved_findings === false || summary.has_any_findings === false
        || summary.has_unresolved_findings === true) {
      const noneLeft = summary.has_unresolved_findings === false && summary.has_any_findings === true;
      const p2Only = summary.has_unresolved_findings === true;
      return {
        state: 'success',
        description: p2Only
          ? `Codex completed its review of ${short}; remaining findings are P2 or lower`
          : noneLeft
            ? `Codex completed its review of ${short} with no unresolved findings`
            : `Codex completed its review of ${short} with no findings`,
        evidence: summary.url,
      };
    }
  }
  return { state: 'pending', description: `Waiting for the Codex review of ${short}`, evidence: '' };
}

const SWEEP = `
query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 25, after: $after, baseRefName: "production") {
      pageInfo { hasNextPage endCursor }
      nodes {
        number isDraft isCrossRepository headRefOid
        commits(last: 1) { nodes { commit { oid status { contexts { context state description } } } } }
        reviews(last: 100) { pageInfo { hasPreviousPage } nodes { author { login } url body commit { oid } comments(first: 50) { pageInfo { hasNextPage } nodes { body author { login } replyTo { id } commit { oid } } } } }
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
        comments: review.comments.nodes.filter(comment => !comment.replyTo && isCodex(comment.author?.login)).map(comment => ({ body: comment.body ?? '', commit: comment.commit?.oid })).concat(review.comments.pageInfo.hasNextPage ? [UNREAD] : []),
      })),
      comments: node.comments.nodes.map(comment => ({ ...comment, author: comment.author?.login })),
    });

    const requestMarker = `<!-- codex-review-request:${node.headRefOid} -->`;
    const comments = node.comments.nodes.map(comment => ({ ...comment, author: comment.author?.login }));
    const running = codeReviewStateFor(comments, node.headRefOid)?.status === 'running';
    const requested = comments.some(comment =>
      String(comment.author ?? '').replace(/\[bot\]$/, '') === 'github-actions' && comment.body?.includes(requestMarker));
    if (result.state === 'pending' && !node.isDraft && !running && !requested) {
      const current = await github.rest.pulls.get({ owner, repo, pull_number: node.number });
      if (current.data.head.sha === node.headRefOid && current.data.state === 'open' && !current.data.draft) {
        await github.rest.issues.createComment({
          owner, repo, issue_number: node.number,
          body: `@codex review\n\nReview the current head ${node.headRefOid}.\n${requestMarker}`,
        });
      }
    }

    const description = [result.description, result.evidence].filter(Boolean).join(' ').slice(0, STATUS_DESCRIPTION_LIMIT);
    const existing = new Map((head.status?.contexts ?? []).map(entry => [entry.context, entry]));
    const detailsUrl = result.evidence || `${context.serverUrl}/${owner}/${repo}/pull/${node.number}`;
    const checkConclusion = { success: 'success', failure: 'failure' }[result.state] ?? null;
    let latestCheckByName = new Map();
    if (checkConclusion) {
      const headCheckRuns = await github.paginate(github.rest.checks.listForRef, {
        owner, repo, ref: node.headRefOid, per_page: 100,
      });
      for (const check of headCheckRuns) {
        if (!CONTEXTS.includes(check.name)) continue;
        const prior = latestCheckByName.get(check.name);
        if (!prior || Date.parse(check.started_at) > Date.parse(prior.started_at)) {
          latestCheckByName.set(check.name, check);
        }
      }
    }
    for (const statusContext of CONTEXTS) {
      const previous = existing.get(statusContext);
      const unchanged = previous && previous.state.toLowerCase() === result.state && previous.description === description;
      if (!previous || !(result.state === 'pending' || unchanged)) {
        await github.rest.repos.createCommitStatus({
          owner, repo, sha: node.headRefOid, state: result.state, context: statusContext, description,
          target_url: detailsUrl,
        });
      }
      if (checkConclusion) {
        const existingCheck = latestCheckByName.get(statusContext);
        const checkOk = existingCheck?.status === 'completed' && existingCheck.conclusion === checkConclusion;
        if (!checkOk) {
          await github.rest.checks.create({
            owner, repo, name: statusContext, head_sha: node.headRefOid, status: 'completed',
            conclusion: checkConclusion, details_url: detailsUrl,
            output: { title: statusContext, summary: description },
          });
        }
      }
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
