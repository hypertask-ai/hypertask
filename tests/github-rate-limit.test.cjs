const assert = require('node:assert/strict');
const { test } = require('node:test');
const gate = import('../.github/scripts/github-rate-limit.mjs');

const http = (status, headers = '', body = '{}') => ({
  status: status < 400 ? 0 : 1,
  stdout: `HTTP/2.0 ${status} Response\r\nContent-Type: application/json\r\n${headers}\r\n${body}`,
  stderr: status < 400 ? '' : `gh: HTTP ${status}`,
});

test('gh rate-limited response waits until reset then returns only the successful JSON', async () => {
  const { ghApi, createRateLimitBudget } = await gate;
  let clock = 1000000;
  const waits = [];
  let calls = 0;
  const now = () => clock;
  const output = await ghApi(['repos/fixture/repo/pulls'], {
    now, budget: createRateLimitBudget({ now }), log: () => {},
    sleep: async (ms) => { waits.push(ms); clock += ms; },
    exec: (_, args) => {
      assert.deepEqual(args, ['api', '--include', 'repos/fixture/repo/pulls']);
      calls++;
      if (calls === 1) return http(403, 'X-Ratelimit-Remaining: 0\r\nX-Ratelimit-Reset: 1005\r\n', '{"message":"rate limit exceeded"}');
      assert.equal(clock, 1005000);
      return http(200, '', '[{"number":1}]');
    },
  });
  assert.equal(output, '[{"number":1}]');
  assert.equal(calls, 2);
  assert.deepEqual(waits, [5000]);
});

test('too-long reset is a typed no-result skip without waiting or retrying', async () => {
  const { ghApi, createRateLimitBudget } = await gate;
  const now = () => 1000000;
  let calls = 0;
  await assert.rejects(ghApi(['repos/fixture/repo/pulls'], {
    now, budget: createRateLimitBudget({ now }),
    sleep: () => assert.fail('over-budget reset must not sleep'),
    exec: () => { calls++; return http(403, 'X-Ratelimit-Remaining: 0\r\nX-Ratelimit-Reset: 5000\r\n'); },
  }), (error) => error.rateLimited && /skipped: GitHub rate limited until .*next push or pull request/.test(error.message));
  assert.equal(calls, 1);
});

for (const args of [
  ['-X', 'POST'], ['--method', 'POST'], ['-XPOST'], ['--method=POST'],
  ['--input', '-'], ['--input=payload.json'], ['--method', 'GET', '--input', '-'],
  ['-f', 'state=success'], ['--raw-field=state=success'], ['-Fstate=success'],
  ['--field', 'state=success'], ['-X', 'PATCH'], ['--method', 'DELETE'],
]) {
  for (const status of [403, 429]) {
    test(`rate-limited write ${args.join(' ')} HTTP ${status} skips without sleeping or retrying`, async () => {
      const { ghApi } = await gate;
      let calls = 0;
      await assert.rejects(ghApi(['repos/fixture/repo/statuses/sha', ...args], {
        now: () => 1000000,
        sleep: () => assert.fail('writes must not sleep'),
        save: () => assert.fail('writes must not spend the read retry budget'),
        exec: () => {
          calls++;
          return http(status, 'X-Ratelimit-Remaining: 0\r\nX-Ratelimit-Reset: 1005\r\n');
        },
      }), (error) => error.rateLimited && /skipped: GitHub rate limited until 1970-01-01T00:16:45.000Z;/.test(error.message));
      assert.equal(calls, 1, 'no second POST can publish the stale approval');
    });
  }
}

test('a read after the verdict (GH_API_NO_WAIT=1) skips without sleeping, so no check can go stale', async () => {
  const { ghApi } = await gate;
  let calls = 0;
  await assert.rejects(ghApi(['repos/fixture/repo/pulls/42'], {
    env: { GH_API_NO_WAIT: '1' },
    now: () => 1000000,
    sleep: () => assert.fail('post-verdict reads must not sleep'),
    exec: () => { calls++; return http(429, 'Retry-After: 5\r\n'); },
  }), (error) => error.rateLimited);
  assert.equal(calls, 1);
});

test('the shell reaches the post-verdict reads with GH_API_NO_WAIT=1', () => {
  const workflow = require('node:fs').readFileSync(require('node:path').join(__dirname, '../.github/workflows/feature-flag-gate.yml'), 'utf8');
  assert.equal(workflow.match(/GH_API_NO_WAIT=1 gh_api --paginate --slurp "repos\/\$REPO\/pulls\?state=open/g)?.length, 2);
  assert.match(workflow, /GH_API_NO_WAIT=1 gh_api "repos\/\$REPO\/pulls\/\$PR_NUMBER" >"\$current_json"/);
  assert.doesNotMatch(workflow, /gh_api "repos\/\$REPO\/pulls\/\$number"/);
});

for (const args of [[], ['-X', 'GET'], ['--method', 'GET'], ['-XGET'], ['--method=GET']]) {
  test(`read ${args.join(' ') || 'implicit GET'} still waits and retries`, async () => {
    const { ghApi } = await gate;
    let calls = 0;
    const waits = [];
    assert.equal(await ghApi(['repos/fixture/repo/pulls', ...args], {
      now: () => 1000000, log: () => {}, sleep: async (ms) => waits.push(ms),
      exec: () => ++calls === 1 ? http(429, 'Retry-After: 5\r\n') : http(200),
    }), '{}');
    assert.equal(calls, 2);
    assert.deepEqual(waits, [5000]);
  });
}

for (const status of [403, 404, 500]) {
  for (const method of ['GET', 'POST']) {
    test(`non-rate-limit ${method} HTTP ${status} still refused next to rate-limit recovery now allowed`, async () => {
      const { ghApi } = await gate;
      let calls = 0;
      await assert.rejects(ghApi(['repos/fixture/repo/pulls', '--method', method], {
        exec: () => { calls++; return http(status, '', '{"message":"Forbidden"}'); },
        sleep: () => assert.fail('ordinary API failure must not wait'),
      }), new RegExp(`HTTP ${status}`));
      assert.equal(calls, 1);
    });
  }
}

test('rate-limit detection requires 403/429 and a rate-limit signal for 403', async () => {
  const { rateLimitWait } = await gate;
  const headers = (values) => new Map(Object.entries(values));
  const now = 1000000;
  assert.equal(rateLimitWait(403, headers({}), 'Forbidden', now), null);
  assert.equal(rateLimitWait(500, headers({ 'retry-after': '10' }), 'rate limit', now), null);
  assert.equal(rateLimitWait(403, headers({}), 'API rate limit exceeded for installation', now), 60000);
  assert.equal(rateLimitWait(429, headers({}), '', now), 60000);
  assert.equal(rateLimitWait(403, headers({ 'retry-after': '3', 'x-ratelimit-reset': '1008' }), '', now), 8000);
  assert.equal(rateLimitWait(429, headers({ 'retry-after': new Date(now + 9000).toUTCString() }), '', now), 9000);
});

test('wait cap is shared across requests and wall-clock deadline reserves an API timeout', async () => {
  const { createRateLimitBudget } = await gate;
  const now = () => 1000000;
  const budget = createRateLimitBudget({ now });
  budget.reserve(200000);
  assert.throws(() => budget.reserve(41000), /skipped: GitHub rate limited/);
  const restored = createRateLimitBudget({ now, state: budget.state });
  assert.throws(() => restored.reserve(41000), /skipped: GitHub rate limited/);
  assert.throws(() => createRateLimitBudget({ now, timeBudgetMs: 35000 }).reserve(6000), /skipped: GitHub rate limited/);
});

test('included paginated/slurped headers are stripped without altering JSON body data', async () => {
  const { parseGhResponse } = await gate;
  const page = (body) => `HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n${body}`;
  const parsed = parseGhResponse(`[${page('[{"message":"HTTP/2.0 403\\nnot headers"}]')},${page('[]')}]`);
  assert.deepEqual(JSON.parse(parsed.body), [[{ message: 'HTTP/2.0 403\nnot headers' }], []]);
  assert.equal(parsed.status, 200);
});
