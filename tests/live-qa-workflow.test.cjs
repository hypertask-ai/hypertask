const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, readdirSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const ts = require('typescript');
const yaml = require('js-yaml');

const root = path.resolve(__dirname, '..');
const source = file => readFileSync(path.join(root, file), 'utf8');
const workflow = file => yaml.load(source(`.github/workflows/${file}.yml`));
const load = file => import(pathToFileURL(path.join(root, file)).href);
const sha = 'a'.repeat(40);
const script = 'e2e/live-qa/YPER4-544.spec.ts';
const live = workflow('live-qa');

function pinnedActions(document) {
  for (const job of Object.values(document.jobs)) {
    for (const step of job.steps || []) {
      if (step.uses) assert.match(step.uses, /^[\w./-]+@[a-f0-9]{40}$/);
    }
  }
}

function readOnly(document) {
  assert.deepEqual(document.permissions, { contents: 'read' });
  for (const job of Object.values(document.jobs)) {
    if (job.permissions) assert.deepEqual(job.permissions, { contents: 'read' });
  }
}

function guard(job, mode) {
  assert.equal(job.environment, 'live-qa');
  assert.match(job.if, /github\.ref == 'refs\/heads\/production'/);
  assert.match(job.if, /github\.repository == 'hypertask-ai\/hypertask'/);
  if (mode) assert.match(job.if, /github\.event_name == 'workflow_dispatch'/);
  const expression = job.if.replace(/^\$\{\{\s*|\s*\}\}$/g, '');
  for (const event of ['workflow_dispatch', 'push', 'pull_request', 'pull_request_target']) {
    for (const ref of ['refs/heads/production', 'refs/heads/feature', 'refs/tags/production']) {
      for (const repository of ['hypertask-ai/hypertask', 'outsider/hypertask']) {
        for (const selectedMode of ['run', 'probe']) {
          const enabled = vm.runInNewContext(expression, {
            github: { event_name: event, ref, repository }, inputs: { mode: selectedMode },
            needs: { health: { result: 'success', outputs: { live: 'true' } } }, cancelled: () => false,
          });
          const trusted = ref === 'refs/heads/production' && repository === 'hypertask-ai/hypertask';
          assert.equal(enabled, trusted && (mode ? event === 'workflow_dispatch' && selectedMode === mode : ['push', 'workflow_dispatch'].includes(event)));
        }
      }
    }
  }
}

function validateLive(document) {
  assert.deepEqual(Object.keys(document.on), ['workflow_dispatch']);
  assert.deepEqual(Object.keys(document.jobs).sort(), ['capture', 'probe']);
  readOnly(document);
  pinnedActions(document);
  assert.deepEqual(document.concurrency, { group: 'live-qa-account-985', 'cancel-in-progress': false });
  const { capture, probe } = document.jobs;
  guard(capture, 'run');
  guard(probe, 'probe');
  for (const job of [capture, probe]) {
    assert.equal(job['runs-on'], 'ubuntu-latest');
    assert.ok(job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 20);
  }
  const steps = capture.steps;
  assert.match(steps[0].uses, /^actions\/checkout@/);
  assert.equal(steps[0].with.ref, '${{ github.sha }}');
  assert.equal(steps[0].with['persist-credentials'], false);
  assert.match(steps[1].uses, /^actions\/setup-node@/);
  const index = pattern => {
    const found = steps.findIndex(step => pattern.test(step.run || ''));
    assert.ok(found >= 0, `Missing step: ${pattern}`);
    return found;
  };
  const login = steps.findIndex(step => step.id === 'login');
  assert.ok(index(/^npm ci --ignore-scripts$/) > 1);
  assert.ok(index(/playwright install --with-deps chromium/) < login);
  assert.ok(index(/run\.mjs validate/) < login);
  assert.ok(index(/evidence\.mjs validate/) < login);
  assert.equal(steps[login].run, './node_modules/.bin/tsx scripts/live-qa/login.ts');
  assert.deepEqual(steps[login].env, {
    QA_LOGIN_EMAIL: '${{ secrets.QA_LOGIN_EMAIL }}', QA_LOGIN_PASSWORD: '${{ secrets.QA_LOGIN_PASSWORD }}',
  });
  const run = steps.findIndex(step => step.id === 'test');
  const encrypt = steps.findIndex(step => step.id === 'encrypt');
  const upload = steps.findIndex(step => step.uses?.startsWith('actions/upload-artifact@'));
  assert.ok(login < run && run < encrypt && encrypt < upload);
  assert.equal(steps[run].run, 'node scripts/live-qa/run.mjs run');
  assert.match(steps[encrypt].run, /evidence\.mjs encrypt/);
  assert.match(steps[encrypt].if, /steps\.test\.outcome == 'failure'/);
  assert.match(steps[upload].if, /steps\.encrypt\.outcome == 'success'/);
  assert.equal(steps[upload].with.path, '${{ runner.temp }}/live-qa-evidence.tar.age');
  assert.equal(steps[upload].with['retention-days'], 7);
  assert.equal(steps[upload].with['if-no-files-found'], 'error');
  assert.equal(steps[upload].with['include-hidden-files'], false);
  assert.match(steps[upload].with.name, /github\.run_id.*github\.run_attempt/);
  assert.equal(steps.at(-1).if, 'always()');
  assert.match(steps.at(-1).run, /live-qa-private.*live-qa-results.*live-qa-evidence/);
  assert.equal(probe.steps.length, 1);
  assert.deepEqual(probe.steps[0].env, { QA_SECRET_PRESENT: "${{ secrets.QA_LOGIN_EMAIL != '' && secrets.QA_LOGIN_PASSWORD != '' }}" });
  assert.match(probe.steps[0].run, /echo 'secret-present=true'/);
  assert.match(probe.steps[0].run, /echo 'secret-present=false'\n\s+exit 1/);
  const scrubbed = structuredClone(document);
  scrubbed.jobs.capture.steps[login].env = {};
  scrubbed.jobs.probe.steps[0].env = {};
  assert.doesNotMatch(JSON.stringify(scrubbed), /secrets\./);
  for (const step of steps) assert.doesNotMatch(step.run || '', /\$\{\{\s*inputs\./);
}

test('production health guards every QA secret consumer without changing rollback dependencies', () => {
  const health = workflow('prod-health');
  const consumers = Object.values(health.jobs).filter(job => /secrets\.QA_LOGIN_/.test(JSON.stringify(job)));
  assert.equal(consumers.length, 1);
  consumers.forEach(job => guard(job));
  assert.equal(health.jobs.smoke.needs, 'health');
  assert.deepEqual(health.jobs.rollback.needs, ['health', 'smoke', 'core-actions']);
  assert.deepEqual(health.jobs.smoke.concurrency, { group: 'live-qa-account-985', 'cancel-in-progress': false });
  const copy = structuredClone(health.jobs.smoke);
  delete copy.if;
  assert.throws(() => guard(copy));
});

test('real live QA workflow is still allowed', () => validateLive(live));

for (const [name, mutate] of [
  ['removed production guard', copy => { copy.jobs.capture.if = "github.event_name == 'workflow_dispatch' && inputs.mode == 'run'"; }],
  ['added PR event', copy => { copy.on.pull_request = {}; }],
  ['added pull_request_target', copy => { copy.on.pull_request_target = {}; }],
  ['workflow write permission', copy => { copy.permissions.contents = 'write'; }],
  ['job write permission', copy => { copy.jobs.capture.permissions = { contents: 'write' }; }],
  ['removed environment', copy => { delete copy.jobs.capture.environment; }],
  ['job-scoped login secret', copy => { copy.jobs.capture.env.QA_LOGIN_PASSWORD = '${{ secrets.QA_LOGIN_PASSWORD }}'; }],
  ['plaintext upload', copy => { copy.jobs.capture.steps.find(step => step.uses?.startsWith('actions/upload-artifact@')).with.path = '${{ runner.temp }}/live-qa-results/**'; }],
  ['upload before encryption', copy => { const steps = copy.jobs.capture.steps; const index = steps.findIndex(step => step.id === 'encrypt'); [steps[index], steps[index + 1]] = [steps[index + 1], steps[index]]; }],
]) {
  test(`unsafe YAML mutation is still refused: ${name}`, () => {
    const copy = yaml.load(yaml.dump(live));
    mutate(copy);
    assert.throws(() => validateLive(yaml.load(yaml.dump(copy))));
    validateLive(live);
  });
}

test('wireframe workflow is secretless, readonly, pinned and path-filtered', () => {
  const document = workflow('wireframe-capture');
  assert.deepEqual(Object.keys(document.on).sort(), ['pull_request', 'workflow_dispatch']);
  assert.deepEqual(document.on.pull_request.branches, ['production']);
  for (const required of ['docs/wireframes/**', 'scripts/wireframe-capture.mjs']) assert.ok(document.on.pull_request.paths.includes(required));
  assert.doesNotMatch(JSON.stringify(document), /secrets\.|"environment":/);
  readOnly(document);
  pinnedActions(document);
  const steps = document.jobs.capture.steps;
  assert.equal(steps[0].with['persist-credentials'], false);
  assert.equal(steps[0].with['fetch-depth'], 0);
  assert.ok(steps.some(step => step.run === 'npm ci --ignore-scripts'));
  const upload = steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(upload.with.path, '${{ runner.temp }}/wireframe-captures/*.png');
  assert.equal(upload.with['retention-days'], 7);
  assert.match(upload.if, /captured == 'true'/);
  const capture = source('scripts/wireframe-capture.mjs');
  assert.match(capture, /server\.listen\(0, '127\.0\.0\.1'/);
  assert.match(capture, /new URL\(request.url\(\)\)\.origin === origin/);
  assert.match(capture, /png.length >= 3 \* 1024 \* 1024/);
  assert.match(capture, /serviceWorkers: 'block'/);
  assert.match(capture, /routeWebSocket/);
});

test('PR probe checks only boolean presence and never checks out code or requests an environment', () => {
  const document = workflow('live-qa-secret-scope');
  assert.deepEqual(Object.keys(document.on), ['pull_request']);
  readOnly(document);
  const job = document.jobs['secret-scope'];
  assert.equal(job.environment, undefined);
  assert.equal(job.steps.length, 1);
  assert.equal(job.steps[0].uses, undefined);
  assert.deepEqual(job.steps[0].env, { QA_SECRET_PRESENT: "${{ secrets.QA_LOGIN_EMAIL != '' || secrets.QA_LOGIN_PASSWORD != '' || secrets.QA_LOGIN_CREDENTIALS != '' }}" });
  const run = job.steps[0].run;
  for (const [present, status] of [['false', 0], ['true', 1]]) {
    const result = spawnSync('bash', ['-e', '-c', run], { encoding: 'utf8', env: { PATH: process.env.PATH, QA_SECRET_PRESENT: present } });
    assert.equal(result.status, status);
    assert.equal(result.stdout, `secret-present=${present}\n`);
    assert.equal(result.stderr, '');
  }
  for (const [present, status] of [['true', 0], ['false', 1]]) {
    const result = spawnSync('bash', ['-e', '-c', live.jobs.probe.steps[0].run], { encoding: 'utf8', env: { PATH: process.env.PATH, QA_SECRET_PRESENT: present } });
    assert.equal(result.status, status);
    assert.equal(result.stdout, `secret-present=${present}\n`);
    assert.equal(result.stderr, '');
  }
});

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'live-qa-workflow-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const put = (file, contents) => { const full = path.join(directory, file); mkdirSync(path.dirname(full), { recursive: true }); writeFileSync(full, contents); return full; };
  put('scripts/live-qa/allowed-scripts.json', JSON.stringify({ [script]: { ticket: 'YPER4-544', boardIds: [] } }));
  put(script, 'export {}');
  return { directory, put };
}

test('launcher accepts reviewed manifest entry with fixed argument-array execution', async t => {
  const { selectScript, playwrightArgs } = await load('scripts/live-qa/run.mjs');
  const { directory } = fixture(t);
  const selected = selectScript('YPER4-544', script, sha, directory);
  assert.equal(selected.script, path.join(directory, script));
  assert.deepEqual(selected.boardIds, []);
  assert.deepEqual(playwrightArgs(selected.script).slice(0, 3), ['test', '--config', 'playwright.config.live-qa.ts']);
  assert.ok(new RegExp(playwrightArgs(selected.script)[3]).test(selected.script));
  const code = source('scripts/live-qa/run.mjs');
  assert.match(code, /shell: false, stdio: 'ignore'/);
  assert.doesNotMatch(code.match(/const keys = \[[^\]]+\]/)[0], /QA_LOGIN|DEBUG|TOKEN/);
});

for (const input of ['../escape.spec.ts', 'e2e/live-qa/../../escape.spec.ts', '-x', '*.spec.ts', '$(whoami)', `${script}\n`, 'e2e/live-qa/YPER4-543.spec.ts']) {
  test(`launcher rejects unsafe input ${JSON.stringify(input)}`, async t => {
    const { selectScript } = await load('scripts/live-qa/run.mjs');
    const { directory } = fixture(t);
    assert.throws(() => selectScript('YPER4-544', input, sha, directory));
  });
}

test('launcher refuses unknown ticket, bad SHA, invalid manifest and symlink escape', async t => {
  const { selectScript } = await load('scripts/live-qa/run.mjs');
  const { directory, put } = fixture(t);
  for (const ticket of ['HTPR-9999', 'YPER4-0', 'YPER4-544\n', '-YPER4-544']) assert.throws(() => selectScript(ticket, `e2e/live-qa/${ticket}.spec.ts`, sha, directory));
  for (const value of ['', 'a'.repeat(39), `${sha}\n`, '-'.repeat(40)]) assert.throws(() => selectScript('YPER4-544', script, value, directory));
  put('scripts/live-qa/allowed-scripts.json', JSON.stringify({ [script]: { ticket: 'YPER4-544', boardIds: [-1] } }));
  assert.throws(() => selectScript('YPER4-544', script, sha, directory));
  put('scripts/live-qa/allowed-scripts.json', JSON.stringify({ [script]: { ticket: 'YPER4-544', boardIds: [] } }));
  const outside = put('outside.spec.ts', 'export {}');
  unlinkSync(path.join(directory, script));
  symlinkSync(outside, path.join(directory, script));
  assert.throws(() => selectScript('YPER4-544', script, sha, directory), /escaped/);
});

test('mutation guard allows listed board and refuses unrelated, conflicting and external writes', async () => {
  const { allowsRequest } = await load('scripts/live-qa/run.mjs');
  const url = 'https://app.hypertask.ai/api/tasks/create';
  assert.equal(allowsRequest('GET', url, null, []), true);
  assert.equal(allowsRequest('POST', url, '{"projectId":6121}', [6121]), true);
  assert.equal(allowsRequest('PATCH', `${url}?boardId=6121`, null, [6121]), true);
  for (const [method, address, body] of [
    ['POST', url, '{"projectId":6122}'], ['POST', url, '{"taskId":1}'], ['POST', url, 'bad json'],
    ['DELETE', `${url}?boardId=6121`, '{"projectId":6122}'], ['POST', 'https://outsider.example/api', '{"projectId":6121}'],
    ['POST', url, '{"boardId":6121,"nested":{"projectId":6122}}'], ['POST', `${url}?boardId=6121&boardId=6122`, null],
  ]) assert.equal(allowsRequest(method, address, body, [6121]), false);
  assert.equal(allowsRequest('POST', url, '{"projectId":6121}', []), false);
  const fixtureCode = source('scripts/live-qa/fixture.ts');
  assert.match(fixtureCode, /context\.route\('\*\*\/\*'/);
  assert.match(fixtureCode, /route\.abort\('blockedbyclient'\)/);
  assert.match(fixtureCode, /routeWebSocket/);
});

test('doctor requires exact live SHA and successful public Production deployment', async () => {
  const { doctor } = await load('scripts/live-qa/run.mjs');
  const fake = ({ buildId = sha, state = 'success', deployments = [{ id: 12, sha, environment: 'Production' }], challenge = false } = {}) => async url => ({
    ok: true, headers: new Headers(challenge ? { 'x-vercel-mitigated': 'challenge' } : {}),
    json: async () => url.endsWith('/api/version') ? { buildId } : url.includes('/statuses') ? [{ state }] : deployments,
  });
  await doctor(sha, fake());
  for (const options of [{ buildId: 'b'.repeat(40) }, { state: 'failure' }, { deployments: [] }, { challenge: true }]) await assert.rejects(doctor(sha, fake(options)));
});

test('login wrapper and helper keep only QA identity 985, private state and sanitized failure output', async () => {
  const code = ts.transpileModule(source('scripts/live-qa/login.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  for (const fails of [false, true]) {
    const output = [];
    const removed = [];
    let exitCode;
    let renewal;
    vm.runInNewContext(code, {
      exports: {},
      process: { env: { RUNNER_TEMP: '/private' }, umask: value => assert.equal(value, 0o077), stderr: { write: value => output.push(value) }, set exitCode(value) { exitCode = value; } },
      require(name) {
        if (name === 'node:fs') return { rmSync: value => removed.push(value) };
        if (name === './run.mjs') throw new Error('Unexpected launcher');
        if (name === '../../e2e/smoke/lib/qa-session') return { renewQaSession: (base, state) => {
          assert.equal(base, 'https://app.hypertask.ai');
          assert.equal(state, '/private/live-qa-private/state.json');
          renewal = fails ? Promise.reject(new Error('Cookie: SENTINEL_SESSION password=SENTINEL_PASSWORD')) : Promise.resolve();
          return renewal;
        } };
        return require(name);
      },
    });
    await renewal.catch(() => {});
    await Promise.resolve();
    assert.equal(exitCode, fails ? 1 : undefined);
    assert.equal(removed.length, fails ? 1 : 0);
    assert.doesNotMatch(output.join(''), /SENTINEL|Cookie|password=/);
    if (fails) assert.match(output.join(''), /^UNREACHABLE: QA login or user 985 verification failed\n$/);
  }
  const helper = source('e2e/smoke/lib/qa-session.ts');
  assert.match(helper, /context\.post\('\/api\/auth\/qa-login'/);
  assert.match(helper, /identity\.json\(\)\)\?\.id !== 985/);
  assert.match(helper, /chmodSync\(storageState, 0o600\)/);
});

test('evidence excludes cookie/report files, requires both media kinds per viewport and refuses symlinks', async t => {
  const { collectEvidence } = await load('scripts/live-qa/evidence.mjs');
  const { directory, put } = fixture(t);
  const results = path.join(directory, 'results');
  const evidence = path.join(directory, 'evidence');
  const metadata = { ticket: 'YPER4-544', script, codeSha: sha, deploySha: sha, runId: '1', attempt: '1' };
  for (const project of ['desktop', 'phone']) {
    put(`results/case-${project}/shot.png`, Buffer.from('89504e470d0a1a0a', 'hex'));
    put(`results/case-${project}/video.webm`, Buffer.from('1a45dfa3', 'hex'));
  }
  put('results/state.json', '{"cookie":"SENTINEL_SESSION"}');
  put('results/error-context.md', 'Cookie: SENTINEL_SESSION');
  assert.equal(collectEvidence(results, evidence, 'success', metadata), 4);
  assert.equal(readdirSync(evidence).length, 6);
  for (const file of ['metadata.json', 'proof.md']) assert.doesNotMatch(readFileSync(path.join(evidence, file), 'utf8'), /SENTINEL/);
  assert.equal(statSync(path.join(evidence, 'metadata.json')).mode & 0o777, 0o600);
  unlinkSync(path.join(results, 'case-phone/video.webm'));
  assert.throws(() => collectEvidence(results, evidence, 'success', metadata), /Missing required media/);
  assert.equal(collectEvidence(path.join(directory, 'missing'), evidence, 'failure', metadata), 0);
  assert.match(readFileSync(path.join(evidence, 'proof.md'), 'utf8'), /FAIL\/UNREACHABLE/);
  symlinkSync(path.join(results, 'state.json'), path.join(results, 'leak.png'));
  assert.throws(() => collectEvidence(results, evidence, 'failure', metadata), /symlink/);
});

test('recipient placeholder and malformed keys fail closed; archive uses age and safe stdin download', async () => {
  const { validateRecipient } = await load('scripts/live-qa/evidence.mjs');
  for (const value of ['age1REPLACE_WITH_PUBLIC_KEY', '', 'age1bad', 'age1' + 'a'.repeat(58) + '\nother-key']) assert.throws(() => validateRecipient(value));
  assert.equal(validateRecipient('age1' + 'a'.repeat(58)), 'age1' + 'a'.repeat(58));
  const code = source('scripts/live-qa/evidence.mjs');
  assert.match(code, /\['tar', \['-cf', archive, '-C', evidence, '\.'\]\]/);
  assert.match(code, /\['age', \['--encrypt', '--recipient', recipient, '--output', encrypted, archive\]\]/);
  assert.match(code, /rmSync\(encrypted, \{ force: true \}\)/);
  const download = source('scripts/live-qa/download.sh');
  assert.match(download, /age --decrypt --identity - --output/);
  assert.match(download, /not member\.isfile\(\)/);
  assert.match(download, /re\.fullmatch/);
  assert.doesNotMatch(download, /extractall|--identity \"?\$/);
});

test('media configuration records video without trace or HAR at desktop and phone sizes', () => {
  const config = source('playwright.config.live-qa.ts');
  assert.match(config, /video: 'on'/);
  assert.match(config, /trace: 'off'/);
  assert.match(config, /serviceWorkers: 'block'/);
  assert.match(config, /width: 1440, height: 900/);
  assert.match(config, /width: 390, height: 844/);
  assert.doesNotMatch(config, /recordHar/);
});

test('wireframe selection and static assets reject traversal, unknown entries and symlink escapes', async t => {
  const { selectWireframe, staticFile, themes, viewports } = await load('scripts/wireframe-capture.mjs');
  const { directory, put } = fixture(t);
  const input = 'docs/wireframes/YPER4-544/index.html';
  put('scripts/wireframe-capture-allowed.json', JSON.stringify({ [input]: { ticket: 'YPER4-544' } }));
  put(input, '<html>public fixture</html>');
  const entry = selectWireframe('YPER4-544', input, directory);
  assert.equal(staticFile(entry.directory, '/index.html'), entry.file);
  assert.deepEqual(themes, ['porcelain', 'graphite', 'amoled', 'dia']);
  assert.deepEqual(viewports, { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } });
  for (const file of ['../index.html', '-x', '*.html', '$(id)', `${input}\n`]) assert.throws(() => selectWireframe('YPER4-544', file, directory));
  assert.throws(() => selectWireframe('HTPR-999', 'docs/wireframes/HTPR-999/index.html', directory));
  for (const file of ['/../outside.html', '/%2e%2e/outside.html', '/%00']) assert.throws(() => staticFile(entry.directory, file));
  const outside = put('outside.html', 'outside');
  symlinkSync(outside, path.join(entry.directory, 'asset.html'));
  assert.throws(() => staticFile(entry.directory, '/asset.html'));
  unlinkSync(entry.file);
  symlinkSync(outside, entry.file);
  assert.throws(() => selectWireframe('YPER4-544', input, directory), /escaped/);
});
