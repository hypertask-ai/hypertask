const assert = require('node:assert/strict');
const test = require('node:test');
const { NextRequest } = require('next/server');
const { fixture } = require('./helpers/agent-board-scope.cjs');

const teamFlag = 'htpr-8413-board-team-id';
const pageFlag = 'htpr-8018-project-page-size';
const request = () => new NextRequest('https://app.hypertask.ai/api/mcp/projects');

function projectsRoute(teamEnabled) {
  const f = fixture();
  const crashes = [];
  const GET = f.load('src/lib/mcp/operations/projects/operation.ts', {
    '@/lib/flags/keys': { HTPR_8018_PROJECT_PAGE_SIZE_FLAG: pageFlag },
    '@/lib/flags/definitions/htpr-8413-board-team-id': { HTPR_8413_BOARD_TEAM_FLAG: teamFlag },
    '@/lib/flags': {
      isFeatureEnabled: async (requested, userId) => {
        assert.equal(userId, f.user.id);
        if (requested === teamFlag) return teamEnabled;
        assert.equal(requested, pageFlag);
        return true;
      },
    },
    '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash: (_request, error) => crashes.push(error) },
  }).GET;
  return { ...f, GET, crashes };
}

test('a board read names its team only while the switch is on', async () => {
  const on = projectsRoute(true);
  const onBody = await (await on.GET(request())).json();
  assert.deepEqual(onBody.projects.map(project => [project.id, project.teamId]), [[15, 'team'], [4060, 'team']]);
  assert.equal(onBody.total, 2);
  assert.deepEqual(on.crashes, []);

  const off = projectsRoute(false);
  const offBody = await (await off.GET(request())).json();
  assert.deepEqual(offBody.projects.map(project => project.id), [15, 4060]);
  for (const project of offBody.projects) assert.equal('teamId' in project, false, 'the switch off removes the field');
  assert.deepEqual(off.crashes, []);
});

test('the rest of the board read is unchanged with the switch on', async () => {
  const f = projectsRoute(true);
  const body = await (await f.GET(request())).json();
  const [first] = body.projects;
  assert.equal(first.name, 'Board 15');
  assert.equal(first.title, 'Board 15');
  assert.equal(first.status, 'Normal');
  assert.equal(first.ownerId, f.user.id);
  assert.deepEqual(body.projects.map(project => project.id), [15, 4060]);
  assert.equal(body.limit, 50);
  assert.equal(body.nextCursor, null);
  assert.deepEqual(f.crashes, []);
});
