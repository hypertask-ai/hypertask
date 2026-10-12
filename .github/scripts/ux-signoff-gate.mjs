import { execFileSync } from 'node:child_process';
import { basename, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const CONTEXT = 'ux-signoff';
const READ_ERROR = 'Could not read the ticket; retried every 10 minutes';
const READ_BUDGET = 120;
const HEARTBEAT_MS = 60 * 60 * 1000;
const DEFERRED = 'Ticket not read this sweep; rechecked within 10 minutes';
const TICKET_TITLE = /^(HTPR|HYFA|YPER4)-(\d+) \[([^\]]+)\] \S/;
const WIREFRAME = /https:\/\/hypertask\.app\/(?:wireframes|explorations)\/[A-Za-z0-9_-]+/;

function ticketFromTitle(title) {
  const match = TICKET_TITLE.exec(title);
  return match && { key: `${match[1]}-${match[2]}`, number: match[2], prefix: match[1], type: match[3] };
}

function visibleFiles(files) {
  return files.filter(({ filename }) =>
    (filename.startsWith('src/components/') || filename.startsWith('src/styles/') ||
      (filename.startsWith('src/pages/') && !filename.startsWith('src/pages/api/')) ||
      (filename.startsWith('src/app/') && !filename.startsWith('src/app/api/'))) &&
    /\.(tsx|jsx|css|scss)$/.test(filename) &&
    !/(?:\.(?:test|spec|stories)\.|(?:^|\/)__tests__\/)/.test(filename));
}

function plainText(text) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/<span\b[^>]*\bdata-type\s*=\s*(["'])mention\1[^>]*>[\s\S]*?<\/span\s*>/gi, '')
    .replace(/<\/(?:p|div|li|h[1-6])\s*>|<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (raw, entity) => {
      if (!entity.startsWith('#')) return entities[entity.toLowerCase()];
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : raw;
    });
}

function humanValentin(item, idField) {
  return item[idField] === 6 &&
    ['agent', 'agent_display_name', 'agentId', 'isAgent'].every((key) => item[key] == null);
}

function commentVerdict(comment) {
  if (!humanValentin(comment, 'creatorId')) return null;
  // Agents for the same owner keep his attribution: any edit he did not make himself blocks until a fresh yes.
  if (comment.editedAt != null && !(comment.editedBy && humanValentin(comment.editedBy, 'userId'))) return 'reject';
  const text = plainText(comment.text).trim().toLowerCase().replace(/[’‘]/g, "'");
  if (/^(?:no|nope|not|reject|don't)\b|\b(?:no|not|but|change|instead)\b|n't/.test(text)) return 'reject';
  return /^(?:(?:yes|yep|yeah|go|ok|okay|approve|approved|lgtm|looks good|ship it)\b|👍)/u.test(text) ? 'approve' : null;
}

function newest(comments) {
  return comments.filter((comment) => Number.isFinite(Date.parse(comment.createdAt)))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (b.id ?? 0) - (a.id ?? 0))[0];
}

function elementNames(comment) {
  const normalize = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return [...plainText(comment.text).matchAll(/\bNew elements:[ \t]*([^\r\n.?;]*)/gi)]
    .flatMap((match) => match[1].split(',').map(normalize)).filter((name) => name && name !== 'none');
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

  // Valentin's own comments are verdicts, even when they quote the wireframe link.
  const wireframe = newest(comments.filter((comment) => WIREFRAME.test(comment.text) && !humanValentin(comment, 'creatorId')));
  const created = wireframe ? Date.parse(wireframe.createdAt) : -Infinity;
  const edited = wireframe?.editedAt ?? wireframe?.updatedAt;
  const revision = edited != null ? Date.parse(edited) : created;
  const verdict = newest(comments.filter((comment) =>
    Date.parse(comment.createdAt) > created && commentVerdict(comment)));
  const approval = verdict && commentVerdict(verdict) === 'approve' && Date.parse(verdict.createdAt) > revision ? verdict : null;
  const reacted = wireframe && (wireframe.reactions ?? []).some((reaction) =>
    humanValentin(reaction, 'userId') && /^(?:👍[🏻-🏿]?|✅)\uFE0F?$/u.test(reaction.emoji) &&
    (edited == null || Date.parse(reaction.createdAt) > revision));
  const approved = commentVerdict(verdict ?? {}) !== 'reject' && Boolean(approval || reacted);
  const approvedNames = new Set([
    ...(wireframe && approved ? elementNames(wireframe) : []),
    ...(approval && approved ? elementNames(approval) : []),
  ]);
  const newElements = [...new Set(ui.filter(({ filename, status }) =>
    (status === 'added' || status === 'copied') && filename.startsWith('src/components/') &&
    /\.(tsx|jsx)$/.test(filename)).map(({ filename }) => {
      const name = basename(filename).replace(/\.(tsx|jsx)$/, '');
      return name === 'index' ? basename(dirname(filename)) : name;
    }))];
  const missingNames = newElements.filter((name) => !approvedNames.has(name.toLowerCase().replace(/[^a-z0-9]/g, '')));
  const exempt = ticket.type === 'BUGFIX' || ticket.prefix === 'YPER4';
  const details = [];
  if (!exempt && (!wireframe || !approved)) {
    details.push(`UI change needs Valentin's yes on a wireframe on ${ticket.key}`);
  }
  if (missingNames.length) {
    details.push(`New element ${missingNames.join(', ')} needs Valentin's yes by name on ${ticket.key}`);
  }
  if (details.length) return { state: 'failure', description: details[0].slice(0, 140), details };
  return success(exempt ? 'Wireframe exempt; new elements approved' : 'Wireframe and new elements have UX signoff');
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

export async function readComments(ticket, { env = process.env, fetchImpl = fetch, budget } = {}) {
  if (!env.MCP_TOKEN) throw new Error('HYPERTASK_MCP_TOKEN is empty');
  const comments = [];
  const cursors = new Set();
  let cursor;
  do {
    const url = new URL('/api/mcp/comments', env.MCP_BASE_URL || 'https://app.hypertask.ai');
    url.searchParams.set('ticket_number', ticket);
    url.searchParams.set('limit', '100');
    if (cursor != null) url.searchParams.set('cursor', cursor);
    if (budget) {
      if (budget.stopped || budget.remaining === 0) {
        throw Object.assign(new Error(budget.stopped || 'Hypertask read budget exhausted; left untouched this run'), { deferred: true });
      }
      budget.remaining--;
    }
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${env.MCP_TOKEN}` }, signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      const error = new Error(`Hypertask API returned HTTP ${response.status}`);
      if (budget && (response.status === 429 || response.status >= 500)) {
        budget.stopped = `${error.message}; further reads stopped this run`;
        error.deferred = true;
      }
      throw error;
    }
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

async function readVerdict(pr, { github, repo, env, fetchImpl, commentCache, budget }) {
  if (typeof pr.title !== 'string' || typeof pr.user?.login !== 'string') throw new Error('Invalid PR metadata');
  const files = await githubPages(github, `repos/${repo}/pulls/${pr.number}/files`);
  if (files.some((file) => typeof file.filename !== 'string' || typeof file.status !== 'string') ||
    (Number.isInteger(pr.changed_files) && files.length !== pr.changed_files)) {
    throw new Error('Incomplete PR file list');
  }
  const input = { title: pr.title, author: pr.user.login, files };
  const preliminary = evaluate(input);
  const ticket = ticketFromTitle(pr.title);
  if (preliminary.state === 'success' || !ticket) return preliminary;
  if (!commentCache.has(ticket.key)) {
    commentCache.set(ticket.key, readComments(ticket.key, { env, fetchImpl, budget }));
  }
  return evaluate({ ...input, comments: await commentCache.get(ticket.key) });
}

export async function run(args, { env = process.env, fetchImpl = fetch, github = createGithub({ env, fetchImpl }), log = console.log, now = Date.now } = {}) {
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
  const options = { github, repo, env, fetchImpl, commentCache: new Map(), budget: { remaining: READ_BUDGET, stopped: false } };
  if (!reconcile) {
    const pr = await github(`repos/${repo}/pulls/${number}`);
    const verdict = await readVerdict(pr, options);
    log(JSON.stringify(verdict, null, 2));
    return verdict.state === 'success' ? 0 : 1;
  }

  const openPrs = await githubPages(github, `repos/${repo}/pulls?state=open&base=production`);
  // The ux-signoff status on each head is the sweep cursor: oldest-evaluated heads (no status first) spend the read budget first.
  const lastEvaluated = async (pr) => {
    const statuses = await githubPages(github, `repos/${repo}/commits/${pr.head?.sha}/statuses`).catch(() => []);
    const newestStatus = statuses.find((status) => status.context === CONTEXT);
    // A deferred placeholder means the head was never evaluated, so it keeps first place.
    const time = newestStatus?.description === DEFERRED ? NaN : Date.parse(newestStatus?.updated_at);
    return Number.isNaN(time) ? -Infinity : time;
  };
  const targets = number == null ? openPrs : openPrs.filter((pr) => pr.number === number);
  const order = await Promise.all(targets.map(async (pr) => ({ pr, time: await lastEvaluated(pr) })));
  const prs = order.sort((a, b) => (a.time === b.time ? 0 : a.time < b.time ? -1 : 1)).map(({ pr }) => pr);
  let errors = false;
  for (const listed of prs) {
    try {
      let pr = await github(`repos/${repo}/pulls/${listed.number}`);
      for (let attempt = 0; attempt < 3; attempt++) {
        if (pr.state !== 'open' || pr.base?.ref !== 'production') break;
        let verdict;
        let deferred = false;
        try {
          verdict = await readVerdict(pr, options);
        } catch (error) {
          if (error.deferred) {
            log(JSON.stringify({ pr: pr.number, state: 'deferred', description: error.message }));
            // Out of read budget: an evaluated head keeps its verdict until its turn comes, a new head gets pending.
            // Hypertask failing (429/5xx): every unread head goes pending, so a withdrawn yes never stays green.
            deferred = !options.budget.stopped;
            verdict = { state: 'pending', description: DEFERRED, details: [] };
          } else verdict = { state: 'error', description: env.MCP_TOKEN ? READ_ERROR : 'HYPERTASK_MCP_TOKEN is empty; configure it for UI signoff', details: [] };
        }
        if (!/^[a-f0-9]{40}$/.test(pr.head?.sha ?? '')) throw new Error('No PR head SHA to publish');
        const statuses = await githubPages(github, `repos/${repo}/commits/${pr.head.sha}/statuses`);
        const newestStatus = statuses.find((status) => status.context === CONTEXT);
        // Keep the head read immediately before publication, including error verdicts.
        const current = await github(`repos/${repo}/pulls/${pr.number}`);
        if (current.state !== 'open' || current.base?.ref !== 'production') break;
        if (current.head?.sha !== pr.head.sha || current.title !== pr.title || current.base?.sha !== pr.base?.sha) {
          pr = current;
          if (attempt === 2) log(JSON.stringify({ pr: pr.number, state: 'deferred', description: 'PR kept changing; left untouched this run' }));
          continue;
        }
        if (deferred && newestStatus) break;
        // Unchanged verdicts are re-posted hourly so the cursor moves while statuses per head stay bounded.
        const stale = Date.parse(newestStatus?.updated_at) < now() - HEARTBEAT_MS;
        if (stale || newestStatus?.state !== verdict.state || newestStatus?.description !== verdict.description) {
          await github(`repos/${repo}/statuses/${pr.head.sha}`, {
            method: 'POST', body: {
              context: CONTEXT, state: verdict.state, description: verdict.description,
              target_url: ticketUrl(pr.title, runUrl),
            },
          });
        }
        if (verdict.state === 'error') errors = true;
        log(JSON.stringify({ pr: pr.number, ...verdict }, null, 2));
        break;
      }
    } catch {
      errors = true;
      log(JSON.stringify({ pr: listed.number, state: 'error', description: 'Could not read or publish UX signoff status; left untouched' }));
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
