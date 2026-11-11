const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./task-route-loader.cjs');

function fixture({ enabled = true, allowed = true, fail = false, paused = false, recurring = false } = {}) {
  let tasks = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, projectId: 15, status: 'Normal', title: `Task ${i}`, userId: 985, updatedByUserIds: [], recurrence: recurring && i < 10 ? 'daily' : null }));
  tasks.push({ id: 51, projectId: 16, status: 'Normal' }, { id: 52, projectId: 15, status: 'Deleted' });
  const writes = [], comments = [], locks = [], background = [], effects = [], rollovers = [];
  let resume;
  const pause = new Promise(resolve => { resume = resolve; });
  const effect = async id => { effects.push(id); if (paused) await pause; };
  const tx = {
    task: {
      findMany: async ({ where }) => structuredClone(tasks.filter(t => allowed && where.id.in.includes(t.id) && t.projectId === where.projectId && (!where.status || where.status.in.includes(t.status)))),
      updateMany: async ({ where, data }) => {
        if (data.status) writes.push([...where.id.in]);
        for (const task of tasks.filter(t => where.id.in.includes(t.id))) {
          if (data.status) Object.assign(task, data);
          else if (!task.updatedByUserIds.includes(985)) task.updatedByUserIds.push(985);
        }
      },
    },
    taskLease: { deleteMany: async () => {} },
    comment: { createMany: async ({ data }) => { if (fail) throw Error('write failed'); comments.push(...data); } },
  };
  const db = {
    user: { findUnique: async () => ({ id: 985, displayName: 'QA', email: 'qa@example.invalid' }) },
    $transaction: async work => {
      const before = structuredClone(tasks);
      try { return await work(tx); } catch (error) { tasks = before; throw error; }
    },
  };
  const route = load('src/lib/api/task-writes/bulk-archive.ts', {
    '@/lib/prisma': { default: db },
    '@/lib/flags': { isFeatureEnabled: async () => enabled },
    '@/lib/auth/agentScope': { withAgentScopeRequest: async (_request, work) => work(), prepareAgentScope: async () => {} },
    '@/lib/auth/getSessionUser': { getSessionUser: async () => null },
    '@/utils/controllers/projects/getAllIncludes': { taskWriteAccessWhere: (user, agent, scope) => { assert.equal(user, 985); assert.equal(agent, null); assert.equal(scope, null); return {}; } },
    '@/lib/mcp/tasks/agentMutationFence': { lockAgentMutationFence: async (_tx, id) => locks.push(id) },
    '@vercel/functions': { waitUntil: promise => background.push(promise) },
    '@/pages/api/queues/duedateQueue': { cancelDueDateJob: effect },
    '@/utils/controllers/tasks/spawnRecurrence': { spawnNextRecurrence: async id => {
      await effect(id);
      tasks.find(task => task.id === id).recurrence = null;
      rollovers.push(id);
    } },
    '@/utils/controllers/turbopuffer/turbopufferHelper': { upsertTaskToTurbopuffer: effect, upsertAllCommentsToTurbopuffer: effect },
    '@/pages/api/queues/FAST/generateSummary': { default: effect },
    '@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove': { default: effect },
    '@/utils/controllers/notifications/broadcastInboxForTask': { broadcastInboxForTask: effect },
    '@/lib/realtime/server': { broadcastBoardChange: async () => {}, broadcastTaskChange: effect },
    '@/lib/mcp/webhooks/outbox': { persistBoardWebhookEvent: async (client, _project, event) => { assert.equal(client, tx); assert.deepEqual(event.data.changes.status, { from: 'Normal', to: 'Archive' }); return []; }, publishBoardWebhookDeliveries: async () => {} },
    '@/lib/agentWebhooks/outbox': { persistAgentTaskUpdatedWebhook: async client => { assert.equal(client, tx); return []; }, publishAgentWebhookDeliveries: async () => {} },
  }).POST;
  const body = { ids: Array.from({ length: 50 }, (_, i) => i + 1), projectId: 15 };
  const call = (data = body, session = { userId: 985, teamScope: null, source: 'better-auth' }) => route({ headers: new Headers(), json: async () => data }, session);
  return { call, body, writes, comments, locks, background, effects, rollovers, resume, get tasks() { return tasks; } };
}

test('50 selected cards commit together before slow indexing or queue work completes', async () => {
  const f = fixture({ paused: true });
  const response = await f.call();
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).archivedIds, f.body.ids);
  assert.deepEqual(f.writes, [f.body.ids]);
  assert.equal(f.tasks.filter(t => t.status === 'Archive').length, 50);
  assert.equal(new Set(f.tasks.slice(0, 50).map(t => t.archivedAt.getTime())).size, 1);
  assert.equal(f.comments.length, 50);
  assert.deepEqual(f.locks, f.body.ids);
  f.resume(); await Promise.all(f.background);
  assert.ok(f.effects.length >= 50);
});

test('all recurrence batches finish before the response can enable Undo', async () => {
  const f = fixture({ paused: true, recurring: true });
  let responded = false;
  const response = f.call().then(value => { responded = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.tasks.filter(t => t.status === 'Archive').length, 50);
  assert.equal(responded, false);
  assert.deepEqual(f.rollovers, []);
  f.resume();
  assert.equal((await response).status, 200);
  assert.deepEqual(f.rollovers, Array.from({ length: 10 }, (_, i) => i + 1));
  assert.equal(f.tasks.filter(t => t.recurrence).length, 0);
  await Promise.all(f.background);
  await f.call();
  await Promise.all(f.background);
  assert.equal(f.rollovers.length, 10);
});

test('missing, foreign-board and deleted IDs fail without resurrecting anything; retry is idempotent', async () => {
  const f = fixture();
  const result = await (await f.call({ ids: [1, 1, 2, 51, 52, 999], projectId: 15 })).json();
  assert.deepEqual(result, { archivedIds: [1, 2], failedIds: [51, 52, 999] });
  assert.equal(f.tasks.find(t => t.id === 51).status, 'Normal');
  assert.equal(f.tasks.find(t => t.id === 52).status, 'Deleted');
  await Promise.all(f.background);
  await f.call({ ids: [1, 2], projectId: 15 });
  await Promise.all(f.background);
  assert.equal(f.comments.length, 2);
  assert.equal(f.effects.filter(id => id === 1).length, f.effects.filter(id => id === 2).length);
});

test('transaction failure rolls back every card and schedules no follow-ups', async () => {
  const f = fixture({ fail: true });
  assert.equal((await f.call()).status, 500);
  assert.equal(f.tasks.filter(t => t.status === 'Archive').length, 0);
  assert.deepEqual(f.background, []);
});

test('flag-off, logged-out, forged-agent and authenticated-agent requests cannot write', async () => {
  const off = fixture({ enabled: false }); assert.equal((await off.call()).status, 404); assert.deepEqual(off.writes, []);
  const f = fixture();
  assert.equal((await f.call(f.body, null)).status, 401);
  assert.equal((await f.call({ ...f.body, agentId: 'forged' })).status, 403);
  assert.equal((await f.call({ ...f.body, agentId: 'agent' }, { userId: 985, agentId: 'agent', teamScope: null, source: 'legacy' })).status, 403);
  await Promise.all(f.background);
  const denied = fixture({ allowed: false });
  assert.deepEqual(await (await denied.call()).json(), { archivedIds: [], failedIds: denied.body.ids });
  assert.equal(denied.comments.length, 0);
  await Promise.all(denied.background);
});

test('invalid and oversized selections are refused before a write', async () => {
  const f = fixture();
  for (const ids of [[], [-1], Array(501).fill(1)]) assert.equal((await f.call({ ids, projectId: 15 })).status, 400);
  assert.deepEqual(f.writes, []);
});
