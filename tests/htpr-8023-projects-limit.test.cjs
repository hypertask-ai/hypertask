const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { fixture } = require('./helpers/agent-board-scope.cjs');

const get = (route, query) => route(new NextRequest(`http://localhost/api/mcp/projects${query}`));
const listProjects = () => fixture().load('src/lib/mcp/operations/projects/operation.ts').GET;

for (const query of ['?limit=0', '?limit=-1', '?limit=abc', '?offset=-1', '?offset=abc']) {
  test(`project list refuses ${query} with a validation error instead of crashing`, async () => {
    const response = await get(listProjects(), query);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'Validation error');
  });
}

test('project list still pages with a valid limit and offset', async () => {
  const route = listProjects();
  const first = await (await get(route, '?limit=1')).json();
  assert.equal(first.success, true);
  assert.equal(first.projects.length, 1);
  assert.equal(first.nextCursor, String(first.projects[0].id));
  const all = await (await get(route, '')).json();
  assert.equal(all.projects.length, 2);
  assert.equal(all.nextCursor, null);
});
