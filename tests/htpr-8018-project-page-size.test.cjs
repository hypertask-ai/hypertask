const assert = require('node:assert/strict');
const test = require('node:test');
const { NextRequest } = require('next/server');
const { fixture } = require('./helpers/agent-board-scope.cjs');

const key = 'htpr-8018-project-page-size';
const request = query => new NextRequest(`https://app.hypertask.ai/api/mcp/projects${query}`);

function projectsRoute(enabled = true) {
  const f = fixture();
  const crashes = [];
  const GET = f.load('src/lib/mcp/operations/projects/operation.ts', {
    '@/lib/flags/keys': { HTPR_8018_PROJECT_PAGE_SIZE_FLAG: key },
    '@/lib/flags': { isFeatureEnabled: async (requested, userId) => {
      assert.equal(requested, key);
      assert.equal(userId, f.user.id);
      return enabled;
    } },
    '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash: (_request, error) => crashes.push(error) },
  }).GET;
  return { ...f, GET, crashes };
}

for (const value of ['0', '-1', 'invalid', '1.5']) {
  test(`invalid page size ${value} uses the normal default and preserves agent scope`, async () => {
    const f = projectsRoute();
    const response = await f.GET(request(`?limit=${value}`));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.projects.map(project => project.id), [15, 4060]);
    assert.equal(body.total, 2);
    assert.equal(body.limit, 50);
    assert.equal(body.nextCursor, null);
    assert.deepEqual(f.crashes, []);
  });
}

for (const enabled of [false, true]) {
  test(`valid sizes retain their page and cap with the fix ${enabled ? 'on' : 'off'}`, async () => {
    const f = projectsRoute(enabled);
    const first = await f.GET(request('?limit=1'));
    assert.equal(first.status, 200);
    const page = await first.json();
    assert.deepEqual(page.projects.map(project => project.id), [15]);
    assert.equal(page.limit, 1);
    assert.equal(page.nextCursor, '15');
    const capped = await f.GET(request('?limit=1000'));
    assert.equal(capped.status, 200);
    const cap = await capped.json();
    assert.equal(cap.limit, 100);
    assert.deepEqual(cap.projects.map(project => project.id), [15, 4060]);
    assert.deepEqual(f.crashes, []);
  });
}

test('a human keeps all accessible boards, and an unassigned agent keeps an empty page', async () => {
  const f = projectsRoute();
  f.state.ctx.agentId = null;
  const human = await f.GET(request('?limit=0'));
  assert.equal(human.status, 200);
  assert.deepEqual((await human.json()).projects.map(project => project.id), [15, 4060, 2128]);
  f.state.ctx.agentId = f.agent.id;
  f.projects.forEach(project => { project.members = []; });
  const empty = await f.GET(request('?limit=0'));
  assert.equal(empty.status, 200);
  const page = await empty.json();
  assert.deepEqual(page.projects, []);
  assert.equal(page.total, 0);
  assert.equal(page.limit, 50);
  assert.equal(page.nextCursor, null);
  assert.deepEqual(f.crashes, []);
});

test('switching the fix off preserves production pagination validation', async () => {
  const f = projectsRoute(false);
  const response = await f.GET(request('?limit=0'));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'Validation error');
  assert.deepEqual(f.crashes, []);
});

for (const enabled of [false, true]) {
  for (const value of ['-1', 'invalid', '1.5', '2147483648']) {
    test(`invalid offset ${value} stays rejected with the fix ${enabled ? 'on' : 'off'}`, async () => {
      const f = projectsRoute(enabled);
      const response = await f.GET(request(`?offset=${value}`));
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error, 'Validation error');
      assert.deepEqual(f.crashes, []);
    });
  }
}
