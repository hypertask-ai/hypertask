const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./task-route-loader.cjs');

const ISSUE = '01a128a7-88f1-7753-b94b-4f8ec8f7cbdf';
const alert = { issue_id: ISSUE, event_id: '0199aa11-bb22-7c33-8d44-000000000001', environment: 'production', timestamp: '2026-10-26T07:46:42Z' };

function fixture() {
  const tasks = [];
  let available = true;
  let failWrite = false;
  const projectQueries = [];
  const tx = {
    task: { findFirst: async ({ where }) => { const task = tasks.find(task => task.description.includes(where.description_.is.content.contains)); return task ? { id: task.id } : null; } },
    project: { findFirst: async (args) => { projectQueries.push(args); return available ? { uniqueIdentifier: 'IGSH', section: [{ id: 4351, section_title: 'Todo' }], labels: [{ id: '2060-infra' }] } : null; } },
  };
  const { recordPostHogDispatchFallback } = load('src/utils/controllers/errors/recordPostHogDispatchFallback.ts', {
    '@/lib/prisma': { default: tx },
    '@/utils/controllers/tasks/createTaskCore': { createProvisionedTaskCore: async options => {
      if (failWrite) throw new Error('write failed');
      const task = { id: tasks.length + 1, ...options };
      tasks.push(task);
      return { task };
    } },
  });
  return { tasks, projectQueries, record: recordPostHogDispatchFallback, available: value => { available = value; }, failWrite: value => { failWrite = value; } };
}

test('fallback persists one machine-authored board incident per alert event, without a GitHub or MCP token', async () => {
  const state = fixture();
  const first = await state.record(alert, 403);
  assert.deepEqual(await state.record(alert, 429), first);
  assert.equal(state.tasks.length, 1);
  const task = state.tasks[0];
  assert.equal(task.projectId, 2060);
  assert.equal(task.userId, 332);
  assert.deepEqual(task.labelIds, ['2060-infra']);
  assert.equal(task.sectionId, 4351);
  assert.equal(task.sectionTitle, 'Todo');
  const query = state.projectQueries[0];
  assert.deepEqual(query.where, { id: 2060, status: 'Normal' });
  assert.deepEqual(query.select.section, { where: { deleted: false, visibility: true, section_title: 'Todo' }, select: { id: true, section_title: true }, take: 1 });
  assert.deepEqual(query.select.labels, { where: { value: { equals: 'Infra', mode: 'insensitive' } }, select: { id: true }, take: 1 });
  assert.match(task.description, new RegExp(`posthog-dispatch-fallback:issue:${ISSUE}:${alert.event_id}`));
  assert.match(task.description, /HTTP 403/);
  await state.record({ ...alert, event_id: '0199aa11-bb22-7c33-8d44-000000000002' }, 429);
  assert.equal(state.tasks.length, 2);
});

test('failed board delivery cannot claim success, and a retry can persist later', async () => {
  const state = fixture();
  state.available(false);
  await assert.rejects(state.record(alert, 429), /board 2060 is unavailable/);
  state.available(true);
  state.failWrite(true);
  await assert.rejects(state.record(alert, 403), /write failed/);
  assert.equal(state.tasks.length, 0);
  state.failWrite(false);
  assert.equal((await state.record(alert, 403)).id, 1);
});
