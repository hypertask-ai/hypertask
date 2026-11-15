'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  authorFamilyFromMessages,
  planReadiness,
  familiesToTry,
  surfaceOf,
  checkPlan,
  flattenPages,
  parentUrl,
} = require('./verdict.cjs');
const { ghJson } = require('./gh.cjs');

function output(pairs) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const lines = Object.entries(pairs).map(([key, value]) => `${key}=${value}`).join('\n');
  fs.appendFileSync(file, `${lines}\n`);
}

function pages(repo, apiPath) {
  return flattenPages(ghJson(['api', '--paginate', '--slurp', `repos/${repo}/${apiPath}`]));
}

function readPull(repo, number) {
  const pr = ghJson(['api', `repos/${repo}/pulls/${number}`]);
  const commits = pages(repo, `pulls/${number}/commits?per_page=100`);
  const files = pages(repo, `pulls/${number}/files?per_page=100`);
  return { pr, commits, files };
}

function buildPlan({ repo, number, eventSha, claudeReady, deepseekReady, read = readPull }) {
  const plan = {
    repo,
    number,
    go: false,
    post: false,
    sha: '',
    blocked: '',
    surface: 'check',
    kind: 'unrun',
    checkout: 'no',
    tryFamilies: [],
    authorFamily: 'unknown',
    families: [],
    paths: [],
    commands: [],
    parentUrl: null,
    baseRef: '',
  };
  let loaded;
  try {
    loaded = read(repo, number);
  } catch {
    plan.blocked = 'unreadable';
    plan.post = true;
    plan.go = true;
    return plan;
  }
  const { pr, commits, files } = loaded;
  const sha = String(pr?.head?.sha ?? '');
  plan.sha = /^[0-9a-f]{40}$/.test(sha) ? sha : '';
  plan.baseRef = String(pr?.base?.ref ?? '');
  plan.paths = (files ?? []).map(file => file.filename).filter(name => typeof name === 'string');
  plan.parentUrl = parentUrl(plan.baseRef);
  const sameRepo = pr?.head?.repo?.full_name === repo && pr?.base?.repo?.full_name === repo;
  if (!sameRepo) {
    plan.blocked = 'fork';
    plan.post = true;
    plan.go = true;
    return plan;
  }
  if (pr.draft || pr.state !== 'open') {
    plan.blocked = pr.draft ? 'draft' : 'closed';
    return plan;
  }
  if (eventSha && plan.sha && eventSha !== plan.sha) {
    plan.blocked = 'stale';
    return plan;
  }
  if (plan.baseRef !== 'production' || !plan.sha) {
    plan.blocked = 'base';
    plan.post = true;
    plan.go = true;
    return plan;
  }
  const author = authorFamilyFromMessages((commits ?? []).map(commit => commit?.commit?.message ?? ''));
  plan.families = author.families;
  plan.authorFamily = author.known ? author.families.join('+') : 'unknown';
  if (!author.known) {
    plan.blocked = 'author';
    plan.post = true;
    plan.go = true;
    return plan;
  }
  const ready = planReadiness({ claude: claudeReady, deepseek: deepseekReady });
  plan.tryFamilies = familiesToTry({ known: true, families: author.families, ready });
  if (!plan.tryFamilies.length) {
    plan.blocked = 'plan';
    plan.post = true;
    plan.go = true;
    return plan;
  }
  plan.surface = surfaceOf(plan.paths);
  const check = checkPlan(plan.paths);
  plan.kind = plan.surface === 'app' ? 'app' : check.kind;
  plan.commands = plan.surface === 'app' ? [] : check.commands;
  plan.checkout = plan.surface === 'check' && (check.kind === 'test' || check.kind === 'syntax') ? 'yes' : 'no';
  plan.post = true;
  plan.go = true;
  plan.blocked = '';
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
    claudeReady: process.env.CLAUDE_READY,
    deepseekReady: process.env.DEEPSEEK_READY,
  });
  fs.mkdirSync(path.dirname(planPath), { recursive: true });
  fs.writeFileSync(planPath, JSON.stringify(plan), { mode: 0o600 });
  output({
    go: plan.go ? 'yes' : 'no',
    sha: plan.sha,
    surface: plan.surface,
    kind: plan.kind,
    checkout: plan.checkout,
    try: plan.tryFamilies.join(','),
  });
  console.log(`pstack-verifier prepare: PR #${number} ${plan.sha.slice(0, 7)} go=${plan.go} ${plan.blocked || plan.kind} try=${plan.tryFamilies.join(',') || 'none'}`);
}

module.exports = { buildPlan, pages };

if (require.main === module) main();
