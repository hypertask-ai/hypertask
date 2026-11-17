'use strict';

const RED_CONTEXTS = ['ai-review', 'claude-review', 'pstack-verifier'];
const MARKER = /<!-- review-fix:v1 (\{.*?\}) -->/s;
const MAX_FIXES = 3;
const MAX_FINDINGS_CHARS = 60_000;
const OFF_LABEL = 'review-fix-off';
const FINDING_AUTHORS = new Set(['chatgpt-codex-connector', 'github-actions', 'hypertask-runners']);
const FINDING_MARKERS = [/<!-- codex-code-review-finding:v1/, /<!-- claude-review:v1/, /pstack-verifier/];

const login = user => String(user?.login ?? '').replace(/\[bot\]$/, '');

function markers(comments) {
  return comments.filter(comment => login(comment.user) === 'github-actions').flatMap(comment => {
    try {
      const state = JSON.parse(MARKER.exec(String(comment.body ?? ''))?.[1] ?? 'null');
      return state && typeof state.sha === 'string' ? [state] : [];
    } catch {
      return [];
    }
  });
}

function eligible({ pr, statuses, comments, repo }) {
  if (pr.state !== 'open' || pr.draft || pr.base.ref !== 'production') return 'not an open production PR';
  if (pr.head.repo?.full_name !== repo) return 'head is outside this repository';
  if (login(pr.user) === 'dependabot') return 'dependabot PR';
  if ((pr.labels ?? []).some(label => label.name === OFF_LABEL)) return `label ${OFF_LABEL}`;
  const latest = new Map();
  for (const status of statuses) if (!latest.has(status.context)) latest.set(status.context, status.state);
  const red = RED_CONTEXTS.filter(context => ['failure', 'error'].includes(latest.get(context)));
  if (!red.length) return 'no red review status';
  const tried = markers(comments);
  if (tried.some(state => state.sha === pr.head.sha)) return 'this head was already tried';
  if (tried.filter(state => state.pushed).length >= MAX_FIXES) return `already ${MAX_FIXES} fix commits`;
  return '';
}

function findingsText({ pr, statuses, reviewComments, comments, reviews }) {
  const head = pr.head.sha;
  const parts = [];
  const seen = new Set();
  for (const status of statuses) {
    if (!RED_CONTEXTS.includes(status.context) || seen.has(status.context)) continue;
    seen.add(status.context);
    parts.push(`## Status ${status.context}: ${status.state}\n${status.description ?? ''}`);
  }
  for (const review of reviews) {
    if (review.commit_id === head && FINDING_AUTHORS.has(login(review.user)) && String(review.body ?? '').trim()) {
      parts.push(`## Review by ${login(review.user)}\n${review.body}`);
    }
  }
  const inline = comment => FINDING_AUTHORS.has(login(comment.user)) && comment.line != null && !comment.in_reply_to_id;
  const matching = ids => reviewComments.filter(comment => inline(comment) && ids.has(comment.pull_request_review_id));
  const onHead = matching(new Set(reviews.filter(review => review.commit_id === head).map(review => review.id)));
  const newestCodex = reviews.filter(review => login(review.user) === 'chatgpt-codex-connector').sort((a, b) => (Date.parse(b.submitted_at) || 0) - (Date.parse(a.submitted_at) || 0))[0];
  const chosen = onHead.length ? onHead : matching(new Set(newestCodex ? [newestCodex.id] : []));
  for (const comment of chosen) parts.push(`## ${comment.path}:${comment.line} (${login(comment.user)})\n${comment.body}`);
  for (const comment of [...comments].reverse()) {
    const body = String(comment.body ?? '');
    if (!FINDING_AUTHORS.has(login(comment.user)) || !body.includes(head.slice(0, 7))) continue;
    if (FINDING_MARKERS.some(marker => marker.test(body))) parts.push(`## Comment by ${login(comment.user)}\n${body}`);
  }
  return parts.join('\n\n').slice(0, MAX_FINDINGS_CHARS);
}

async function listAll(github, route, params) {
  return github.paginate(route, { ...params, per_page: 100 });
}

async function pick({ github, context, core, single = 0 }) {
  const { owner, repo } = context.repo;
  const full = `${owner}/${repo}`;
  const numbers = single
    ? [single]
    : (await listAll(github, 'GET /repos/{owner}/{repo}/pulls', { owner, repo, state: 'open', base: 'production' })).map(pr => pr.number);
  const picked = [];
  for (const number of numbers) {
    const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: number });
    const statuses = await listAll(github, 'GET /repos/{owner}/{repo}/commits/{ref}/statuses', { owner, repo, ref: pr.head.sha });
    const comments = await listAll(github, 'GET /repos/{owner}/{repo}/issues/{issue_number}/comments', { owner, repo, issue_number: number });
    const reason = eligible({ pr, statuses, comments, repo: full });
    core.info(`#${number} ${pr.head.sha.slice(0, 7)}: ${reason || 'picked'}`);
    if (!reason) picked.push({ number, sha: pr.head.sha, branch: pr.head.ref });
  }
  return picked;
}

async function collect({ github, context, number }) {
  const { owner, repo } = context.repo;
  const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: number });
  const [statuses, reviewComments, comments, reviews] = await Promise.all([
    listAll(github, 'GET /repos/{owner}/{repo}/commits/{ref}/statuses', { owner, repo, ref: pr.head.sha }),
    listAll(github, 'GET /repos/{owner}/{repo}/pulls/{pull_number}/comments', { owner, repo, pull_number: number }),
    listAll(github, 'GET /repos/{owner}/{repo}/issues/{issue_number}/comments', { owner, repo, issue_number: number }),
    listAll(github, 'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews', { owner, repo, pull_number: number }),
  ]);
  return { pr, findings: findingsText({ pr, statuses, reviewComments, comments, reviews }) };
}

function markerBody({ sha, pushed, note }) {
  return `<!-- review-fix:v1 ${JSON.stringify({ sha, pushed })} -->\nReview fix on ${sha.slice(0, 7)}: ${note}`;
}

module.exports = { eligible, findingsText, markers, markerBody, pick, collect, MAX_FIXES, OFF_LABEL, RED_CONTEXTS };
