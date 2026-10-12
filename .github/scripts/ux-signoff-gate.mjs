import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const CONTEXT = 'ux-signoff';
const READ_ERROR = 'Could not read the ticket; retried every 10 minutes';
const TICKET_TITLE = /^(HTPR|HYFA|YPER4)-(\d+) \[([^\]]+)\] \S/;
const WIREFRAME = /https:\/\/hypertask\.app\/(?:wireframes|explorations)\/[A-Za-z0-9_-]+/;

function ticketFromTitle(title) {
  const match = TICKET_TITLE.exec(title);
  return match && { key: `${match[1]}-${match[2]}`, number: match[2], prefix: match[1], type: match[3] };
}

function visibleFiles(files) {
  return files.filter(({ filename, status }) => status !== 'removed' &&
    (filename.startsWith('src/components/') ||
      (filename.startsWith('src/app/') && !filename.startsWith('src/app/api/'))) &&
    /\.(tsx|jsx|css|scss)$/.test(filename) &&
    !/(?:\.(?:test|spec|stories)\.|(?:^|\/)__tests__\/)/.test(filename));
}

function plainText(text) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/<span\b[^>]*\bdata-type\s*=\s*(["'])mention\1[^>]*>[\s\S]*?<\/span\s*>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (raw, entity) => {
      if (!entity.startsWith('#')) return entities[entity.toLowerCase()];
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : raw;
    });
}

function approvingComment(comment) {
  if (comment.creatorId !== 6 || comment.agent != null) return false;
  const text = plainText(comment.text).trim().toLowerCase().replace(/[’‘]/g, "'");
  return /^(?:(?:yes|yep|yeah|go|ok|okay|approve|approved|lgtm|looks good|ship it)\b|👍)/u.test(text) &&
    !/\b(?:no|not|but|change|instead)\b|n't/.test(text);
}

export function evaluate({ title, author, files, comments = [] }) {
  const success = (description) => ({ state: 'success', description, details: [] });
  const ui = visibleFiles(files);
  if (ui.length === 0) return success('No visible UI change');
  if (author === 'dependabot[bot]') return success('Dependabot is exempt from UX signoff');
  const ticket = ticketFromTitle(title);
  if (!ticket) {
    const description = 'Title names no ticket, so the wireframe sign-off cannot be checked';
    return { state: 'failure', description, details: [description] };
  }

  const approvals = comments.filter(approvingComment);
  const approvedWireframes = comments.filter((comment) => WIREFRAME.test(comment.text) && (
    // Agent reactions keep the owner's userId but carry isAgent/agent (HTPR-7122); they never count.
    (comment.reactions ?? []).some(({ userId, emoji, isAgent, agent }) => userId === 6 && !isAgent && agent == null && /^(?:👍[🏻-🏿]?|✅)\uFE0F?$/u.test(emoji)) ||
    approvals.some((approval) => Date.parse(approval.createdAt) > Date.parse(comment.createdAt))
  ));
  const normalize = (text) => plainText(text).toLowerCase().replace(/[^a-z0-9]/g, '');
  const namedApprovalText = [...approvedWireframes, ...approvals].map((comment) => normalize(comment.text));
  const newElements = [...new Set(ui.filter(({ filename, status }) =>
    (status === 'added' || status === 'copied') && filename.startsWith('src/components/') &&
    /\.(tsx|jsx)$/.test(filename)).map(({ filename }) => basename(filename).replace(/\.(tsx|jsx)$/, '')))];
  const missingNames = newElements.filter((name) =>
    !namedApprovalText.some((text) => text.includes(name.toLowerCase().replace(/[^a-z0-9]/g, ''))));
  const details = [];
  if (ticket.type !== 'BUGFIX' && approvedWireframes.length === 0) {
    details.push(`UI change needs Valentin's yes on a wireframe on ${ticket.key}`);
  }
  if (missingNames.length) {
    details.push(`New element ${missingNames.join(', ')} needs Valentin's yes by name on ${ticket.key}`);
  }
  if (details.length) return { state: 'failure', description: details[0].slice(0, 140), details };
  return success(ticket.type === 'BUGFIX' ? 'Bugfix restores intended behaviour; new elements approved' : 'Wireframe and new elements have UX signoff');
}

export function ticketUrl(title, runUrl) {
  const ticket = ticketFromTitle(title);
  const project = { HTPR: 15, YPER4: 4060 }[ticket?.prefix];
  return project ? `https://app.hypertask.ai/detail/project-${project}/${ticket.number}` : runUrl;
}

export function createGithub({ env = process.env, fetchImpl = fetch, exec = execFileSync } = {}) {
  return async (path, { method = 'GET', body } = {}) => {
    if (!env.GH_TOKEN) {
      const args = ['api', '--method', method, path];
      if (body) args.push('--input', '-');
      return JSON.parse(exec('gh', args, {
        encoding: 'utf8', input: body ? JSON.stringify(body) : undefined, timeout: 30000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }));
    }
    const response = await fetchImpl(`https://api.github.com/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}`);
    return response.json();
  };
}

async function githubPages(github, path) {
  const items = [];
  for (let page = 1; ; page++) {
    const entries = await github(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (!Array.isArray(entries)) throw new Error('GitHub API returned no list');
    items.push(...entries);
    if (entries.length < 100) return items;
  }
}

export async function readComments(ticket, { env = process.env, fetchImpl = fetch } = {}) {
  if (!env.MCP_TOKEN) throw new Error('HYPERTASK_MCP_TOKEN is empty');
  const comments = [];
  const cursors = new Set();
  let cursor;
  do {
    const url = new URL('/api/mcp/comments', env.MCP_BASE_URL || 'https://app.hypertask.ai');
    url.searchParams.set('ticket_number', ticket);
    url.searchParams.set('limit', '100');
    if (cursor != null) url.searchParams.set('cursor', cursor);
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${env.MCP_TOKEN}` }, signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Hypertask API returned HTTP ${response.status}`);
    const data = await response.json();
    if (data.success === false || !Array.isArray(data.comments) ||
      data.comments.some((comment) => !comment || typeof comment.text !== 'string')) {
      throw new Error('Hypertask API returned no valid comment list');
    }
    comments.push(...data.comments);
    cursor = data.nextCursor;
    if (cursor != null) {
      if ((typeof cursor !== 'string' && typeof cursor !== 'number') || cursors.has(String(cursor))) {
        throw new Error('Hypertask API returned an invalid or repeated cursor');
      }
      cursors.add(String(cursor));
    }
  } while (cursor != null);
  return comments;
}

async function readVerdict(pr, { github, repo, env, fetchImpl }) {
  if (!env.MCP_TOKEN) throw new Error('HYPERTASK_MCP_TOKEN is empty');
  if (typeof pr.title !== 'string' || typeof pr.user?.login !== 'string') throw new Error('Invalid PR metadata');
  const files = await githubPages(github, `repos/${repo}/pulls/${pr.number}/files`);
  if (files.some((file) => typeof file.filename !== 'string' || typeof file.status !== 'string') ||
    (Number.isInteger(pr.changed_files) && files.length !== pr.changed_files)) {
    throw new Error('Incomplete PR file list');
  }
  const ticket = ticketFromTitle(pr.title);
  const comments = ticket ? await readComments(ticket.key, { env, fetchImpl }) : [];
  return evaluate({ title: pr.title, author: pr.user.login, files, comments });
}

export async function run(args, { env = process.env, fetchImpl = fetch, github = createGithub({ env, fetchImpl }), log = console.log } = {}) {
  let reconcile = false;
  let number;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--reconcile' && !reconcile) reconcile = true;
    else if (args[index] === '--pr' && number == null && /^[1-9]\d*$/.test(args[index + 1] ?? '')) number = Number(args[++index]);
    else throw new Error('Usage: ux-signoff-gate.mjs [--reconcile] [--pr <number>]');
  }
  if (!reconcile && number == null) throw new Error('Read-only mode requires --pr <number>');
  const repo = env.REPO || env.GITHUB_REPOSITORY || 'hypertask-ai/hypertask';
  const runUrl = env.RUN_URL || `https://github.com/${repo}/actions${env.GITHUB_RUN_ID ? `/runs/${env.GITHUB_RUN_ID}` : ''}`;
  const options = { github, repo, env, fetchImpl };
  if (!reconcile) {
    const pr = await github(`repos/${repo}/pulls/${number}`);
    const verdict = await readVerdict(pr, options);
    log(JSON.stringify(verdict, null, 2));
    return verdict.state === 'success' ? 0 : 1;
  }

  const openPrs = await githubPages(github, `repos/${repo}/pulls?state=open&base=production`);
  const prs = number == null ? openPrs : openPrs.filter((pr) => pr.number === number);
  let errors = false;
  for (const listed of prs) {
    let pr = listed;
    let verdict;
    try {
      pr = await github(`repos/${repo}/pulls/${listed.number}`);
      if (pr.state !== 'open' || pr.base?.ref !== 'production') continue;
      verdict = await readVerdict(pr, options);
      const current = await github(`repos/${repo}/pulls/${pr.number}`);
      if (current.state !== 'open' || current.base?.ref !== 'production') continue;
      if (current.head?.sha !== pr.head?.sha || current.title !== pr.title || current.base?.sha !== pr.base?.sha) {
        verdict = { state: 'error', description: 'Pull request changed during evaluation; retried every 10 minutes', details: [] };
      }
    } catch {
      verdict = { state: 'error', description: READ_ERROR, details: [] };
    }
    try {
      if (!/^[a-f0-9]{40}$/.test(pr.head?.sha ?? '')) throw new Error('No PR head SHA to publish');
      const statuses = await githubPages(github, `repos/${repo}/commits/${pr.head.sha}/statuses`);
      const newest = statuses.find((status) => status.context === CONTEXT);
      if (newest?.state !== verdict.state || newest?.description !== verdict.description) {
        await github(`repos/${repo}/statuses/${pr.head.sha}`, {
          method: 'POST', body: {
            context: CONTEXT, state: verdict.state, description: verdict.description,
            target_url: ticketUrl(pr.title, runUrl),
          },
        });
      }
      if (verdict.state === 'error') errors = true;
      log(JSON.stringify({ pr: pr.number, ...verdict }, null, 2));
    } catch {
      errors = true;
      log(JSON.stringify({ pr: listed.number, state: 'error', description: 'Could not publish UX signoff status' }));
    }
  }
  return errors ? 2 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await run(process.argv.slice(2));
  } catch (error) {
    // Do not echo response bodies or gh stderr, which may contain credentials.
    const description = error.code ? 'Could not read GitHub data' : error.message;
    console.log(JSON.stringify({ state: 'error', description, details: [] }, null, 2));
    process.exitCode = 2;
  }
}
