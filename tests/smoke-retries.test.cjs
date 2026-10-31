const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');

function runFailOnceProbe(mode) {
  const directory = mkdtempSync(path.join(tmpdir(), 'smoke-retries-'));
  try {
    writeFileSync(path.join(directory, 'playwright.config.cjs'), `
const { loadModule } = require(${JSON.stringify(path.resolve('tests/helpers/loadModule.cjs'))});
const config = loadModule(${JSON.stringify(path.resolve('playwright.config.smoke.ts'))}).default;
exports.default = {
  ...config,
  testDir: __dirname,
  globalSetup: undefined,
  workers: 1,
  reporter: [['json']],
  projects: config.projects.map(project => ({
    ...project, testMatch: /retry.spec.cjs/, dependencies: [], grep: undefined,
  })),
};
`);
    writeFileSync(path.join(directory, 'retry.spec.cjs'), `
const { test, expect } = require(${JSON.stringify(require.resolve('@playwright/test'))});
test('fails first attempt, passes only on retry', async ({}, testInfo) => {
  expect(testInfo.retry).toBe(1);
});
`);
    const result = spawnSync(process.execPath, [
      require.resolve('@playwright/test/cli'), 'test', '-c', path.join(directory, 'playwright.config.cjs'),
      ...(mode === 'postdeploy' ? ['--project', 'Desktop', '--project', 'Mobile'] : []),
    ], {
      cwd: directory,
      env: {
        ...process.env,
        BASE_URL: 'http://127.0.0.1:3100',
        SMOKE_BOARD_PATH: '/project?id=1&surface=board',
        SMOKE_DEMO_BOARD_PATH: '/project?id=2&surface=board',
        SMOKE_TASK_PATH: '/detail/project-1/1',
        BROWSER_SMOKE_PR: mode === 'pr' ? '1' : '',
        SMOKE_POSTDEPLOY: mode === 'postdeploy' ? '1' : '',
        PLAYWRIGHT_JSON_OUTPUT_NAME: '',
        PLAYWRIGHT_JSON_OUTPUT_FILE: '',
      },
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.ifError(result.error);
    return { status: result.status, report: JSON.parse(result.stdout) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function attempts(report) {
  return report.suites.flatMap(suite => suite.specs.flatMap(spec => spec.tests.map(result => ({
    project: result.projectName,
    status: result.status,
    attempts: result.results.map(attempt => attempt.status),
  }))));
}

test('PR smoke fails on the first failure in every project, without a hidden retry pass', () => {
  const workflow = yaml.load(readFileSync('.github/workflows/ci-tests.yml', 'utf8'));
  for (const key of ['browser-smoke-desktop', 'browser-smoke-mobile']) {
    const step = workflow.jobs[key].steps.find(step => step.run?.includes('npx playwright test'));
    assert.equal(step.env.BROWSER_SMOKE_PR, '1', key);
    assert.doesNotMatch(step.run, /--retries/, key);
  }
  const { status, report } = runFailOnceProbe('pr');
  assert.equal(status, 1);
  const results = attempts(report);
  assert.equal(results.length, report.config.projects.length);
  for (const result of results) {
    assert.deepEqual(result.attempts, ['failed'], result.project);
    assert.equal(result.status, 'unexpected', result.project);
  }
});

test('post-deploy Desktop and Mobile still pass after their second attempt', () => {
  const workflow = yaml.load(readFileSync('.github/workflows/prod-health.yml', 'utf8'));
  const step = workflow.jobs.smoke.steps.find(step => step.id === 'smoke');
  assert.equal(step.env.SMOKE_POSTDEPLOY, '1');
  assert.doesNotMatch(step.run, /--retries/);
  const { status, report } = runFailOnceProbe('postdeploy');
  assert.equal(status, 0);
  assert.deepEqual(attempts(report), ['Desktop', 'Mobile'].map(project => ({
    project, status: 'flaky', attempts: ['failed', 'passed'],
  })));
});
