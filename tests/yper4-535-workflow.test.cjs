const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync, rmSync, existsSync, symlinkSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
let snapshotModes, validateEvidence;
let localFlagModes;
test.before(async () => {
  ({ snapshotModes, validateEvidence } = await import('../scripts/premerge-click-guard.mjs'));
  ({ localFlagModes } = await import('../scripts/premerge-local-flags.mjs'));
});

const root = path.resolve(__dirname, '..');
const workflow = readFileSync(path.join(root, '.github/workflows/premerge-click.yml'), 'utf8');
const local = readFileSync(path.join(root, 'scripts/premerge-local.sh'), 'utf8');
const seed = readFileSync(path.join(root, 'scripts/seed-browser-smoke.mjs'), 'utf8');
const sha = 'a'.repeat(40);
const modes = { 'htpr-1-live': 'EVERYONE', 'htpr-2-qa': 'OWNER_AND_QA', 'htpr-3-off': 'OFF' };
const plain = { 'htpr-1-live': true, 'htpr-2-qa': false, 'htpr-3-off': false };
const temp = () => mkdtempSync(path.join(os.tmpdir(), 'yper4-535-test-'));
const put = (folder, name, contents, mode) => {
  const target = path.join(folder, name);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents, mode ? { mode } : {});
};
const copy = (folder, name) => put(folder, name, readFileSync(path.join(root, name)));
const env = folder => ({ PATH: `${folder}/bin:${process.env.PATH}`, HOME: folder, XDG_RUNTIME_DIR: folder, FIXTURE_ROOT: folder });
const run = (folder, name, args = [], extra = {}) => spawnSync('bash', [path.join(folder, name), ...args], { cwd: folder, encoding: 'utf8', timeout: 15000, env: { ...env(folder), ...extra } });
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function launcherFixture() {
  const folder = temp();
  copy(folder, 'scripts/premerge-local.sh');
  copy(folder, 'scripts/premerge-click-guard.mjs');
  put(folder, 'flags.json', JSON.stringify({ modes, plain }));
  put(folder, 'bin/docker', `#!/bin/sh
printf '%s:%s:%s:%s\\n' "$GITHUB_ACTIONS" "$RUNNER_ENVIRONMENT" "$PREMERGE_FLAGS_FILE" "\${DATABASE_URL:-cleared}" >> "$HOME/docker-called"
exit 77
`, 0o755);
  return folder;
}

test('local arguments and CI admission fail before any Docker or build call', () => {
  const folder = launcherFixture();
  try {
    for (const args of [['help'], ['up', 'down'], ['down', '--ci'], ['up', '--ci', '--ci'], ['up', '--flag'], ['up', '--flag', 'key=INVALID'], ['up', '--flag', 'key=OFF=EVERYONE']]) {
      assert.equal(run(folder, 'scripts/premerge-local.sh', args).status, 2);
    }
    assert.equal(run(folder, 'scripts/premerge-local.sh', ['up', '--ci']).status, 2);
    const hosted = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', CI: 'true' };
    assert.equal(run(folder, 'scripts/premerge-local.sh', ['up', '--ci'], hosted).status, 2);
    const flags = { ...hosted, PREMERGE_FLAGS_FILE: `${folder}/flags.json` };
    assert.equal(run(folder, 'scripts/premerge-local.sh', ['up', '--ci', '--flag', 'key=OFF'], flags).status, 2);
    put(folder, 'flags.json', '{"modes":{"key":"INVALID"}}');
    const invalid = run(folder, 'scripts/premerge-local.sh', ['up', '--ci'], flags);
    assert.equal(invalid.status, 1); assert.match(invalid.stderr, /Invalid live flag/);
    assert.equal(existsSync(`${folder}/docker-called`), false);
    put(folder, 'flags.json', JSON.stringify({ modes, plain }));
    const admitted = run(folder, 'scripts/premerge-local.sh', ['up', '--ci'], { ...flags, DATABASE_URL: 'must-be-cleared' });
    assert.equal(admitted.status, 1); assert.match(admitted.stderr, /Docker daemon is unavailable/);
    assert.equal(readFileSync(`${folder}/docker-called`, 'utf8'), `true:github-hosted:${folder}/flags.json:cleared\n`);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('the actual seed snapshot branch never reads QA cookies and rejects non-hosted injection', async () => {
  const branch = seed.slice(seed.indexOf('    if (process.env?.PREMERGE_FLAGS_FILE)'), seed.indexOf('    await writeFile(path.join(path.dirname(stateFile), "flag-modes.json")'));
  assert.ok(branch.includes('snapshotModes'));
  const execute = new AsyncFunction('process', 'readFile', 'snapshotModes', 'defaults', 'overrides', 'readPlainQaFlags', 'QA_ACCOUNT_STATE', 'localFlagModes', `let modes = {...defaults}; ${branch}; return modes;`);
  const defaults = { 'htpr-1-live': 'OFF', 'htpr-2-qa': 'OFF', 'htpr-3-off': 'EVERYONE', 'htpr-4-new': 'OWNER_ONLY' };
  const process = { env: { PREMERGE_FLAGS_FILE: '/snapshot', GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' } };
  let cookieReads = 0;
  const read = async filename => { assert.equal(filename, '/snapshot'); return JSON.stringify({ modes, plain }); };
  const forbidden = async () => { cookieReads++; throw new Error('QA cookies must not be read on GitHub'); };
  assert.deepEqual(await execute(process, read, snapshotModes, defaults, [], forbidden, '/qa', localFlagModes), { ...modes, 'htpr-4-new': 'OWNER_ONLY' });
  assert.equal(cookieReads, 0);
  await assert.rejects(execute({ env: { PREMERGE_FLAGS_FILE: '/snapshot' } }, read, snapshotModes, defaults, [], forbidden, '/qa', localFlagModes), /GitHub-hosted/);
  await assert.rejects(execute(process, read, snapshotModes, defaults, ['--flag', 'htpr-1-live=OFF'], forbidden, '/qa', localFlagModes), /without overrides/);
});

test('the build branch skips the VPS heavy-job slot only in CI', () => {
  const folder = temp();
  try {
    put(folder, 'bin/npx', '#!/bin/sh\necho "stubbed-next: $*"\n', 0o755);
    put(folder, 'scripts/heavy-job.sh', '#!/bin/sh\necho heavy-slot\nshift\nexec "$@"\n', 0o755);
    const start = local.indexOf('if [ "${#ci_args[@]}" -ne 0 ]; then\n  PREMERGE_NEXT_BUILD=1');
    const branch = local.slice(start, local.indexOf('\nsetsid node ', start));
    assert.ok(start > 0);
    for (const ci of [true, false]) {
      const result = spawnSync('bash', ['-c', `root="$HOME"; ci_args=(${ci ? '--ci' : ''}); ${branch}`], { encoding: 'utf8', env: env(folder) });
      assert.equal(result.status, 0); assert.match(result.stdout, /stubbed-next: --no-install next build --webpack/);
      assert.equal(result.stdout.includes('heavy-slot'), !ci);
    }
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

function remoteFixture() {
  const folder = temp();
  for (const name of ['scripts/premerge-remote.sh', 'scripts/premerge-click-guard.mjs', 'scripts/premerge-local-flags.mjs']) copy(folder, name);
  put(folder, 'package.json', '{"type":"module"}');
  put(folder, 'node_modules/jiti/index.js', `module.exports = () => () => ({ FEATURE_FLAG_KEYS: ['htpr-1-live','htpr-2-qa','htpr-3-off'], defaultFeatureFlagMode: () => 'OFF' });`);
  for (const suffix of ['qa-normal', 'qa']) put(folder, `.config/hypertask-videos/storageState-${suffix}.json`, JSON.stringify({ cookies: [{ domain: 'app.hypertask.ai', name: 'session', value: `synthetic-${suffix}` }] }));
  put(folder, 'fetch.mjs', `globalThis.fetch = async (url, options) => {
    if (process.env.FAIL_FLAGS === '1') throw new Error('synthetic expired session');
    return { ok: true, json: async () => ({ flags: { 'htpr-1-live': true, 'htpr-2-qa': options.headers.Cookie.includes('synthetic-qa-normal') ? false : true, 'htpr-3-off': false } }) };
  };`);
  put(folder, 'bin/gh', `#!/usr/bin/env node
import fs from 'node:fs';
const root = process.env.FIXTURE_ROOT, args = process.argv.slice(2);
fs.appendFileSync(root+'/calls', JSON.stringify(args)+'\\n');
if (args[0] === 'api') {
  if (args[1] === 'user') console.log('runner4');
  else if (args[1].includes('/pulls/')) console.log(JSON.stringify({ state:'open',base:{ref:'production',repo:{full_name:'hypertask-ai/hypertask'}},head:{sha:'${sha}',repo:{full_name:'hypertask-ai/hypertask'}} }));
  else if (args[1].includes('/contents/')) console.log('file');
  else if (args[1].includes('/artifacts')) console.log('premerge-'+(process.env.WRONG_ARTIFACT === '1' ? 'c'.repeat(40) : '${sha}'));
  else process.exit(91);
} else if (args.slice(0,2).join(' ') === 'workflow run') {
  const snapshot = JSON.parse(Buffer.from(args.find(a => a.startsWith('flags=')).slice(6), 'base64'));
  if (JSON.stringify(snapshot).includes('synthetic')) process.exit(92);
  fs.writeFileSync(root+'/snapshot.json', JSON.stringify(snapshot));
  fs.writeFileSync(root+'/dispatched', 'yes');
} else if (args.slice(0,2).join(' ') === 'run list') {
  const list = [{databaseId:50,displayTitle:'premerge click PR #42',url:'https://github.com/hypertask-ai/hypertask/actions/runs/50'}];
  if (fs.existsSync(root+'/dispatched')) {
    list.push({databaseId:51,displayTitle:'premerge click PR #42',url:'https://github.com/hypertask-ai/hypertask/actions/runs/51'});
    if (process.env.AMBIGUOUS === '1') list.push({...list[1],databaseId:52});
  }
  console.log(JSON.stringify(list));
} else if (args.slice(0,2).join(' ') === 'run watch') process.exit(process.env.FAIL_WATCH === '1' ? 1 : 0);
else process.exit(93);
`, 0o755);
  return folder;
}

test('remote arguments reject before GitHub, flags reads or any local build', () => {
  const folder = remoteFixture();
  try {
    for (const args of [[], ['42'], ['0', 'click.mjs'], ['-1', 'click.mjs'], ['42', '../click.mjs'], ['42', '/click.mjs'], ['42', 'click.mjs', 'extra']]) {
      assert.equal(run(folder, 'scripts/premerge-remote.sh', args).status, 2);
    }
    assert.equal(existsSync(`${folder}/calls`), false);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('remote snapshots live flags, dispatches production, excludes older runs and watches without building', () => {
  const folder = remoteFixture();
  try {
    const result = run(folder, 'scripts/premerge-remote.sh', ['42', 'scripts/click.mjs'], { NODE_OPTIONS: `--import=${folder}/fetch.mjs` });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(`${folder}/snapshot.json`)), { modes, plain });
    assert.match(result.stdout, /Run URL: https:\/\/github.com\/hypertask-ai\/hypertask\/actions\/runs\/51/);
    assert.match(result.stdout, new RegExp(`Artifact: premerge-${sha}`));
    const calls = readFileSync(`${folder}/calls`, 'utf8').trim().split('\n').map(JSON.parse);
    const dispatch = calls.find(args => args[0] === 'workflow');
    assert.deepEqual(dispatch.slice(0, 7), ['workflow', 'run', 'premerge-click.yml', '--repo', 'hypertask-ai/hypertask', '--ref', 'production']);
    assert.ok(dispatch.includes('pr=42')); assert.ok(dispatch.includes('click=scripts/click.mjs'));
    assert.ok(calls.some(args => args[0] === 'run' && args[1] === 'watch' && args[2] === '51' && args.includes('--exit-status')));
    assert.doesNotMatch(readFileSync(path.join(root, 'scripts/premerge-remote.sh'), 'utf8'), /next build|npm ci|premerge-local\.sh up/);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('remote live-read failure never dispatches; ambiguous runs and failed watches never pass', () => {
  for (const mode of ['FAIL_FLAGS', 'AMBIGUOUS', 'FAIL_WATCH', 'WRONG_ARTIFACT']) {
    const folder = remoteFixture();
    try {
      const result = run(folder, 'scripts/premerge-remote.sh', ['42', 'scripts/click.mjs'], { NODE_OPTIONS: `--import=${folder}/fetch.mjs`, [mode]: '1' });
      assert.equal(result.status, 1, result.stderr);
      if (mode === 'FAIL_FLAGS') assert.equal(existsSync(`${folder}/dispatched`), false);
      if (mode === 'AMBIGUOUS') assert.match(result.stderr, /Ambiguous concurrent/);
    } finally { rmSync(folder, { recursive: true, force: true }); }
  }
});

test('workflow isolates all write permissions from PR execution and checks itself before merge', () => {
  const click = workflow.slice(workflow.indexOf('\n  click:'), workflow.indexOf('\n  post-status:'));
  const post = workflow.slice(workflow.indexOf('\n  post-status:'));
  assert.match(workflow, /^run-name: "premerge click PR #\$\{\{ inputs.pr \}\}"$/m);
  assert.match(workflow, /pull_request:\n    branches: \[production\]/);
  assert.match(workflow, /node --test tests\/yper4-535-guard\.test\.cjs/);
  assert.match(workflow, /actionlint" -shellcheck=/);
  assert.match(click, /permissions:\n      contents: read\n      pull-requests: read\n    outputs:/);
  assert.doesNotMatch(click, /statuses:|secrets\.|actions\/cache\/save|cache: npm/);
  assert.equal((click.match(/persist-credentials: false/g) ?? []).length, 2);
  assert.match(click, /ref: \$\{\{ steps.resolve.outputs.head_sha \}\}/);
  assert.match(click, /premerge-local\.sh up --ci/);
  assert.match(post, /permissions:\n      statuses: write\n      actions: read/);
  assert.doesNotMatch(post, /uses: actions\/checkout|npm |node_modules|working-directory: pr/);
  assert.match(post, /TRUSTED_SHA: \$\{\{ github.workflow_sha \}\}/);
  assert.match(post, /guardPull\(pr,.*sha\)/);
  assert.match(post, /github.rest.pulls.get/);
  assert.match(post, /pull-requests: read/);
  assert.doesNotMatch(post, /await fetch\(/);
  assert.doesNotMatch(click, /actions\/cache|cache:|node-modules-/);
  assert.match(workflow, /group: premerge-click-.*inputs.pr/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(post, /context: 'premerge-evidence', description: 'GitHub premerge click'/);
  assert.match(post, /if: always\(\)/);
  assert.equal((workflow.match(/runs-on: ubuntu-latest/g) ?? []).length, 3);
  for (const use of workflow.matchAll(/^\s+(?:- )?uses: ([^\n]+)/gm)) assert.match(use[1], /@[0-9a-f]{40} # v[0-9]+(?:\.[0-9]+)*$/);
});

function evidenceFixture(folder) {
  put(folder, 'incoming/premerge.md', `Commit: ${sha}\nAccount: 985 (disposable QA, board owner)\nFlags: htpr-1-live=EVERYONE\nBoard: http://127.0.0.1:3100/project?id=42&surface=board\nBuild: http://127.0.0.1:3100\nClick: PASS scripts/click.mjs\nRecording: video/click.webm\n`);
  put(folder, 'incoming/screenshots/after.png', 'synthetic screenshot');
  put(folder, 'incoming/video/click.webm', 'synthetic recording');
  put(folder, 'trusted-guard.mjs', readFileSync(path.join(root, 'scripts/premerge-click-guard.mjs')));
}

test('the actual publisher posts failure on the resolved old SHA if the PR head moved', async () => {
  const script = workflow.slice(workflow.lastIndexOf('          script: |\n') + '          script: |\n'.length).split('\n').map(line => line.startsWith('            ') ? line.slice(12) : line).join('\n');
  const publish = new AsyncFunction('require', 'process', 'fetch', 'github', 'core', 'context', script);
  const folder = temp();
  try {
    evidenceFixture(folder);
    for (const variant of ['same', 'moved', 'fork', 'failed-click', 'wrong-click', 'invalid-flags', 'api-failure', 'failed-extraction', 'missing-media']) {
      if (variant === 'missing-media') rmSync(`${folder}/incoming/video/click.webm`);
      const posts = [], failed = [];
      const github = { rest: { repos: { createCommitStatus: async status => posts.push(status) }, pulls: { get: async () => { if (variant === 'api-failure') throw Error('synthetic authenticated API failure'); return { data: await (await fetch()).json() }; } } } };
      const core = { error() {}, setFailed: reason => failed.push(reason) };
      const process = { env: { HEAD_SHA: sha, EVIDENCE_RESULT: variant === 'failed-extraction' ? 'failure' : 'success', CLICK_RESULT: variant === 'failed-click' ? 'failure' : 'success', PR: '42', CLICK: variant === 'wrong-click' ? 'other.mjs' : 'scripts/click.mjs', FLAGS: variant === 'invalid-flags' ? '!' : Buffer.from(JSON.stringify({ modes: { 'htpr-1-live': 'EVERYONE' }, plain: { 'htpr-1-live': true } })).toString('base64'), RUNNER_TEMP: folder, GITHUB_SERVER_URL: 'https://github.com' } };
      const fetch = async () => ({ ok: true, json: async () => ({ state: 'open', base: { ref: 'production', repo: { full_name: 'hypertask-ai/hypertask' } }, head: { sha: variant === 'moved' ? 'b'.repeat(40) : sha, repo: { full_name: variant === 'fork' ? 'attacker/hypertask' : 'hypertask-ai/hypertask' } } }) });
      await publish(require, process, fetch, github, core, { repo: { owner: 'hypertask-ai', repo: 'hypertask' }, runId: 123 });
      assert.equal(posts.length, 1); assert.equal(posts[0].sha, sha);
      assert.equal(posts[0].state, variant === 'same' ? 'success' : 'failure');
      assert.equal(posts[0].context, 'premerge-evidence'); assert.equal(posts[0].description, 'GitHub premerge click');
      assert.equal(posts[0].target_url, 'https://github.com/hypertask-ai/hypertask/actions/runs/123');
      assert.equal(failed.length, variant === 'same' ? 0 : 1);
    }
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('the actual workflow Playwright driver records success and propagates click failures', async () => {
  const start = workflow.indexOf("          node --input-type=module <<'NODE'\n") + "          node --input-type=module <<'NODE'\n".length;
  const script = workflow.slice(start, workflow.indexOf('\n          NODE', start)).split('\n').map(line => line.slice(10)).join('\n');
  const folder = temp();
  try {
    put(folder, 'package.json', '{"type":"module"}');
    put(folder, 'trusted/scripts/premerge-click-guard.mjs', readFileSync(path.join(root, 'scripts/premerge-click-guard.mjs')));
    mkdirSync(`${folder}/pr`, { recursive: true });
    symlinkSync(`${folder}/node_modules`, `${folder}/pr/node_modules`);
    put(folder, 'local-ready.log', `Build URL: http://127.0.0.1:3100\nBoard URL: http://127.0.0.1:3100/project?id=42&surface=board\nStorage state: /synthetic/state.json\nCommit: ${sha}\nAccount: 985 (disposable QA, board owner)\nFlags: htpr-1-live=EVERYONE\nBoard: http://127.0.0.1:3100/project?id=42&surface=board\nBuild: http://127.0.0.1:3100\n`);
    put(folder, 'node_modules/playwright/index.js', `const {writeFileSync}=require('node:fs');
let closed=false;
const video={saveAs:async filename=>{if(closed)throw Error('browser closed before video save');writeFileSync(filename,'synthetic recording')}};
const page={goto:async url=>{if(!url.includes('project?id=42'))throw Error('wrong board')},screenshot:async ({path})=>writeFileSync(path,'synthetic screenshot'),video:()=>video};
exports.chromium={launch:async()=>({newContext:async options=>{if(options.storageState!=='/synthetic/state.json'||!options.recordVideo)throw Error('missing state/video');return {newPage:async()=>page,close:async()=>{}}},close:async()=>{closed=true}})};`);
    put(folder, 'pr/scripts/click.mjs', `export default async ({page, context, baseURL, boardURL, storageState, outputDir}) => { if (!page || !context || !boardURL.startsWith(baseURL) || !storageState || !outputDir) throw Error('missing interface'); if(process.env.FAIL_CLICK)throw Error('changed path failed'); };`);
    mkdirSync(`${folder}/evidence/screenshots`, { recursive: true }); mkdirSync(`${folder}/evidence/video`);
    for (const fail of [false, true]) {
      if (existsSync(`${folder}/evidence/premerge.md`)) rmSync(`${folder}/evidence/premerge.md`);
      const result = spawnSync('node', ['--input-type=module'], { input: script, cwd: `${folder}/pr`, encoding: 'utf8', env: { ...env(folder), RUNNER_TEMP: folder, GITHUB_WORKSPACE: folder, CLICK_SCRIPT: 'scripts/click.mjs', ...(fail ? { FAIL_CLICK: '1' } : {}) } });
      assert.equal(result.status, fail ? 1 : 0, result.stderr);
      if (fail) assert.equal(existsSync(`${folder}/evidence/premerge.md`), false);
      else await validateEvidence(`${folder}/evidence`, sha, { modes: { 'htpr-1-live': 'EVERYONE' }, plain: { 'htpr-1-live': true } });
    }
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('the actual archive extractor rejects traversal, symlinks, duplicate entries and zip bombs as data', () => {
  const marker = "          python3 - <<'PY'\n";
  const start = workflow.indexOf(marker) + marker.length;
  assert.ok(start >= marker.length);
  const script = workflow.slice(start, workflow.indexOf('\n          PY', start)).split('\n').map(line => line.slice(10)).join('\n');
  const folder = temp();
  try {
    for (const variant of ['valid', 'code', 'traversal', 'absolute', 'symlink', 'duplicate', 'large-record', 'bomb', 'too-many']) {
      rmSync(`${folder}/incoming`, { recursive: true, force: true });
      const make = spawnSync('python3', ['-c', `import pathlib, sys, zipfile, stat
root = pathlib.Path(sys.argv[1]); variant = sys.argv[2]
with zipfile.ZipFile(root / 'evidence.zip', 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    if variant == 'valid':
        archive.writestr('premerge.md', 'Click: PASS scripts/click.mjs\\n')
        archive.writestr('screenshots/after.png', b'png')
        archive.writestr('video/click.webm', b'webm')
    elif variant == 'symlink':
        entry = zipfile.ZipInfo('premerge.md'); entry.create_system = 3; entry.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive.writestr(entry, '/etc/hostname')
    elif variant == 'duplicate':
        archive.writestr('premerge.md', 'first'); archive.writestr('premerge.md', 'second')
    elif variant == 'large-record': archive.writestr('premerge.md', b'x' * 262145)
    elif variant == 'bomb': archive.writestr('video/click.webm', b'x' * 134217729)
    elif variant == 'too-many':
        for i in range(101): archive.writestr('video/' + str(i) + '.webm', b'x')
    else: archive.writestr({'code':'payload.mjs', 'traversal':'../escaped', 'absolute':'/tmp/escaped'}[variant], 'throw Error("artifact code must never execute")')
`, folder, variant], { encoding: 'utf8', timeout: 15000 });
      assert.equal(make.status, 0, make.stderr);
      const result = spawnSync('python3', ['-c', script], { env: { ...env(folder), RUNNER_TEMP: folder }, encoding: 'utf8', timeout: 15000 });
      assert.equal(result.status, variant === 'valid' ? 0 : 1, `${variant}: ${result.stderr}`);
      if (variant === 'valid') assert.equal(readFileSync(`${folder}/incoming/video/click.webm`, 'utf8'), 'webm');
      else assert.equal(existsSync(`${folder}/incoming`), false, `${variant} extracted rejected files`);
    }
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('every VPS status POST site restricts required writes to success and revocations to local', () => {
  const reconciler = readFileSync(path.join(root, '.claude/skills/ship/scripts/premerge-evidence.py'), 'utf8');
  const checker = readFileSync(path.join(root, '.claude/skills/ship/scripts/ship-check'), 'utf8');
  const shellPosts = checker.match(/^.*\bPOST\b.*$/gm) || [];
  const pythonPosts = reconciler.match(/^.*\bPOST\b.*$/gm) || [];
  assert.equal(shellPosts.length, 1, 'audit every shell POST site');
  assert.equal(pythonPosts.length, 1, 'audit every Python POST site');
  assert.match(shellPosts[0], /gh api .*--method POST -f "context=\$context"/);
  assert.match(checker, /local .*state=failure context=premerge-evidence-local/);
  assert.match(checker, /\[ "\$state" != success \] \|\| context=premerge-evidence\n  gh api/);
  assert.match(pythonPosts[0], /subprocess\.run\(\['gh', 'api', .*'--method', 'POST',/);
  assert.match(reconciler, /'--method', 'POST',\n\s+'-f', 'context=premerge-evidence-local', '-f', 'state=failure'/);
  assert.doesNotMatch(reconciler, /['"]context=premerge-evidence['"]/);
});

test('the actual downloader accepts only one bounded current-run artifact via authenticated client', async () => {
  const block = workflow.slice(workflow.indexOf('      - name: Download bounded evidence archive as data'), workflow.indexOf('      - name: Extract only bounded evidence data'));
  const script = block.slice(block.indexOf('          script: |\n') + '          script: |\n'.length).split('\n').map(line => line.startsWith('            ') ? line.slice(12) : line).join('\n');
  const download = new AsyncFunction('require', 'process', 'github', 'context', script);
  const folder = temp();
  try {
    for (const variant of ['valid', 'missing', 'duplicate', 'expired', 'oversized']) {
      const artifact = { name: `premerge-${sha}`, id: 123, expired: variant === 'expired', size_in_bytes: variant === 'oversized' ? 67108865 : 32 };
      let downloads = 0;
      const actions = { listWorkflowRunArtifacts() {}, downloadArtifact: async params => {
        assert.equal(params.artifact_id, 123); assert.equal(params.archive_format, 'zip'); downloads++;
        return { data: Buffer.from('artifact data, not JavaScript') };
      } };
      const github = { rest: { actions }, paginate: async (method, params) => {
        assert.equal(method, actions.listWorkflowRunArtifacts); assert.equal(params.run_id, 99);
        return variant === 'missing' ? [] : variant === 'duplicate' ? [artifact, artifact] : [artifact];
      } };
      const execute = () => download(require, { env: { RUNNER_TEMP: folder, HEAD_SHA: sha } }, github, { repo: { owner: 'hypertask-ai', repo: 'hypertask' }, runId: 99 });
      if (variant === 'valid') {
        await execute(); assert.equal(downloads, 1);
        assert.equal(readFileSync(`${folder}/evidence.zip`, 'utf8'), 'artifact data, not JavaScript');
      } else { await assert.rejects(execute()); assert.equal(downloads, 0); }
    }
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
