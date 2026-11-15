'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveAuthorFamily, planReadiness, familiesToTry } = require('./verdict.cjs');
const { parentUrl } = require('./preview.cjs');
const { surfaceOf } = require('./routes.cjs');
const { ghJson, flattenPages } = require('./gh.cjs');

function output(pairs) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const lines = Object.entries(pairs).map(([key, value]) => `${key}=${value}`).join('\n');
  fs.appendFileSync(file, `${lines}\n`);
}

function readPull(repo, number) {
  const pr = ghJson(['api', `repos/${repo}/pulls/${number}`]);
  const commits = flattenPages(ghJson(['api', '--paginate', '--slurp', `repos/${repo}/pulls/${number}/commits?per_page=100`]));
  const files = flattenPages(ghJson(['api', '--paginate', '--slurp', `repos/${repo}/pulls/${number}/files?per_page=100`]));
  return { pr, commits, files };
}

function finish(plan, blocked, post) {
  plan.blocked = blocked;
  plan.post = post;
  plan.go = post;
  return plan;
}

function buildPlan({ repo, number, eventSha = '', eventName = '', manualFamily = '', deepseekReady, claudeReady, read = readPull }) {
  const plan = {
    repo, number, go: false, post: false, sha: '', blocked: '', surface: 'check', kind: 'check', checkout: 'no',
    tryFamilies: [], authorFamily: 'unknown', authorSource: 'none', families: [], paths: [], commands: [],
    parentUrl: null, baseRef: '',
  };
  let loaded;
  try {
    loaded = read(repo, number);
  } catch {
    return finish(plan, 'unreadable', true);
  }
  const { pr, commits, files } = loaded;
  const sha = String(pr?.head?.sha ?? '');
  plan.sha = /^[0-9a-f]{40}$/.test(sha) ? sha : '';
  plan.baseRef = String(pr?.base?.ref ?? '');
  plan.paths = (files ?? []).map(file => file.filename).filter(name => typeof name === 'string');
  plan.parentUrl = parentUrl(plan.baseRef);
  const sameRepo = pr?.head?.repo?.full_name === repo && pr?.base?.repo?.full_name === repo;
  if (!sameRepo) return finish(plan, 'fork', true);
  if (pr.draft || pr.state !== 'open') return finish(plan, pr.draft ? 'draft' : 'closed', false);
  if (eventSha && plan.sha && eventSha !== plan.sha) return finish(plan, 'stale', false);
  if (plan.baseRef !== 'production' || !plan.sha) return finish(plan, 'base', true);
  const author = resolveAuthorFamily({
    messages: (commits ?? []).map(commit => commit?.commit?.message ?? ''),
    manual: manualFamily,
    eventName,
  });
  plan.families = author.families;
  plan.authorSource = author.source;
  plan.authorFamily = author.known ? author.families.join('+') : 'unknown';
  if (!author.known) return finish(plan, 'author', true);
  plan.tryFamilies = familiesToTry({
    known: true,
    families: author.families,
    ready: planReadiness({ deepseek: deepseekReady, claude: claudeReady }),
  });
  if (!plan.tryFamilies.length) return finish(plan, 'plan', true);
  plan.surface = surfaceOf(plan.paths);
  plan.kind = plan.surface === 'app' ? 'app' : 'check';
  plan.checkout = 'no';
  plan.blocked = '';
  plan.post = true;
  plan.go = true;
  return plan;
}

function main() {
  const repo = process.env.REPO || '';
  const number = Number(process.env.PR_INPUT);
  const planPath = process.env.PSTACK_PLAN;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !Number.isInteger(number) || number < 1 || !planPath) {
    console.error('pstack-verifier: REPO, PR_INPUT and PSTACK_PLAN are required');
    process.exit(64);
  }
  const plan = buildPlan({
    repo,
    number,
    eventSha: process.env.EVENT_SHA || '',
    eventName: process.env.EVENT_NAME || '',
    manualFamily: process.env.AUTHOR_FAMILY || '',
    deepseekReady: process.env.DEEPSEEK_READY,
    claudeReady: process.env.CLAUDE_READY,
  });
  fs.mkdirSync(path.dirname(planPath), { recursive: true });
  fs.writeFileSync(planPath, JSON.stringify(plan), { mode: 0o600 });
  output({ go: plan.go ? 'yes' : 'no', sha: plan.sha, surface: plan.surface, kind: plan.kind, try: plan.tryFamilies.join(',') });
  console.log(`pstack-verifier prepare: PR #${number} ${plan.sha.slice(0, 7)} go=${plan.go} ${plan.blocked || plan.kind} try=${plan.tryFamilies.join(',') || 'none'}`);
}

module.exports = { buildPlan };

if (require.main === module) main();
