const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./task-route-loader.cjs');

function fixture({ enabled = true, sourceAllowed = true, targetAllowed = true, targetVisible = true, partial = false, refuse = false, cleanupFailure = false, planFailure = false } = {}) {
  const tasks = [
    { id: 1, parentTaskId: null, projectId: 10 },
    { id: 2, parentTaskId: 1, projectId: 10 },
    { id: 3, parentTaskId: 2, projectId: 10 },
    { id: 4, parentTaskId: null, projectId: 10 },
  ];
  const calls = [];
  const prisma = {
    project: { findFirst: async () => sourceAllowed ? { id: 10 } : null },
    section: { findFirst: async ({ where }) => targetAllowed && (where.visibility === undefined || where.visibility === targetVisible) ? { id: 20 } : null },
    task: { findFirst: async ({ where }) => tasks.find(t => t.id === where.id && t.projectId === where.projectId) ?? null,
      findMany: async ({ where }) => where.id
      ? tasks.filter(t => where.id.in.includes(t.id) && t.projectId === where.projectId).map(({ id }) => ({ id }))
      : tasks.filter(t => t.projectId === where.projectId).map(({ id, parentTaskId }) => ({ id, parentTaskId })) },
  };
  const route = load('src/lib/api/task-writes/bulk-move-board.ts', {
    './route': { taskWriteRoute: options => async body => options.operation(body, { session: { userId: 6, teamScope: null }, currentUser: { id: 6 } }) },
    '@/lib/flags': { isFeatureEnabled: async () => enabled },
    '@/lib/flags/definitions/htpr-8737-bulk-move-board': { HTPR_8737_BULK_MOVE_BOARD_FLAG: 'flag' },
    '@/lib/auth/sessionUserRecord': {},
    '@/lib/prisma': { default: prisma, ...prisma },
    '@/utils/controllers/projects/getAllIncludes': { taskWriteAccessWhere: () => ({}) },
    '@/lib/planLimits': { isPlanLimitReachedError: error => error?.code === 'PLAN_LIMIT_REACHED' },
    '@/lib/realtime/server': { broadcastBoardChange: async () => {} },
    '@/utils/controllers/tasks/moveToDifferentBoard': { moveTaskToDifferentBoard: async ({ taskId }) => {
      calls.push(taskId);
      if (refuse && taskId === 1) return { success: false, statusCode: 403, error: 'No permission to move this ticket.' };
      if (planFailure && taskId === 1) throw { code: 'PLAN_LIMIT_REACHED', message: 'Upgrade to move more tickets.' };
      if (taskId === 1) {
        tasks[0].projectId = 20;
        if (partial) throw new Error('subtask refused');
        tasks[1].projectId = 20;
        tasks[2].projectId = 20;
        if (cleanupFailure) throw new Error('cleanup failed');
      } else if (taskId === 4) tasks[3].projectId = 20;
      return { success: true };
    } },
  }).POST;
  return { route, tasks, calls };
}

const body = { ids: [3, 1, 2, 4, 4], sourceProjectId: 10, projectId: 20, sectionId: 20 };

test('bulk moves each selected family once and preserves hierarchy', async () => {
  const f = fixture();
  const response = await f.route(body);
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls, [1, 4]);
  assert.deepEqual((await response.json()).failedIds, []);
  assert.deepEqual(f.tasks.map(t => [t.id, t.projectId, t.parentTaskId]), [[1,20,null],[2,20,1],[3,20,2],[4,20,null]]);
});

test('only a visible destination column accepts moves', async () => {
  const hidden = fixture({ targetVisible: false });
  assert.equal((await hidden.route(body)).status, 404);
  assert.deepEqual(hidden.calls, []);
  assert.ok(hidden.tasks.every(t => t.projectId === 10));

  const visible = fixture({ targetVisible: true });
  assert.equal((await visible.route(body)).status, 200);
  assert.deepEqual(visible.calls, [1, 4]);
});

test('partial tree failure reports actual selected membership and continues', async () => {
  const f = fixture({ partial: true });
  const result = await (await f.route(body)).json();
  assert.deepEqual(result.movedIds.sort(), [1, 4]);
  assert.deepEqual(result.failedIds, [3, 2]);
  assert.ok(result.issues.find(issue => issue.id === 1).message.includes("partially moved"));
  assert.deepEqual(f.calls, [1, 4]);
});

test('per-tree refusal leaves that family while another tree moves', async () => {
  const f = fixture({ refuse: true });
  const result = await (await f.route(body)).json();
  assert.deepEqual(result.movedIds, [4]);
  assert.deepEqual(result.failedIds, [3, 1, 2]);
  assert.ok(result.issues.every(issue => issue.message.includes("permission")));
  assert.deepEqual(f.calls, [1, 4]);
});

test('board permissions refuse unauthorized moves and allow authorized moves at the same endpoint', async () => {
  for (const options of [{ enabled: false }, { sourceAllowed: false }, { targetAllowed: false }]) {
    const f = fixture(options);
    assert.equal((await f.route(body)).status, 404);
    assert.deepEqual(f.calls, []);
    assert.ok(f.tasks.every(t => t.projectId === 10));
  }

  const allowed = fixture();
  const response = await allowed.route(body);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).failedIds, []);
  assert.deepEqual(allowed.calls, [1, 4]);
  assert.ok(allowed.tasks.every(t => t.projectId === 20));
});


test('cleanup failure warns even when every selected ticket moved', async () => {
  const f = fixture({ cleanupFailure: true });
  const result = await (await f.route(body)).json();
  assert.deepEqual(result.failedIds, []);
  assert.deepEqual(result.movedIds.sort(), [1, 2, 3, 4]);
  assert.ok(result.issues.find(issue => issue.id === 1).message.includes('cleanup may be incomplete'));
});

test('plan failures reach each selected family member', async () => {
  const f = fixture({ planFailure: true });
  const result = await (await f.route(body)).json();
  assert.deepEqual(result.failedIds, [3, 1, 2]);
  assert.ok(result.issues.every(issue => issue.message.includes('Upgrade to move more tickets')));
});
