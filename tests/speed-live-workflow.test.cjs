const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const YAML = require('js-yaml');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, '.github/workflows/speed-live.yml'), 'utf8');
const workflow = YAML.load(source);
const job = workflow.jobs.measure;
const step = name => job.steps.find(row => row.name === name);

test('live speed is scheduled and dispatchable only on production, on hosted live-qa with read-only permissions', () => {
  assert.deepEqual(Object.keys(workflow.on).sort(), ['schedule', 'workflow_dispatch']);
  assert.deepEqual(workflow.on.schedule, [{ cron: '35 4 * * *' }]);
  assert.equal(job.if, "github.ref == 'refs/heads/production'");
  assert.equal(job.environment, 'live-qa');
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.equal(job['timeout-minutes'], 60);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(job.permissions, { contents: 'read' });
  assert.deepEqual(workflow.concurrency, { group: 'speed-live', 'cancel-in-progress': false });
  for (const row of job.steps.filter(row => row.uses)) assert.match(row.uses, /@[a-f0-9]{40}$/);
  assert.equal(job.steps.find(row => row.uses?.startsWith('actions/setup-node@')).with['node-version'], 24);
  const privateCheckout = step('Checkout private read-only guard');
  assert.equal(privateCheckout.with.repository, 'hypertask-ai/company-skills');
  assert.equal(privateCheckout.with['ssh-key'], '${{ secrets.COMPANY_SKILLS_DEPLOY_KEY }}');
  assert.equal(privateCheckout.with['persist-credentials'], false);
  assert.match(step('Measure privately and encrypt the single run').env.COMPANY_SKILLS_DIR, /company-skills$/);
});

test('only encrypted single-run data is uploaded, with no secret interpolation or private logs in run commands', () => {
  const upload = step('Upload encrypted run only');
  assert.equal(upload.with.name, 'speed-run-${{ github.run_id }}');
  assert.equal(upload.with['retention-days'], 30);
  assert.equal(upload.with.path, '${{ runner.temp }}/speed-encrypted/run.json.age');
  assert.equal(upload.with['if-no-files-found'], 'error');
  const measure = step('Measure privately and encrypt the single run');
  assert.match(measure.run, /umask 077/);
  assert.match(measure.run, /printf '%s' "\$QA_NORMAL_STORAGE_STATE" > "\$HOME\/\.config\/hypertask-videos\/storageState-qa-normal.json"/);
  assert.match(measure.run, /history.at\(-1\)/);
  assert.match(measure.run, /age -R/);
  assert.match(measure.run, /} > "\$RUNNER_TEMP\/speed-private.log" 2>&1/);
  assert.match(step('Install matching Chromium and age').run, /node_modules\/playwright.*version/);
  assert.match(step('Install matching Chromium and age').run, /install --with-deps chromium/);
  assert.match(step('Install matching Chromium and age').run, /sudo apt-get install -y age/);
  assert.match(step('Remove private plaintext').run, /speed-private.log/);
  assert.match(step('Remove private plaintext').run, /\.local\/state\/speed/);
  for (const row of job.steps.filter(row => row.run)) {
    assert.doesNotMatch(row.run, /\$\{\{\s*secrets\./);
    assert.doesNotMatch(row.run, /\becho\b|set -x|\bcat\b/);
  }
});

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'speed-workflow-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'scripts/speed'), { recursive: true });
  const recipient = path.join(dir, 'scripts/speed/github-age-recipient.txt');
  fs.copyFileSync(path.join(root, 'scripts/speed/github-age-recipient.txt'), recipient);
  const env = { ...process.env, HOME: dir, RUNNER_TEMP: dir, GITHUB_OUTPUT: path.join(dir, 'output'), COMPANY_SKILLS_DEPLOY_KEY: 'fake-key', QA_NORMAL_STORAGE_STATE: 'fake-state' };
  const run = (row, overrides = {}) => spawnSync('bash', ['-e', '-o', 'pipefail', '-c', row.run], { cwd: dir, env: { ...env, ...overrides }, encoding: 'utf8' });
  return { dir, recipient, env, run };
}

test('setup skips separately for each missing piece, never treating the committed placeholder as a recipient', t => {
  const box = sandbox(t);
  const setup = step('Check private setup');
  const cases = [
    [{ COMPANY_SKILLS_DEPLOY_KEY: '' }, 'COMPANY_SKILLS_DEPLOY_KEY'],
    [{ QA_NORMAL_STORAGE_STATE: '' }, 'QA_NORMAL_STORAGE_STATE'],
    [{}, 'age public recipient'],
  ];
  for (const [env, missing] of cases) {
    const result = box.run(setup, env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `::notice::skipped: ${missing}\n`);
    assert.match(fs.readFileSync(box.env.GITHUB_OUTPUT, 'utf8'), /ready=false/);
  }
  fs.writeFileSync(box.recipient, 'age1examplepublicrecipient\n');
  const ready = box.run(setup);
  assert.equal(ready.status, 0);
  assert.equal(ready.stdout, '');
  assert.match(fs.readFileSync(box.env.GITHUB_OUTPUT, 'utf8'), /ready=true/);
  const setupIndex = job.steps.indexOf(setup);
  for (const row of job.steps.slice(setupIndex + 1)) {
    assert.ok(row.if?.includes("steps.setup.outputs.ready == 'true'") || row.if?.includes('steps.measure.outcome'), row.name);
  }
});

test('measurement success and failure keep raw logs private and encrypt only one run; cleanup removes plaintext and final status is generic', t => {
  const box = sandbox(t);
  const bin = path.join(box.dir, 'bin');
  fs.mkdirSync(bin);
  fs.copyFileSync(path.join(root, 'scripts/speed/measure.mjs'), path.join(box.dir, 'scripts/speed/measure.mjs'));
  fs.writeFileSync(box.recipient, 'age1examplepublicrecipient\n');
  fs.writeFileSync(path.join(bin, 'node'), `#!${process.execPath}
    const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
    if (process.argv[2] === 'scripts/speed/measure.mjs') {
      const state = path.join(process.env.HOME, '.local/state/speed');
      fs.mkdirSync(state, { recursive: true });
      fs.writeFileSync(path.join(state, 'history.json'), JSON.stringify([{ sentinel: 'old-run' }, { sentinel: 'PRIVATE-REQUEST-sentinel', status: process.env.FAIL_MEASURE ? 'failed' : 'complete' }]));
      console.log('PRIVATE-SAMPLE-12345'); console.error('PRIVATE-DOM-sentinel');
      process.exit(process.env.FAIL_MEASURE ? 1 : 0);
    }
    const result = cp.spawnSync(process.env.REAL_NODE, process.argv.slice(2), { stdio: 'inherit' });
    process.exit(result.status);
  `, { mode: 0o700 });
  fs.writeFileSync(path.join(bin, 'age'), `#!${process.execPath}
    const fs = require('node:fs'), args = process.argv.slice(2);
    fs.writeFileSync(args[args.indexOf('-o') + 1], 'FAKE-CIPHERTEXT');
    const run = JSON.parse(fs.readFileSync(args.at(-1)));
    if (run.sentinel !== 'PRIVATE-REQUEST-sentinel' || Array.isArray(run)) process.exit(1);
  `, { mode: 0o700 });
  for (const fail of ['', '1']) {
    const env = { PATH: `${bin}:${process.env.PATH}`, REAL_NODE: process.execPath, FAIL_MEASURE: fail };
    const result = box.run(step('Measure privately and encrypt the single run'), env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout + result.stderr, '');
    assert.match(fs.readFileSync(path.join(box.dir, 'speed-private.log'), 'utf8'), /PRIVATE-SAMPLE-12345/);
    assert.equal(fs.statSync(path.join(box.dir, '.config/hypertask-videos/storageState-qa-normal.json')).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(box.dir, 'speed-run.json')).mode & 0o777, 0o600);
    assert.equal(fs.readFileSync(path.join(box.dir, 'speed-encrypted/run.json.age'), 'utf8'), 'FAKE-CIPHERTEXT');
    const status = box.run(step('Status only'), { JOB_STATUS: 'success', MEASUREMENT_STATUS: fail ? 'failed' : 'complete' });
    assert.equal(status.status, fail ? 1 : 0);
    assert.equal(status.stdout, fail ? 'failed\n' : 'complete\n');
    assert.equal(box.run(step('Remove private plaintext')).status, 0);
    for (const name of ['speed-private.log', 'speed-run.json', '.local/state/speed', '.config/hypertask-videos/storageState-qa-normal.json']) assert.equal(fs.existsSync(path.join(box.dir, name)), false);
  }
});
