import { execFileSync } from 'node:child_process';
import { basename, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const CONTEXT = 'ux-signoff';
export const PREMERGE_CREATOR = 'hypertask-runners[bot]';
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

function tokens(line) {
  return line.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[\w$]+|[^\s\w$]/g) ?? [];
}

const NOT_FLAG_NAMES = new Set(['const', 'let', 'var', 'import', 'from', 'export', 'default', 'useFlag', 'isFeatureEnabled', 'await', 'return', 'true', 'false', 'null', 'undefined']);

function patchLines(patch, sign) {
  return (patch ?? '').split('\n').filter((line) => line.startsWith(sign) && !line.startsWith(sign.repeat(3)))
    .map((line) => new Set(tokens(line.slice(1))));
}

function flagReferences(files, keys) {
  const direct = new Set(keys.flatMap((key) => [key, `"${key}"`, `'${key}'`, `${key.toUpperCase().replaceAll('-', '_')}_FLAG`]));
  const references = new Set(direct);
  for (const { filename, patch } of files) {
    // Registry properties such as `key` are metadata, not runtime flag aliases.
    if (!filename.startsWith('src/') || filename.startsWith('src/lib/flags/definitions/') ||
      /(?:\.(?:test|spec|stories)\.|(?:^|\/)__tests__\/)/.test(filename)) continue;
    for (const line of patchLines(patch, '-')) {
      if (![...line].some((token) => direct.has(token))) continue;
      for (const token of line) if (/^[A-Za-z_$][\w$]{2,}$/.test(token) && !NOT_FLAG_NAMES.has(token)) references.add(token);
    }
  }
  return references;
}

function removalOnly(ui, files, keys) {
  const references = flagReferences(files, keys);
  const mentionsFlag = (line) => line.some((token) => references.has(token));
  const flagImport = (text) => {
    const match = /^\s*import\s+(?:\{([^{}]+)\}|([A-Za-z_$][\w$]*))\s+from\s+["'][^"']+["'];?\s*$/.exec(text);
    const names = (match?.[1] ?? match?.[2])?.split(',').map((name) => name.trim()).filter(Boolean);
    return names?.length && names.every((name) => ['useFlag', 'isFeatureEnabled'].includes(name) || references.has(name));
  };
  return ui.every(({ status, patch }) => {
    if (status !== 'modified' || typeof patch !== 'string') return false;
    if (!patchLines(patch, '-').some((line) => mentionsFlag([...line]))) return false;
    // Only old-side lines advance branch state; keep it across hunks of this file.
    const regions = [];
    const removed = [];
    const added = [];
    let depth = 0;
    let classified = true;
    for (const raw of patch.split('\n')) {
      if (!/^[ +\-]/.test(raw) || /^(?:---|\+\+\+)/.test(raw)) continue;
      const sign = raw[0];
      const text = raw.slice(1);
      const line = tokens(text);
      if (sign === '+') {
        added.push(text);
        continue;
      }
      const tracked = regions.length > 0;
      let off = regions.some((region) => region.off);
      let source = line;
      const region = regions.at(-1);
      if (region?.ternary && /^\s*\)\s*:\s*\(/.test(text) && depth === region.depth + 1) {
        if (region.other) classified = false;
        region.other = true;
        region.off = !region.negated;
        off = regions.some((item) => item.off);
      }
      if (mentionsFlag(line)) {
        const flag = line.findIndex((token) => references.has(token));
        const start = flag > 0 && line[flag - 1] === '!' ? flag - 1 : flag;
        const negated = start !== flag;
        const prefix = line.slice(0, start);
        const tail = line.slice(flag + 1);
        const simplePrefix = /^(?:return|(?:const|let|var) [\w$]+ =|\{)?$/.test(prefix.join(' '));
        if (simplePrefix && (tail[0] === '?' || (tail[0] === '&' && tail[1] === '&'))) {
          const offset = tail[0] === '?' ? 1 : 2;
          if (tail[offset] === '(' && tail.length === offset + 1) {
            if (tail[0] === '&') off ||= negated;
            regions.push({ depth, off: negated, negated, ternary: tail[0] === '?' });
          } else if (tail[0] === '?' && tail.filter((token) => token === '?').length === 1 && tail.filter((token) => token === ':').length === 1) {
            const colon = tail.indexOf(':');
            const first = tail.slice(1, colon);
            const second = tail.slice(colon + 1);
            if (second.at(-1) === ';') second.pop();
            source = [...prefix, ...(negated ? second : first), ...(line.at(-1) === ';' ? [';'] : [])];
          } else if (tail[0] === '&' && !tail.slice(offset).some((token) => ['?', '&', '|'].includes(token))) {
            off ||= negated;
            source = [...prefix, ...tail.slice(offset)];
          } else classified = false;
        } else {
          const guard = /^\s*if\s*\(\s*(!?)\s*([A-Za-z_$][\w$]*)\s*(\|\|[^()]*)?\)\s*return\b(.*)$/.exec(text);
          if (guard && references.has(guard[2]) && (!guard[3] || guard[1])) {
            if (guard[1] && !guard[3]) off = true;
            if (guard[3] && tokens(guard[4]).some((token) => token !== ';')) classified = false;
          } else if (line.some((token, index) => ['?', '&', '|', 'if'].includes(token) || (token === '=' && line[index + 1] === '>'))) classified = false;
        }
      }
      const brackets = line.length > 0 && line.every((token) => /^[(){}[\];,:]$/.test(token));
      if (sign === '-') removed.push({ text, source, off, related: mentionsFlag(line), deletable: off || (tracked && brackets), import: flagImport(text) });
      for (const token of line) {
        if (token === '(') depth++;
        if (token === ')') depth--;
      }
      if (/^\s*\)/.test(text)) while (regions.length && depth <= regions.at(-1).depth) regions.pop();
    }
    if (!classified && added.length) return false;
    const sourcedBy = (item, line) => {
      let at = 0;
      for (const token of line) {
        while (at < item.source.length) {
          const value = item.source[at];
          const negated = item.source[at - 1] === '!';
          if (value === token || (token === 'true' && references.has(value) && !negated)) break;
          if (token === 'false' && value === '!' && references.has(item.source[at + 1])) {
            at++;
            break;
          }
          at++;
        }
        if (at === item.source.length) return false;
        at++;
      }
      return item.related || line.length === item.source.length;
    };
    const candidates = removed.map((item) => item.off ? [] :
      added.flatMap((text, index) => sourcedBy(item, tokens(text)) ? [index] : []));
    const owners = new Map();
    const match = (source, seen = new Set()) => {
      for (const target of candidates[source]) {
        if (seen.has(target)) continue;
        seen.add(target);
        if (!owners.has(target) || match(owners.get(target), seen)) {
          owners.set(target, source);
          return true;
        }
      }
      return false;
    };
    for (let source = 0; source < removed.length; source++) {
      const item = removed[source];
      if (!item.related && !item.import && !item.deletable && !match(source)) return false;
    }
    for (let source = 0; source < removed.length; source++) {
      if (![...owners.values()].includes(source)) match(source);
    }
    return owners.size === added.length;
  });
}

export function evaluate({ title, author, files, comments = [], removedEveryone = [] }) {
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
  const flagRemoval = ticket.type === 'REFACTOR' && removedEveryone.length > 0 &&
    removedEveryone.every((key) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) && files.some((file) =>
      file.filename === `src/lib/flags/definitions/${key}.ts` && file.status === 'removed')) &&
    removalOnly(ui, files, removedEveryone);
  const exempt = ticket.type === 'BUGFIX' || ticket.prefix === 'YPER4';
  const details = [];
  if (!exempt && !flagRemoval && (!wireframe || !approved)) {
    details.push(`UI change needs Valentin's yes on a wireframe on ${ticket.key}`);
  }
  if (missingNames.length) {
    details.push(`New element ${missingNames.join(', ')} needs Valentin's yes by name on ${ticket.key}`);
  }
  if (details.length) return { state: 'failure', description: details[0].slice(0, 140), details };
  if (flagRemoval && !exempt) return success('Flag removal of an Everyone flag; no new UI');
  return success(exempt ? 'Wireframe exempt; new elements approved' : 'Wireframe and new elements have UX signoff');
}

export function ticketUrl(title, runUrl) {
  const ticket = ticketFromTitle(title);
  const project = { HTPR: 15, YPER4: 4060 }[ticket?.prefix];
  return project ? `https://app.hypertask.ai/detail/project-${project}/${ticket.number}` : runUrl;
}

export function createGithub({ env = process.env, fetchImpl = fetch, exec = execFileSync, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  return async (path, { method = 'GET', body } = {}) => {
    if (!env.GH_TOKEN) {
      const args = ['api', '--method', method, path];
      if (body) args.push('--input', '-');
      return JSON.parse(exec('gh', args, {
        encoding: 'utf8', input: body ? JSON.stringify(body) : undefined, timeout: 30000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }));
    }
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await fetchImpl(`https://api.github.com/${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(30000),
        });
      } catch (error) {
        if (method !== 'GET' || attempt === 2) throw error;
        await sleep(attempt === 0 ? 1000 : 3000);
        continue;
      }
      if (response.ok) return response.json();
      if (method !== 'GET' || attempt === 2 || (response.status !== 429 && response.status < 500)) {
        throw new Error(`GitHub API returned HTTP ${response.status}`);
      }
      await sleep(attempt === 0 ? 1000 : 3000);
    }
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
  const deletesDefinition = files.some((file) => file.status === 'removed' && file.filename.startsWith('src/lib/flags/definitions/'));
  const statuses = ticket.type === 'REFACTOR' && deletesDefinition
    ? await githubPages(github, `repos/${repo}/commits/${pr.head.sha}/statuses`) : [];
  const status = statuses.find((item) => item.context === 'premerge-evidence');
  const keys = status?.state === 'success' && status.creator?.login === PREMERGE_CREATOR &&
    / \| removed-everyone: ([a-z0-9]+(?:-[a-z0-9]+)*(?:,[a-z0-9]+(?:-[a-z0-9]+)*)*)$/.exec(status.description ?? '');
  input.removedEveryone = keys ? keys[1].split(',') : [];
  const removal = evaluate(input);
  if (removal.state === 'success') return removal;
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
    } catch (error) {
      errors = true;
      const reason = /^GitHub API returned (HTTP \d+|no list)$/.test(error?.message) || error?.message === 'No PR head SHA to publish'
        ? error.message : 'unexpected error';
      log(JSON.stringify({ pr: listed.number, state: 'error', description: 'Could not read or publish UX signoff status; left untouched', reason }));
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
