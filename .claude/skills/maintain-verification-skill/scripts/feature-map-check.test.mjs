import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync, chmodSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mapPath, repoPaths, apiRoutes, routePatterns, routeExists, checkFeatureMap, formatProblems } from './feature-map-check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const checker = path.join(here, 'feature-map-check.mjs');
const runner = path.join(here, 'maintain-verification-weekly');
const opsPath = '.claude/skills/verify-qa/reference/ops-map';

function fixture(t, count = 1) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'feature-map-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const repo = path.join(directory, 'repo');
  mkdirSync(repo);
  const put = (file, text = '') => {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), text);
  };
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { env: { ...process.env, HOME: directory, GIT_CONFIG_GLOBAL: path.join(directory, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  git('init', '-b', 'production');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Offline fixture');
  const pages = Array.from({ length: count }, (_, index) => `area-${String(index).padStart(2, '0')}.md`);
  put(`${mapPath}/INDEX.md`, '| Area | File |\n|---|---|\n' + pages.map(page => `| ${page} | [${page}](${page}) |`).join('\n') + '\n');
  for (const page of pages) put(`${mapPath}/${page}`, '# Area\n\n`src/shared.ts`\n\n## How to drive it\nOpen area, reload and collect proof.\n');
  put(`${opsPath}/INDEX.md`, '# Ops map\n');
  put('src/shared.ts', 'export const fixture = true;\n');
  git('add', '.');
  git('commit', '-m', 'fixture');
  git('remote', 'add', 'origin', repo);
  git('fetch', 'origin', 'production');
  return { directory, repo, put, git, pages };
}

function executable(file, source) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '#!/usr/bin/env node\n' + source);
  chmodSync(file, 0o755);
}

function weeklyFixture(t, count = 1) {
  const f = fixture(t, count);
  const home = path.join(f.directory, 'home');
  const bin = path.join(home, '.local/bin');
  const state = path.join(home, '.local/state/maintain-verification');
  const load = path.join(home, '.local/state/vps-load/status');
  mkdirSync(path.dirname(load), { recursive: true });
  writeFileSync(load, 'add load5=0.1 cores=18\n');
  mkdirSync(bin, { recursive: true });
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, FIXTURE_HOME: home };
  delete env.GITHUB_STEP_SUMMARY;
  executable(path.join(home, 'projects/token-ladder/bin/token-ladder'), `
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FIXTURE_HOME + '/ladder-calls', JSON.stringify(args) + '\\n');
if (args.join(' ') !== 'pick --role runner --harness hax --json') process.exit(9);
if (process.env.LADDER_FAIL) process.exit(1);
if (process.env.LADDER_INVALID) { console.log('{}'); process.exit(0); }
const allowed = !process.env.LADDER_REFUSE;
console.log(JSON.stringify({ role: 'runner', harness: 'hax', allowed, pool: allowed ? 'codex' : null }));
process.exit(allowed ? 0 : 3);
`);
  executable(path.join(bin, 'hax'), `
const fs = require('node:fs');
const path = require('node:path');
const home = process.env.FIXTURE_HOME;
const args = process.argv.slice(2);
const prompt = args.at(-1);
const page = prompt.match(/feature-map\\/(area-\\d+\\.md)/)?.[1];
if (!page || !prompt.startsWith('Token ladder: CODEX mode.') || !prompt.includes('Use the unlazy skill') || !prompt.includes('Only read source.') || !args.includes('--provider=codex') || !args.includes('--no-session')) process.exit(9);
fs.appendFileSync(path.join(home, 'helpers'), page + '\\n');
fs.appendFileSync(path.join(home, 'events'), 'start ' + page + '\\n');
const attemptFile = path.join(home, page + '.attempts');
const attempts = fs.existsSync(attemptFile) ? Number(fs.readFileSync(attemptFile)) : 0;
fs.writeFileSync(attemptFile, String(attempts + 1));
console.error('stderr must be discarded');
setTimeout(() => {
  fs.appendFileSync(path.join(home, 'events'), 'end ' + page + '\\n');
  if (process.env.HELPER_FAIL === 'always' || (process.env.HELPER_FAIL === 'once' && attempts === 0)) process.exit(1);
  if (process.env.HELPER_FAIL === 'malformed') { console.log('{}'); return; }
  console.log(JSON.stringify({ summary: 'Feature <summary>', entryPoints: ['src/shared.ts:1'], drift: process.env.HELPER_DRIFT ? ['Changed source src/shared.ts:1 & map:1'] : 'none', liveRecipe: 'Doctor; open area & reload; cleanup.' }));
}, 25);
`);
  executable(path.join(bin, 'vcc'), `
const fs = require('node:fs');
if (process.env.SHIP_SESSION_NAME !== 'RUNNER 8') process.exit(9);
fs.appendFileSync(process.env.FIXTURE_HOME + '/vcc-calls', JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.env.VCC_FAIL) process.exit(1);
`);
  const run = (...args) => spawnSync('bash', [runner, '--repo', f.repo, ...args], { env, encoding: 'utf8', timeout: 20000 });
  const runs = () => readdirSync(state).filter(name => /^\d{4}-W\d{2}\./.test(name)).sort().map(name => path.join(state, name));
  return { ...f, home, bin, state, load, env, run, runs };
}

function ok(result) {
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stderr, /stderr must be discarded/);
}

test('checker exports return concrete success and failure values', t => {
  const f = fixture(t);
  assert.deepEqual(checkFeatureMap(f.repo), []);
  assert.equal(formatProblems([]), '- Feature map check: clean\n');
  f.put(`${mapPath}/area-00.md`, '`docs/gone.md:12#anchor`.');
  assert.deepEqual(checkFeatureMap(f.repo), [{ page: 'area-00.md', kind: 'missing path', value: 'docs/gone.md' }]);
  assert.equal(formatProblems(checkFeatureMap(f.repo)), '- area-00.md: missing path: docs/gone.md\n');
});

test('index requires table coverage, existing siblings and unique entries and rows', t => {
  const f = fixture(t, 2);
  f.put(`${mapPath}/INDEX.md`, '[area-01.md](area-01.md) outside the table\n| A | [a](area-00.md) |\n| B | [b](area-00.md) |\n| Missing | [missing](gone.md) |\n| Missing | [missing](gone.md) |\n');
  const problems = checkFeatureMap(f.repo);
  assert.ok(problems.some(value => value.kind === 'unindexed page' && value.value === 'area-01.md'));
  assert.ok(problems.some(value => value.kind === 'missing file' && value.value === 'gone.md'));
  assert.ok(problems.some(value => value.kind === 'duplicate entry' && value.value === 'area-00.md'));
  assert.ok(problems.some(value => value.kind === 'duplicate row'));
  rmSync(path.join(f.repo, mapPath, 'INDEX.md'));
  assert.ok(checkFeatureMap(f.repo).some(value => value.kind === 'missing index'));
  rmSync(path.join(f.repo, mapPath), { recursive: true });
  assert.deepEqual(checkFeatureMap(f.repo), [{ page: 'INDEX.md', kind: 'missing directory', value: mapPath }]);
});

test('ops map receives the same index, path and route checks as customer recipes', t => {
  const f = fixture(t);
  f.put(`${opsPath}/INDEX.md`, '| Area | File |\n|---|---|\n| Build | [build](build.md) |\n');
  f.put(`${opsPath}/build.md`, '`src/shared.ts`');
  assert.deepEqual(checkFeatureMap(f.repo), []);
  f.put(`${opsPath}/build.md`, '`src/missing.ts` POST /api/missing');
  assert.deepEqual(checkFeatureMap(f.repo), [
    { page: '../ops-map/build.md', kind: 'missing path', value: 'src/missing.ts' },
    { page: '../ops-map/build.md', kind: 'missing API route', value: '/api/missing' },
  ]);
  f.put(`${opsPath}/build.md`, '`src/shared.ts`');
  f.put(`${opsPath}/unlisted.md`, '# Unlisted');
  assert.ok(checkFeatureMap(f.repo).some(value => value.page === '../ops-map/INDEX.md' && value.kind === 'unindexed page' && value.value === 'unlisted.md'));
  rmSync(path.join(f.repo, opsPath, 'unlisted.md'));
  rmSync(path.join(f.repo, opsPath, 'build.md'));
  assert.ok(checkFeatureMap(f.repo).some(value => value.page === '../ops-map/INDEX.md' && value.kind === 'missing file' && value.value === 'build.md'));
  rmSync(path.join(f.repo, opsPath, 'INDEX.md'));
  assert.ok(checkFeatureMap(f.repo).some(value => value.kind === 'missing index' && value.page === '../ops-map/INDEX.md'));
  rmSync(path.join(f.repo, opsPath), { recursive: true });
  assert.ok(checkFeatureMap(f.repo).some(value => value.kind === 'missing directory' && value.value === opsPath));
});

test('CLI fails for ops drift and weekly reports its moved recipe', t => {
  const f = weeklyFixture(t);
  f.put(`${opsPath}/INDEX.md`, '| Area | File |\n|---|---|\n| Build | [build](build.md) |\n');
  f.put(`${opsPath}/build.md`, '`docs/removed.md`\n\n## How to drive it\nRead the hosted build log.\n');
  const result = spawnSync(process.execPath, [checker, f.repo], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /ops-map\/build.md: missing path: docs\/removed.md/);
  f.git('add', '.'); f.git('commit', '-m', 'ops citation drift');
  ok(f.run('--dry-run'));
  const report = readFileSync(path.join(f.runs()[0], 'description.html'), 'utf8');
  assert.match(report, /ops-map\/build.md:1: missing path: docs\/removed.md/);
  assert.match(report, /Read the hosted build log/);
  rmSync(path.join(f.repo, opsPath, 'INDEX.md'));
  f.git('add', '.'); f.git('commit', '-m', 'missing ops index');
  ok(f.run('--dry-run'));
  const missingIndexReport = readFileSync(path.join(f.runs().at(-1), 'description.html'), 'utf8');
  assert.match(missingIndexReport, /ops-map\/INDEX.md:1: missing index/);
});

test('repo paths strip citations, punctuation, commands and anchors; ignore globs, placeholders and explicit external-repo scopes', t => {
  const f = fixture(t);
  const markdown = '`src/shared.ts:1#anchor`, `e2e/smoke/`. `.claude/tool run args` `docs/a.md:2:3-8`; `scripts/*.sh` `public/<name>.png` `prisma/{a,b}` `src/x?.ts` (installers live in the `other/project` repo, `public/install.sh`). `src/a.ts src/b.ts`';
  assert.deepEqual(repoPaths(markdown), ['.claude/tool', 'docs/a.md', 'e2e/smoke', 'src/a.ts', 'src/b.ts', 'src/shared.ts']);
  for (const name of repoPaths(markdown)) f.put(name);
  f.put(`${mapPath}/area-00.md`, markdown);
  assert.deepEqual(checkFeatureMap(f.repo), []);
  f.put(`${mapPath}/area-00.md`, '`src/missing.ts`');
  assert.deepEqual(checkFeatureMap(f.repo).map(value => value.value), ['src/missing.ts']);
});

test('API extraction covers backticks and HTTP prose, strips queries and ignores negated endpoints', () => {
  assert.deepEqual(apiRoutes('`GET /api/a?x=<id>` POST /api/b. `fetch("/api/c")` not `/api/nope`; never use `/api/old`. `/api/d#anchor` PUT /api/e PATCH /api/f DELETE /api/g'), ['/api/a', '/api/b', '/api/c', '/api/d', '/api/e', '/api/f', '/api/g']);
});

test('API resolution covers Pages files/index/dynamics, App route groups/dynamics and catchalls', t => {
  const f = fixture(t);
  for (const file of ['src/pages/api/plain.ts', 'src/pages/api/nested/index.ts', 'src/pages/api/items/[id].ts', 'src/pages/api/many/[...parts].ts', 'src/app/api/(group)/app/[id]/route.ts', 'src/app/api/maybe/[[...rest]]/route.ts']) f.put(file);
  const patterns = routePatterns(f.repo);
  assert.ok(Array.isArray(patterns) && patterns.length === 6);
  for (const route of ['/api/plain', '/api/nested', '/api/items/123', '/api/items/<id>', '/api/many/a/b', '/api/app/<publicId>', '/api/maybe', '/api/maybe/a/b']) assert.equal(routeExists(route, patterns), true, route);
  for (const route of ['/api/missing', '/api/many', '/api/plain/extra', '/api/app']) assert.equal(routeExists(route, patterns), false, route);
  f.put(`${mapPath}/area-00.md`, '`/api/plain` GET /api/nested\n`/api/app/42?read=true`\nPOST /api/missing');
  assert.deepEqual(checkFeatureMap(f.repo), [{ page: 'area-00.md', kind: 'missing API route', value: '/api/missing' }]);
});

test('CLI exits 0/1 and appends identical Markdown to the Actions summary', t => {
  const f = fixture(t);
  const summary = path.join(f.directory, 'summary');
  const run = () => spawnSync(process.execPath, [checker], { cwd: f.repo, env: { ...process.env, GITHUB_STEP_SUMMARY: summary }, encoding: 'utf8' });
  const clean = run();
  assert.equal(clean.status, 0);
  f.put(`${mapPath}/area-00.md`, '`/api/gone`');
  const stale = run();
  assert.equal(stale.status, 1);
  assert.equal(stale.stdout, '- area-00.md: missing API route: /api/gone\n');
  assert.equal(readFileSync(summary, 'utf8'), clean.stdout + stale.stdout);
});

test('weekly uses machine-readable Codex admission, not the human hook wording', t => {
  const f = weeklyFixture(t);
  ok(f.run('--dry-run'));
  assert.deepEqual(JSON.parse(readFileSync(path.join(f.home, 'ladder-calls'), 'utf8').trim()), ['pick', '--role', 'runner', '--harness', 'hax', '--json']);
  assert.equal(readFileSync(path.join(f.home, 'helpers'), 'utf8').trim(), 'area-00.md');
  assert.deepEqual(JSON.parse(readFileSync(path.join(f.state, 'pending.json'))), []);
  assert.equal(existsSync(path.join(f.home, 'vcc-calls')), false);
});

for (const mode of ['REFUSE', 'FAIL', 'INVALID']) {
  test(`weekly admission ${mode} preserves pending pages without helpers or filing`, t => {
    const f = weeklyFixture(t);
    f.env['LADDER_' + mode] = 'yes';
    mkdirSync(f.state, { recursive: true });
    writeFileSync(path.join(f.state, 'pending.json'), JSON.stringify(['area-00.md']));
    const result = f.run();
    if (mode === 'REFUSE') ok(result);
    else assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.equal(existsSync(path.join(f.home, 'helpers')), false);
    assert.equal(existsSync(path.join(f.home, 'vcc-calls')), false);
    assert.equal(existsSync(path.join(f.state, 'last-run-sha')), false);
    assert.deepEqual(JSON.parse(readFileSync(path.join(f.state, 'pending.json'))), ['area-00.md']);
    delete f.env['LADDER_' + mode];
    ok(f.run());
    assert.equal(readFileSync(path.join(f.home, 'helpers'), 'utf8').trim(), 'area-00.md');
  });
}

test('weekly first run caps eight helpers, max two concurrent, and drains backlog on next run', t => {
  const f = weeklyFixture(t, 11);
  const firstResult = f.run();
  ok(firstResult);
  for (const page of f.pages.slice(8)) assert.ok(firstResult.stdout.includes(`skipped to next run: ${page}`));
  const first = readFileSync(path.join(f.home, 'helpers'), 'utf8').trim().split('\n');
  assert.equal(first.length, 8);
  assert.equal(JSON.parse(readFileSync(path.join(f.state, 'pending.json'))).length, 3);
  const initialRun = f.runs()[0];
  assert.equal(JSON.parse(readFileSync(path.join(initialRun, 'plan.json'))).skipped.length, 3);
  assert.ok(existsSync(path.join(f.state, 'last-run-sha')));
  assert.equal(existsSync(path.join(f.home, 'vcc-calls')), false);
  ok(f.run());
  assert.equal(readFileSync(path.join(f.home, 'helpers'), 'utf8').trim().split('\n').length, 11);
  assert.deepEqual(JSON.parse(readFileSync(path.join(f.state, 'pending.json'))), []);
  let active = 0;
  let maximum = 0;
  for (const event of readFileSync(path.join(f.home, 'events'), 'utf8').trim().split('\n')) {
    active += event.startsWith('start ') ? 1 : -1;
    maximum = Math.max(maximum, active);
    assert.ok(active >= 0 && active <= 2);
  }
  assert.equal(active, 0);
  assert.equal(maximum, 2);
  const before = readFileSync(path.join(f.home, 'helpers'), 'utf8');
  ok(f.run());
  assert.equal(readFileSync(path.join(f.home, 'helpers'), 'utf8'), before);
  for (const run of f.runs()) assert.equal(existsSync(path.join(run, 'checkout')), false);
});

test('load hold fetches but starts no helpers or tickets and leaves checkpoint unchanged', t => {
  const f = weeklyFixture(t);
  writeFileSync(f.load, 'hold load5=25 cores=18\n');
  ok(f.run());
  assert.equal(existsSync(path.join(f.home, 'helpers')), false);
  assert.equal(existsSync(path.join(f.state, 'last-run-sha')), false);
  assert.equal(existsSync(path.join(f.home, 'vcc-calls')), false);
});

test('incremental planning uses cited paths including directories and notices page edits', t => {
  const f = weeklyFixture(t, 3);
  f.put(`${mapPath}/area-01.md`, '`src/other.ts`');
  f.put('src/other.ts');
  f.put(`${mapPath}/area-02.md`, '`src/folder/`');
  f.put('src/folder/a.ts');
  f.git('add', '.'); f.git('commit', '-m', 'separate entry points');
  ok(f.run());
  rmSync(path.join(f.home, 'helpers'));
  f.put('src/shared.ts', 'changed');
  f.put('src/folder/a.ts', 'changed');
  f.git('add', '.'); f.git('commit', '-m', 'source churn');
  ok(f.run());
  assert.deepEqual(readFileSync(path.join(f.home, 'helpers'), 'utf8').trim().split('\n').sort(), ['area-00.md', 'area-02.md']);
  rmSync(path.join(f.home, 'helpers'));
  f.put(`${mapPath}/area-01.md`, '`src/other.ts`\nNew instructions');
  f.git('add', '.'); f.git('commit', '-m', 'page churn');
  ok(f.run());
  assert.equal(readFileSync(path.join(f.home, 'helpers'), 'utf8').trim(), 'area-01.md');
});

test('dry-run stores escaped recipes and checker issues without vcc or weekly marker; forced pages are validated', t => {
  const f = weeklyFixture(t, 2);
  f.env.HELPER_DRIFT = 'yes';
  f.put(`${mapPath}/area-00.md`, '`docs/gone.md`\n## How to drive it\nOpen & reload.');
  f.git('add', '.'); f.git('commit', '-m', 'checker drift');
  const result = f.run('--dry-run', '--pages', 'area-00.md');
  ok(result);
  assert.match(result.stdout, /dry-run description:/);
  const description = readFileSync(path.join(f.runs()[0], 'description.html'), 'utf8');
  assert.match(description, /src\/shared.ts:1 &amp; map:1/);
  assert.match(description, /Live recipe/);
  assert.match(description, /missing path: docs\/gone.md/);
  assert.match(description, /area-01.md/);
  assert.match(description, /with \/ship/);
  assert.equal(existsSync(path.join(f.home, 'vcc-calls')), false);
  assert.equal(readdirSync(f.state).some(name => name.startsWith('filed-')), false);
  assert.notEqual(f.run('--pages', '../escape.md').status, 0);
});

test('filing is once per ISO week under RUNNER 8 with exact CLI contract', t => {
  const f = weeklyFixture(t);
  f.env.HELPER_DRIFT = 'yes';
  ok(f.run());
  ok(f.run('--pages', 'area-00.md'));
  const calls = readFileSync(path.join(f.home, 'vcc-calls'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 4), ['task', 'create', '--project', '4060']);
  assert.match(calls[0][5], /^Feature map drift \d{4}-W\d{2}: 1 pages$/);
  assert.equal(calls[0][6], '--description-file');
  assert.deepEqual(calls[0].slice(-2), ['--priority', 'medium']);
  assert.equal(readdirSync(f.state).filter(name => name.startsWith('filed-')).length, 1);
});

test('failed or malformed helpers retry exactly once and remain pending, never claiming clean', t => {
  for (const mode of ['always', 'malformed']) {
    const f = weeklyFixture(t);
    f.env.HELPER_FAIL = mode;
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(path.join(f.home, 'helpers'), 'utf8').trim().split('\n').length, 2);
    assert.deepEqual(JSON.parse(readFileSync(path.join(f.state, 'pending.json'))), ['area-00.md']);
    assert.match(readFileSync(path.join(f.runs()[0], 'description.html'), 'utf8'), /Blocked source helpers/);
    assert.equal(existsSync(path.join(f.home, 'vcc-calls')), false);
  }
});

test('successful helper retry works; a failed ticket write cannot record filed marker or advance checkpoint', t => {
  const f = weeklyFixture(t);
  f.env.HELPER_FAIL = 'once';
  f.env.HELPER_DRIFT = 'yes';
  f.env.VCC_FAIL = 'yes';
  assert.notEqual(f.run().status, 0);
  assert.equal(readFileSync(path.join(f.home, 'helpers'), 'utf8').trim().split('\n').length, 2);
  assert.equal(readdirSync(f.state).some(name => name.startsWith('filed-')), false);
  assert.equal(existsSync(path.join(f.state, 'last-run-sha')), false);
});

test('user-wide flock refuses a concurrent runner', async t => {
  const f = weeklyFixture(t);
  mkdirSync(f.state, { recursive: true });
  const child = spawn('flock', [path.join(f.state, 'weekly.lock'), process.execPath, '-e', 'console.log("locked"); process.stdin.resume();'], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /user-wide lock/);
  child.stdin.end();
  await new Promise(resolve => child.once('close', resolve));
});

test('install copies durable scripts and units, records main checkout and retires legacy timer without live systemd', t => {
  const f = weeklyFixture(t);
  f.env.USER_UNIT_CHECK = '/usr/bin/true';
  executable(path.join(f.bin, 'systemctl'), `require('node:fs').appendFileSync(process.env.FIXTURE_HOME + '/systemctl-calls', process.argv.slice(2).join(' ') + '\\n');`);
  const units = path.join(f.home, '.config/systemd/user');
  mkdirSync(units, { recursive: true });
  writeFileSync(path.join(units, 'verify-map-upkeep.timer'), 'legacy');
  ok(f.run('install'));
  const target = path.join(f.home, '.local/lib/hypertask/maintain-verification');
  assert.equal(readFileSync(path.join(target, 'repo'), 'utf8').trim(), f.repo);
  for (const file of ['feature-map-check.mjs', 'maintain-verification-state.mjs', 'maintain-verification-weekly']) assert.equal(readFileSync(path.join(target, file), 'utf8'), readFileSync(path.join(here, file), 'utf8'));
  assert.match(readFileSync(path.join(units, 'maintain-verification-weekly.service'), 'utf8'), /Nice=19\nIOSchedulingClass=idle\nMemoryMax=2G\nTimeoutStartSec=3h/);
  assert.match(readFileSync(path.join(units, 'maintain-verification-weekly.timer'), 'utf8'), /OnCalendar=Mon .*03:43:00 UTC\nPersistent=true/);
  assert.match(readFileSync(path.join(f.home, 'systemctl-calls'), 'utf8'), /disable --now verify-map-upkeep.timer/);
  assert.match(readFileSync(path.join(f.home, 'systemctl-calls'), 'utf8'), /enable --now maintain-verification-weekly.timer/);
  const installed = spawnSync('bash', [path.join(target, 'maintain-verification-weekly')], { env: f.env, encoding: 'utf8', timeout: 20000 });
  ok(installed);
  assert.equal(readFileSync(path.join(f.home, 'helpers'), 'utf8').trim(), 'area-00.md');
});

test('dry-run and already-filed drift stay queued until a later filing, without losing deferred source findings', t => {
  const f = weeklyFixture(t);
  f.env.HELPER_DRIFT = 'yes';
  ok(f.run('--dry-run'));
  assert.deepEqual(JSON.parse(readFileSync(path.join(f.state, 'pending.json'))), ['area-00.md']);
  ok(f.run());
  assert.equal(readFileSync(path.join(f.home, 'vcc-calls'), 'utf8').trim().split('\n').length, 1);
  ok(f.run('--pages', 'area-00.md'));
  assert.deepEqual(JSON.parse(readFileSync(path.join(f.state, 'pending.json'))), ['area-00.md']);
  assert.equal(readFileSync(path.join(f.home, 'vcc-calls'), 'utf8').trim().split('\n').length, 1);
});

test('checker-only drift files recipes without starting unchanged page helpers', t => {
  const f = weeklyFixture(t);
  f.put(`${mapPath}/area-00.md`, '`docs/deleted.md`\n## How to drive it\nOpen the account area.');
  f.git('add', '.'); f.git('commit', '-m', 'stale citation');
  mkdirSync(f.state, { recursive: true });
  writeFileSync(path.join(f.state, 'last-run-sha'), f.git('rev-parse', 'HEAD'));
  ok(f.run());
  assert.equal(existsSync(path.join(f.home, 'helpers')), false);
  assert.equal(readFileSync(path.join(f.home, 'vcc-calls'), 'utf8').trim().split('\n').length, 1);
  const report = readFileSync(path.join(f.runs()[0], 'description.html'), 'utf8');
  assert.match(report, /feature-map\/area-00.md:1: missing path: docs\/deleted.md/);
  assert.match(report, /Live recipe.*Doctor first.*Open the account area/);
});

test('missing load status fails closed; unavailable checkpoint requeues all pages', t => {
  const f = weeklyFixture(t, 2);
  rmSync(f.load);
  assert.notEqual(f.run().status, 0);
  assert.equal(existsSync(path.join(f.home, 'helpers')), false);
  writeFileSync(f.load, 'add\n');
  mkdirSync(f.state, { recursive: true });
  writeFileSync(path.join(f.state, 'last-run-sha'), 'f'.repeat(40));
  ok(f.run());
  assert.deepEqual(readFileSync(path.join(f.home, 'helpers'), 'utf8').trim().split('\n').sort(), f.pages);
});

test('GitHub workflow and policy keep the tiny check free, pinned, scoped and non-required', () => {
  const root = path.resolve(here, '../../../..');
  const read = file => readFileSync(path.join(root, file), 'utf8');
  const workflow = read('.github/workflows/feature-map-weekly.yml');
  assert.match(workflow, /schedule:\n    - cron: '37 3 \* \* 1'\n  workflow_dispatch:\n  pull_request:/);
  assert.match(workflow, /branches: \[production\]/);
  for (const scope of ['.claude/skills/maintain-verification-skill/**', '.claude/skills/verify-qa/reference/feature-map/**', '.claude/skills/verify-qa/reference/ops-map/**', '.github/workflows/feature-map-weekly.yml']) assert.ok(workflow.includes(`- '${scope}'`));
  assert.match(workflow, /permissions:\n  contents: read\n/);
  assert.match(workflow, /runs-on: ubuntu-latest\n    timeout-minutes: 5/);
  assert.match(workflow, /node-version: \^24\.\d+\.\d+\n          check-latest: true/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /secrets\.|npm |hax |vcc |self-hosted/);
  const actions = [...workflow.matchAll(/uses: ([^@\s]+)@([a-f0-9]{40})/g)];
  assert.equal(actions.length, 2);
  for (const [, action, sha] of actions) assert.ok(read('.github/actions/action-archive-cache-manifest.txt').includes(`${action} ${sha} `));
  assert.ok(workflow.indexOf('node --test ') < workflow.indexOf('run: node .claude/skills/maintain-verification-skill/scripts/feature-map-check.mjs'));
  const policy = read('docs/ci-policy.yml');
  assert.match(policy, /feature_map_weekly:\n  context: feature-map-check\n  workflow: .github\/workflows\/feature-map-weekly.yml\n  runs_on: ubuntu-latest\n  required: false/);
  const required = policy.match(/required_checks:\n([\s\S]*?)(?=\n\w)/)?.[1];
  assert.ok(required);
  assert.doesNotMatch(required, /feature-map-check/);
  assert.match(read('docs/ci.md'), /Feature-map citation check/);
});
