const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync, mkdtempSync, rmSync, readdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { createRequire } = require('node:module');
const yaml = require('js-yaml');
const reportSize = require('../.github/scripts/pr-size.cjs');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const workflow = yaml.load(readFileSync('.github/workflows/pr-guards-trusted.yml', 'utf8'));
const steps = workflow.jobs['pr-guards-trusted'].steps;
const file = (filename, additions, deletions = 0, extra = {}) => ({ filename, additions, deletions, ...extra });

function fixture(files, overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'pr-size-'));
  const pr = {
    number: 2079, state: 'open', title: 'YPER4-711 [INFRA] Size report', user: { login: 'valentinyeo' },
    head: { sha: 'a'.repeat(40), repo: { full_name: 'hypertask-ai/hypertask' } },
    base: { ref: 'production' }, changed_files: files.length,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0), ...overrides,
  };
  const calls = { comments: [], outputs: {}, warnings: [], failures: [], summaries: [], pageSizes: [] };
  const methods = { files: Symbol('files'), comments: Symbol('comments') };
  const github = {
    rest: {
      pulls: { listFiles: methods.files, get: async () => ({ data: pr }) },
      issues: {
        listComments: methods.comments,
        createComment: async body => calls.comments.push({ type: 'create', ...body }),
        updateComment: async body => calls.comments.push({ type: 'update', ...body }),
      },
    },
    paginate: async (method, options) => {
      calls.pageSizes.push(options.per_page);
      if (method === methods.files) return files;
      assert.equal(method, methods.comments);
      return calls.existing || [];
    },
  };
  const core = {
    setOutput: (key, value) => { calls.outputs[key] = value; },
    info() {}, warning: value => calls.warnings.push(value), setFailed: value => calls.failures.push(value),
    summary: { addRaw: value => ({ write: async () => calls.summaries.push(value) }) },
  };
  const context = { repo: { owner: 'hypertask-ai', repo: 'hypertask' }, runId: 123, payload: { pull_request: pr } };
  return {
    pr, github, core, context, calls, reportDirectory: directory,
    artifact: () => JSON.parse(readFileSync(join(directory, readdirSync(directory)[0]), 'utf8')),
    close: () => rmSync(directory, { recursive: true, force: true }),
  };
}

async function run(files, overrides, verify) {
  const f = fixture(files, overrides);
  try { const result = await reportSize(f); await verify(result, f); }
  finally { f.close(); }
}

test('200-line handwritten control remains passing without a new warning comment', async () => {
  await run([file('src/example.ts', 150, 50)], {}, (result, f) => {
    assert.equal(result.verdict, 'within-cap');
    assert.deepEqual([result.counted, result.ignored, result.wouldBlock], [200, 0, false]);
    assert.deepEqual(f.calls.comments, []);
    assert.deepEqual(f.calls.failures, []);
    assert.equal(f.artifact().sha, 'a'.repeat(40));
  });
});

test('400 is inclusive; 401 reports would-block but does not enforce during observation', async () => {
  for (const n of [400, 401]) await run([file('src/a.ts', n)], {}, (result, f) => {
    assert.equal(result.wouldBlock, n === 401);
    assert.equal(result.counted, n);
    assert.equal(f.calls.comments.length, n === 401 ? 1 : 0);
    assert.deepEqual(f.calls.failures, []);
    assert.equal(f.artifact().mode, 'report-only');
    if (n === 401) {
      assert.match(f.calls.comments[0].body, /Split into stacked PRs; each must build green/);
      assert.match(f.calls.comments[0].body, /size-ok approval not implemented/);
    }
  });
});

test('narrow config excludes generated, lock, snapshot and listed fixtures only', async () => {
  await run([
    file('package-lock.json', 900), file('src/generated/client.ts', 900),
    file('src/flags.generated.ts', 900), file('tests/view.snap', 900),
    file('tests/fixtures/context.json', 900), file('src/fixtures/real-code.ts', 100),
    file('tests/other-fixtures/real-test.cjs', 100), file('src/package-lock.json', 100),
  ], {}, (result, f) => {
    assert.deepEqual([result.counted, result.ignored, result.total, result.wouldBlock], [300, 4500, 4800, false]);
    assert.equal(f.artifact().counted, 300);
  });
});

test('renames crossing an exclusion boundary still count', async () => {
  await run([
    file('tests/fixtures/a.json', 210, 10, { status: 'renamed', previous_filename: 'src/a.ts' }),
    file('src/b.ts', 180, 20, { status: 'renamed', previous_filename: 'tests/fixtures/b.json' }),
    file('tests/fixtures/c.json', 900, 0, { status: 'renamed', previous_filename: 'tests/fixtures/d.json' }),
  ], {}, result => assert.deepEqual([result.counted, result.ignored, result.wouldBlock], [420, 900, true]));
});

test('pagination includes late files rather than measuring only the first page', async () => {
  await run(Array.from({ length: 101 }, (_, n) => file(`src/${n}.ts`, 4)), {}, (result, f) => {
    assert.equal(result.counted, 404);
    assert.equal(result.wouldBlock, true);
    assert.deepEqual(f.calls.pageSizes, [100, 100]);
  });
});

test('partial, truncated, inconsistent and malformed counts leave error evidence, not a false pass', async () => {
  const cases = [
    [[file('src/a.ts', 10)], { changed_files: 2 }],
    [[file('src/a.ts', 10)], { changed_files: 3001 }],
    [[file('src/a.ts', 10)], { changed_files: undefined }],
    [[file('src/a.ts', 10)], { additions: 11 }],
    [[file('src/a.ts', -1)], {}],
    [[file('tests/fixtures/a', 10, 0, { status: 'renamed' })], {}],
  ];
  for (const [files, overrides] of cases) await run(files, overrides, (result, f) => {
    assert.equal(result.verdict, 'error');
    assert.equal(f.artifact().verdict, 'error');
    assert.equal(f.calls.warnings.length, 1);
    assert.deepEqual(f.calls.comments, []);
    assert.deepEqual(f.calls.failures, []);
  });
});

test('changed head cannot publish a stale size comment', async () => {
  const f = fixture([file('src/a.ts', 401)]);
  try {
    f.github.rest.pulls.get = async () => ({ data: { ...f.pr, head: { sha: 'b'.repeat(40) } } });
    const result = await reportSize(f);
    assert.equal(result.verdict, 'stale');
    assert.equal(f.artifact().verdict, 'stale');
    assert.deepEqual(f.calls.comments, []);
  } finally { f.close(); }
});

test('errors remain advisory and preserve run evidence', async () => {
  const f = fixture([file('src/a.ts', 401)]);
  try {
    f.github.paginate = async () => { throw new Error('GitHub unavailable'); };
    const result = await reportSize(f);
    assert.equal(result.verdict, 'error');
    assert.equal(f.artifact().reason, 'GitHub unavailable');
    assert.match(f.calls.summaries[0], /Measurement result: error/);
    assert.deepEqual(f.calls.failures, []);
  } finally { f.close(); }
});

test('existing marker updated once; foreign warning comments remain untouched', async () => {
  const f = fixture([file('src/a.ts', 200)]);
  try {
    f.calls.existing = [
      { id: 10, user: { login: 'attacker' }, body: '<!-- pr-size-warning -->' },
      { id: 11, user: { login: 'github-actions[bot]' }, body: '<!-- pr-size-warning --> old' },
    ];
    await reportSize(f);
    assert.deepEqual(f.calls.comments.map(c => [c.type, c.comment_id]), [['update', 11]]);
    f.calls.existing[1].body = f.calls.comments[0].body;
    await reportSize(f);
    assert.equal(f.calls.comments.length, 1);
  } finally { f.close(); }
});

test('fork behavior stays skipped and still produces an explicit artifact', async () => {
  await run([file('src/a.ts', 401)], { head: { sha: 'a'.repeat(40), repo: { full_name: 'fork/hypertask' } } }, (result, f) => {
    assert.equal(result.verdict, 'skipped');
    assert.equal(f.artifact().verdict, 'skipped');
    assert.deepEqual(f.calls.comments, []);
    assert.deepEqual(f.calls.failures, []);
  });
});

test('actual metadata and size workflow dispatch preserve changed_files and run the reporter', async () => {
  const f = fixture([file('src/a.ts', 401)]);
  const previous = { workspace: process.env.GITHUB_WORKSPACE, metadata: process.env.PR_METADATA, temp: process.env.RUNNER_TEMP };
  try {
    process.env.GITHUB_WORKSPACE = resolve('.');
    process.env.RUNNER_TEMP = f.reportDirectory;
    await new AsyncFunction('github', 'context', 'core', steps.find(s => s.id === 'metadata').with.script)(f.github, f.context, f.core);
    process.env.PR_METADATA = f.calls.outputs.pr;
    await new AsyncFunction('require', 'github', 'context', 'core', steps.find(s => s.id === 'size').with.script)(createRequire(resolve('package.json')), f.github, f.context, f.core);
    assert.equal(f.artifact().counted, 401);
    assert.equal(f.artifact().verdict, 'would-block');
    assert.equal(f.calls.comments.length, 1);
    assert.deepEqual(f.calls.failures, []);
  } finally {
    for (const [key, value] of Object.entries({ GITHUB_WORKSPACE: previous.workspace, PR_METADATA: previous.metadata, RUNNER_TEMP: previous.temp })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    f.close();
  }
});

test('missing or invalid workflow metadata still produces explicit error artifacts and summaries', async () => {
  for (const prMetadata of [undefined, '{invalid']) {
    const f = fixture([file('src/a.ts', 1)]);
    try {
      const result = await reportSize({ ...f, pr: undefined, prMetadata });
      assert.equal(result.verdict, 'error');
      assert.equal(f.artifact().verdict, 'error');
      assert.equal(f.artifact().pr, 2079);
      assert.match(f.calls.summaries[0], /Measurement result: error/);
      assert.deepEqual(f.calls.failures, []);
    } finally { f.close(); }
  }
});

test('rerun attempts preserve distinct measurement artifacts', async () => {
  const f = fixture([file('src/a.ts', 1)]);
  try {
    await reportSize(f);
    f.context.runAttempt = 2;
    await reportSize(f);
    assert.equal(readdirSync(f.reportDirectory).length, 2);
    assert.match(steps.find(s => s.name === 'Save report-only size measurement').with.name, /github\.run_attempt/);
  } finally { f.close(); }
});
