import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const sha = /^[a-f0-9]{40}$/;
const infrastructure = /(?:HTTP (?:429|503)|rate limit exceeded|API rate limit|testTimeoutFailure|ERR_TEST_TIMEOUT|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|service unavailable)/i;
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const api = route => JSON.parse(execFileSync('gh', ['api', route], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
const infraFailure = output => infrastructure.test(output.split('\n').filter(line => !/(?:[✔✓✖]|(?:^|\s)(?:not )?ok \d+|# Subtest:)/.test(line)).join('\n'));

export function testFiles(jobs, logs) {
  if (infraFailure(logs)) return [];
  const known = {
    'Source-text regex gate': 'tests/source-text-regex-lint.test.cjs',
    'Settings Ctrl+K coverage': 'tests/settings-cmdk-coverage.test.cjs',
    'Guard CI image sources': 'tests/ci-image-sources.test.cjs',
  };
  const failed = jobs.flatMap(j => j.steps || []).filter(s => s.conclusion === 'failure');
  if (!failed.length || failed.some(s => !known[s.name] && s.name !== 'Test shard' && s.name !== 'Publish ci-tests result')) return [];
  const files = failed.flatMap(s => known[s.name] || []);
  files.push(...[...logs.matchAll(/(?:test at |location:\s*['"]?(?:[^\n]*?\/)?)(tests\/[\w./-]+\.test\.[cm]?[jt]s)(?::\d+)/g)].map(m => m[1]));
  return [...new Set(files)].sort();
}

export function findRegression({ cwd, good, bad, head, files, probe }) {
  if (![good, bad, head].every(s => sha.test(s)) || !files.length || files.some(f => !/^tests\/[\w./-]+\.test\.[cm]?[jt]s$/.test(f) || f.split('/').includes('..'))) return null;
  git(cwd, 'merge-base', '--is-ancestor', good, bad);
  git(cwd, 'merge-base', '--is-ancestor', bad, head);
  const commits = git(cwd, 'rev-list', '--first-parent', '--reverse', `${good}..${bad}`).split('\n').filter(Boolean);
  if (!commits.length || commits.length > 50) return null;
  const lock = git(cwd, 'rev-parse', `${head}:package-lock.json`);
  if ([good, ...commits, git(cwd, 'rev-parse', 'HEAD')].some(s => git(cwd, 'rev-parse', `${s}:package-lock.json`) !== lock)) return null;
  const scratch = mkdtempSync(join(tmpdir(), 'production-revert-'));
  const tree = join(scratch, 'tree');
  const env = { PATH: process.env.PATH, HOME: scratch, TMPDIR: scratch, CI: 'true', SOURCE_TEXT_ALLOWLIST_BASE: good };
  try {
    git(cwd, 'worktree', 'add', '--detach', tree, good);
    const docker = ['run', '--rm', '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128', '--memory=2g', '--cpus=2', '--user', `${process.getuid()}:${process.getgid()}`, '--tmpfs', '/tmp'];
    const mounts = [...new Set(['/usr', '/bin', '/lib', '/lib64', process.execPath, resolve(cwd, git(cwd, 'rev-parse', '--git-common-dir')), join(cwd, 'node_modules')])].filter(p => existsSync(p));
    for (const p of mounts) docker.push('--mount', `type=bind,src=${p},dst=${p},readonly`);
    docker.push('--mount', `type=bind,src=${scratch},dst=${scratch}`, '--workdir', tree);
    for (const [key, value] of Object.entries(env)) docker.push('--env', `${key}=${value}`);
    docker.push(process.env.PROBE_IMAGE || 'production-revert-sandbox', process.execPath, '--test', ...files);
    const check = () => {
      const results = [0, 1].map(() => {
        const command = process.env.PROBE_IMAGE ? 'docker' : process.execPath;
        const args = process.env.PROBE_IMAGE ? docker : ['--test', ...files];
        const r = probe ? probe(tree, files) : spawnSync(command, args, { cwd: tree, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
        if (r.error || r.signal || infraFailure(`${r.stdout || ''}\n${r.stderr || ''}`) || r.status === 125 || r.status === 137) return null;
        return r.status === 0;
      });
      if (results[0] === null || results[0] !== results[1]) throw new Error('Unstable or infrastructure failure; no revert');
      return results[0];
    };
    const checkout = s => {
      git(tree, 'checkout', '--detach', s);
      const modules = join(tree, 'node_modules');
      if (!existsSync(modules) && existsSync(join(cwd, 'node_modules'))) symlinkSync(join(cwd, 'node_modules'), modules, 'dir');
    };
    checkout(good);
    if (!check()) return null;
    checkout(bad);
    if (check()) return null;
    let left = 0, right = commits.length - 1;
    while (left < right) {
      const middle = Math.floor((left + right) / 2);
      checkout(commits[middle]);
      if (check()) left = middle + 1; else right = middle;
    }
    const culprit = commits[left];
    checkout(git(cwd, 'rev-parse', `${culprit}^1`));
    if (!check()) return null;
    checkout(culprit);
    if (check()) return null;
    checkout(head);
    if (check()) return null;
    git(tree, 'revert', '--no-commit', '-m', '1', culprit);
    if (!check()) return null;
    return { culprit, head, files };
  } finally {
    try { git(cwd, 'worktree', 'remove', '--force', tree); } finally { rmSync(scratch, { recursive: true, force: true }); }
  }
}

async function main() {
  const cwd = resolve('.'), repo = process.env.GITHUB_REPOSITORY;
  if (repo !== 'hypertask-ai/hypertask') throw new Error('Unexpected repository');
  if (process.argv[2] === 'publish') {
    const { CULPRIT: culprit, VALIDATED_HEAD: head } = process.env;
    if (![culprit, head].every(s => sha.test(s || ''))) throw new Error('Invalid replay output');
    git(cwd, 'fetch', 'origin', 'production');
    if (git(cwd, 'rev-parse', 'origin/production') !== head) throw new Error('Production moved; replay again');
    git(cwd, 'checkout', '--detach', head);
    git(cwd, 'merge-base', '--is-ancestor', culprit, head);
    const branch = `auto-revert/${culprit}`;
    const prs = api(`repos/${repo}/pulls?state=all&head=hypertask-ai:${branch}`);
    if (prs.length) { console.log(`Already proposed: ${prs[0].html_url}`); return; }
    git(cwd, 'revert', '--no-commit', '-m', '1', culprit);
    git(cwd, 'config', 'user.name', 'hypertask-agents[bot]');
    git(cwd, 'config', 'user.email', 'hypertask-agents[bot]@users.noreply.github.com');
    const original = git(cwd, 'show', '-s', '--format=%s', culprit).replace(/ \(#\d+\)$/, '');
    const title = `Revert "${original}"`;
    const existing = git(cwd, 'ls-remote', 'origin', `refs/heads/${branch}`).split(/\s/)[0];
    if (existing) {
      git(cwd, 'fetch', 'origin', branch);
      if (git(cwd, 'rev-parse', `${existing}^`) !== head || git(cwd, 'rev-parse', `${existing}^{tree}`) !== git(cwd, 'write-tree')) throw new Error('Existing proposal differs from replay; owner must reconcile');
    } else {
      git(cwd, 'commit', '-m', title, '-m', `This reverts commit ${culprit}.`);
      git(cwd, 'push', 'origin', `HEAD:refs/heads/${branch}`);
    }
    execFileSync('gh', ['pr', 'create', '--repo', repo, '--base', 'production', '--head', branch, '--title', title, '--body', `Summary for non-engineers\n\nA production check repeatedly failed. Its parent passed, and this revert passed the same check twice.\n\nCulprit: ${culprit}\nValidated production: ${head}\nEvidence: ${process.env.EVIDENCE_URL}\n\nProduction was not changed. Auto-merge remains off. Required CI and review must pass before an owner merges.`], { stdio: 'inherit' });
    return;
  }
  if (process.env.PROBE_IMAGE !== 'production-revert-sandbox') throw new Error('Isolated replay image required');
  if (!/^\d+$/.test(process.env.FAILED_RUN_ID || '')) throw new Error('Invalid failed run ID');
  const run = api(`repos/${repo}/actions/runs/${process.env.FAILED_RUN_ID}`);
  if (run.name !== 'CI Tests' || run.event !== 'push' || run.head_branch !== 'production' || run.conclusion !== 'failure' || run.head_repository?.full_name !== repo) return;
  const jobs = api(`repos/${repo}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`).jobs;
  if (!Array.isArray(jobs) || jobs.length === 100) throw new Error('Incomplete job inventory');
  const logs = jobs.filter(j => j.conclusion === 'failure').map(j => execFileSync('gh', ['api', '--allow-escape-sequences', `repos/${repo}/actions/jobs/${j.id}/logs`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })).join('\n');
  const files = testFiles(jobs, logs);
  if (!files.length) { console.log('No supported deterministic failure'); return; }
  const runs = api(`repos/${repo}/actions/workflows/ci-tests.yml/runs?branch=production&event=push&status=success&created=%3C${run.created_at}&per_page=100`).workflow_runs;
  const good = runs.find(r => r.event === 'push' && r.head_branch === 'production' && r.conclusion === 'success');
  if (!good) throw new Error('No last green production run');
  const head = process.env.GITHUB_EVENT_NAME === 'workflow_run' ? git(cwd, 'rev-parse', 'origin/production') : run.head_sha;
  const result = findRegression({ cwd, good: good.head_sha, bad: run.head_sha, head, files });
  if (process.env.GITHUB_EVENT_NAME === 'pull_request' && result?.culprit !== '73cc4b70870fb411935a3a169779a8fb8b49f168') throw new Error('Historical incident replay did not identify PR #2129');
  console.log(JSON.stringify(result));
  if (result && process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `culprit=${result.culprit}\nhead=${result.head}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exitCode = 1; });
