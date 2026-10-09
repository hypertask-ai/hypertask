const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const ts = require('typescript');
const yaml = require('js-yaml');

const workflow = yaml.load(readFileSync('.github/workflows/prod-health.yml', 'utf8'));
const loginMessage = /not tested: QA login missing\/expired/;

function setupHarness({ state = { cookies: [{ name: 'ht_session', value: 'fixture' }] }, status = 200, userId = 2343, redirected = false, noAccount = false } = {}) {
  const results = [];
  let launched = false;
  const page = {
    goto: async () => ({ status: () => 200 }),
    waitForURL: async () => { if (!redirected) throw Object.assign(new Error('no redirect'), { name: 'TimeoutError' }); },
    url: () => `https://app.hypertask.ai/${redirected ? 'login' : 'inbox'}`,
  };
  const browser = {
    newContext: async () => ({
      request: { get: async () => ({ status: () => status, json: async () => ({ id: userId }) }) },
      newPage: async () => page,
    }),
    close: async () => {},
  };
  const loadedModule = { exports: {} };
  const code = ts.transpileModule(readFileSync('e2e/smoke/global-setup.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    module: loadedModule, exports: loadedModule.exports, __dirname: '/isolated-smoke', Error,
    process: { env: { SMOKE_POSTDEPLOY: '1', HT_QA_NO_ACCOUNT: noAccount ? '1' : '' } },
    console: { log() {} },
    require(name) {
      if (name === '@playwright/test') return { chromium: { launch: async () => { launched = true; return browser; } } };
      if (name === 'node:fs') return {
        mkdirSync() {}, rmSync() {},
        readFileSync() { if (state === null) throw new Error('ENOENT'); return typeof state === 'string' ? state : JSON.stringify(state); },
        writeFileSync(_file, value) { results.push(JSON.parse(value)); },
      };
      if (name === '../../src/lib/auth/session') return { verifySession() { throw new Error('unexpected PR session check'); } };
      if (name === './lib/qa-session') return { renewQaSession: async () => {} };
      if (name === './lib/realtime') return { withRealtime: (route) => route };
      return require(name);
    },
  });
  return {
    run: () => loadedModule.exports.default({ projects: [{ use: { baseURL: 'https://app.hypertask.ai', storageState: 'fixture.json' } }] }),
    results, launched: () => launched,
  };
}

for (const [name, state] of [['missing', null], ['malformed', '{invalid'], ['no cookie', { cookies: [] }]]) {
  test(`${name} QA state fails closed before launching a browser`, async () => {
    const harness = setupHarness({ state });
    await assert.rejects(harness.run(), loginMessage);
    assert.equal(harness.launched(), false);
    assert.equal(harness.results.at(-1).ok, false);
  });
}

for (const status of [401, 403]) {
  test(`server-rejected/expired QA login (${status}) fails without an application verdict`, async () => {
    const harness = setupHarness({ status });
    await assert.rejects(harness.run(), loginMessage);
    assert.equal(harness.results.at(-1).ok, false);
    assert.match(harness.results.at(-1).reason, loginMessage);
  });
}

test('an expired login redirect fails with the clear coverage message', async () => {
  const harness = setupHarness({ redirected: true });
  await assert.rejects(harness.run(), loginMessage);
  assert.equal(harness.results.at(-1).ok, false);
});

for (const userId of [6, 1234]) {
  test(`post-deploy smoke rejects non-QA user ${userId}`, async () => {
    const harness = setupHarness({ userId });
    await assert.rejects(harness.run(), /requires QA user 2343 or 985, never Valentin/);
    assert.equal(harness.results.at(-1).ok, false);
  });
}

for (const userId of [2343, 985]) {
  test(`server-authenticated QA user ${userId} is the positive control`, async () => {
    const harness = setupHarness({ userId });
    await harness.run();
    assert.equal(harness.results.at(-1).ok, true);
  });
}

test('demo no-account setting cannot bypass production login', async () => {
  const harness = setupHarness({ noAccount: true, status: 401 });
  await assert.rejects(harness.run(), loginMessage);
});

test('missing Actions secret fails the job rather than warning and reporting green', () => {
  const step = workflow.jobs.smoke.steps.find((item) => item.id === 'provisioned');
  assert.notEqual(step['continue-on-error'], true);
  assert.equal(step.env.QA_LOGIN_EMAIL, '${{ secrets.QA_LOGIN_EMAIL }}');
  assert.equal(step.env.QA_LOGIN_PASSWORD, '${{ secrets.QA_LOGIN_PASSWORD }}');
  for (const [state, expectedStatus] of [['', 1], ['fixture-state', 0]]) {
    const output = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', step.run], {
      encoding: 'utf8', env: { ...process.env, QA_LOGIN_EMAIL: state, QA_LOGIN_PASSWORD: state, GITHUB_OUTPUT: '/dev/null', GITHUB_STEP_SUMMARY: '/dev/null' },
    });
    assert.equal(output.status, expectedStatus, output.stdout + output.stderr);
    if (expectedStatus) assert.match(output.stdout, /QA renewal credentials are missing/);
  }
  assert.ok(!workflow.jobs.smoke.steps.some((item) => /skipping smoke QA/.test(item.run || '')));
  const smoke = workflow.jobs.smoke.steps.find((item) => item.id === 'smoke');
  assert.equal(smoke.env.SMOKE_POSTDEPLOY, '1');
  assert.match(smoke.run, /--project Desktop --project Mobile/);
});

test('post-deploy smoke pins the persistent QA 985 fixture instead of the old QA 2343 vars', () => {
  const { env } = workflow.jobs.smoke.steps.find((item) => item.id === 'smoke');
  assert.equal(env.SMOKE_BOARD_PATH, '/project?id=6121&surface=board');
  assert.equal(env.SMOKE_TASK_PATH, '/detail/project-6121/1');
  const boardId = new URL(env.SMOKE_BOARD_PATH, env.SMOKE_BASE_URL).searchParams.get('id');
  assert.equal(env.SMOKE_TASK_PATH.split('/')[2], `project-${boardId}`);
});

test('smoke setup generates Prisma after npm ci and fails closed if generation fails', () => {
  const step = workflow.jobs.smoke.steps.find((item) => item.id === 'setup-npm');
  const directory = mkdtempSync(path.join(tmpdir(), 'smoke-prisma-'));
  try {
    for (const command of ['npm', 'npx']) {
      writeFileSync(path.join(directory, command), `#!/bin/sh\nprintf '%s\\n' '${command} '"$*" >> "$COMMAND_LOG"\nif [ '${command}' = npx ]; then exit "$GENERATE_STATUS"; fi\n`, { mode: 0o700 });
    }
    for (const status of [0, 1]) {
      const log = path.join(directory, `commands-${status}.log`);
      const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', step.run], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, COMMAND_LOG: log, GENERATE_STATUS: String(status) },
      });
      assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), ['npm ci', 'npx prisma generate']);
      assert.equal(result.status, status, result.stdout + result.stderr);
    }
    assert.equal(step['continue-on-error'], true);
    const preflight = workflow.jobs.smoke.steps.find((item) => item.name === 'Record a setup failure as unrunnable');
    assert.match(preflight.if, /steps\.setup-npm\.outcome == 'failure'/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('branch smoke proof skips all board-writing jobs with the documented dispatch input', () => {
  const context = {
    github: { event_name: 'workflow_dispatch', ref: 'refs/heads/yper4-181-postdeploy-login' },
    inputs: { provision_core_actions: true },
    needs: { health: { result: 'skipped', outputs: {} }, smoke: { outputs: {} }, 'core-actions': { outputs: {} } },
    cancelled: () => false,
  };
  for (const name of ['core-actions', 'provision-core-actions', 'rollback', 'glm-qa']) {
    const expression = workflow.jobs[name].if.slice(3, -2);
    assert.equal(vm.runInNewContext(expression, context), false, name);
  }
  assert.equal(vm.runInNewContext(workflow.jobs.smoke.if.slice(3, -2), context), true);
});

test('post-deploy config cannot silently skip an unconfigured board or task', () => {
  const code = ts.transpileModule(readFileSync('playwright.config.smoke.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  for (const paths of [{}, { SMOKE_BOARD_PATH: '/detail/project-2153' }, { SMOKE_TASK_PATH: '/detail/project-2153/1' }]) {
    assert.throws(() => vm.runInNewContext(code, {
      exports: {}, process: { env: { SMOKE_POSTDEPLOY: '1', SMOKE_BASE_URL: 'https://app.hypertask.ai', ...paths } },
      require: () => ({ defineConfig: (config) => config, devices: {} }),
    }), /not tested: SMOKE_BOARD_PATH and SMOKE_TASK_PATH are required/);
  }
});

function journeyHarness(failure) {
  const source = readFileSync('e2e/smoke/prod.spec.ts', 'utf8');
  const start = source.indexOf("    if (process.env.SMOKE_POSTDEPLOY === '1' && view.name === 'kanban board')");
  const end = source.indexOf('    expect(pageErrors,', start);
  assert.ok(start > 0 && end > start);
  const code = ts.transpileModule(`async function journey(page, expect, testInfo) { ${source.slice(start, end)} } journey`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let clicked = false;
  let elapsed = 0;
  let load;
  const title = 'QA smoke fixture';
  const pathname = '/detail/project-2153/1';
  const link = { visible: true, locator: () => ({ innerText: async () => title }), click: async () => { clicked = true; if (failure === 'reload') load(); } };
  const titleInput = {
    isVisible: async () => clicked && failure !== 'never opens' && !(failure === 'disappears' && elapsed >= 1_000),
    inputValue: async () => title,
  };
  const body = { count: async () => failure === 'body disappears' && elapsed >= 1_000 ? 0 : 1 };
  const page = {
    locator: (selector) => selector === '#title-input' ? titleInput : selector === '#description-input' ? body : { first: () => link },
    on: (_event, callback) => { load = callback; },
    url: () => `https://app.hypertask.ai${failure === 'wrong ticket' ? '/detail/project-2153/2' : pathname}`,
    waitForTimeout: async (duration) => { elapsed += duration; },
  };
  const expect = (actual, message) => ({
    toBe: (value) => assert.equal(actual, value, message),
    toBeGreaterThan: (value) => assert.ok(actual > value, message),
    not: { toBe: (value) => assert.notEqual(actual, value, message) },
    toBeVisible: async () => assert.ok(actual === link ? link.visible : await actual.isVisible(), message),
    toHaveValue: async (value) => assert.equal(await actual.inputValue(), value, message),
    toBeAttached: async () => assert.ok(await actual.count() > 0, message),
  });
  const journey = vm.runInNewContext(code, {
    process: { env: { SMOKE_POSTDEPLOY: '1', SMOKE_TASK_PATH: pathname } },
    view: { name: 'kanban board' }, URL, Date: { now: () => elapsed }, console: { log() {} },
  });
  return { run: () => journey(page, expect, { project: { name: 'Desktop' } }), clicked: () => clicked, elapsed: () => elapsed };
}

test('real card click journey is a positive control and watches the full retention window', async () => {
  const harness = journeyHarness();
  await harness.run();
  assert.equal(harness.clicked(), true);
  assert.ok(harness.elapsed() >= 10_000);
});

for (const failure of ['never opens', 'disappears', 'body disappears', 'wrong ticket', 'reload']) {
  test(`card journey rejects: ${failure}`, async () => {
    await assert.rejects(journeyHarness(failure).run());
  });
}
