const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { fixture, loader, ctx, session, NOW, FLAG } = require('./htpr-7582-fixtures.cjs');

const principals = [
  ['human bearer', ctx({ agentId: null })],
  ['management bearer', ctx({ agentId: null, management: { keyId: 'key' } })],
  ['team-scoped management bearer', ctx({ agentId: null, management: { keyId: 'key' }, teamScope: { teamId: 'team-1', accessBinding: 'binding-1' } })],
  ['write agent', ctx()],
  ['read agent', ctx({ agentRole: 'read' })],
  ['admin agent', ctx({ agentRole: 'admin' })],
  ['team-scoped agent', ctx({ teamScope: { teamId: 'team-1', accessBinding: 'binding-1' } })],
];
const archivePath = 'src/lib/mcp/operations/inbox/archive/operation.ts';
const unarchivePath = 'src/lib/mcp/operations/inbox/unarchive/operation.ts';
const seenPath = 'src/app/api/mcp/inbox/seen/route.ts';
const request = body => new NextRequest('https://app.hypertask.ai/api/mcp/inbox/archive', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
function handlers(f, auth) {
  return loader({ ...f.stubs,
    '@/lib/mcp/routeWrapper': { wrapMcpRoute: run => run, checkMcpRouteRateLimit: async () => null, validateMcpRouteAuth: async () => auth },
    '@/lib/mcp/auth': { createUnauthorizedResponse: () => { throw Error('unexpected authentication refusal'); } },
    '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash: () => {} },
    '@/utils/controllers/notifications/boardAccess': { notificationBoardAccessWhere: () => ({}) },
    '@/lib/mcp/tasks/agentMutationFence': { lockTaskTeamScope: async () => {}, TaskTeamScopeError: class extends Error {} },
    '@/pages/api/queues/inboxQueue': {
      cancelInboxReminderJob: async () => {}, cancelInboxReminderRevisionJob: async () => {},
      cancelLegacyInboxReminderJobIfSafe: async () => {}, scheduleInboxReminderJob: async () => {},
    },
    '@/utils/controllers/tasks/myTasksSnooze': { syncMyTasksSnoozeFromReminder: async () => {} },
  });
}
function ordinary(f, status = 'Normal') {
  f.state.notifications.push({ id: 90, userId: 6, agentId: null, type: 'Comment', taskId: 11, projectId: 15, seen: false, status, archivedAt: null });
  return f.state.notifications.at(-1);
}
for (const [name, auth] of principals) {
  test(`generic MCP archive skips board-access requests for ${name}`, async () => {
    const f = fixture(); await f.create(); const normal = ordinary(f);
    f.state.notifications.push({ ...normal, id: 91 });
    const response = await handlers(f, auth)(archivePath).POST(request({ notification_ids: [1, 90] }));
    assert.equal(response.status, 200); assert.equal((await response.json()).archived_count, 1);
    assert.equal(f.state.notifications[0].status, 'Normal'); assert.equal(f.state.notifications[0].seen, false);
    assert.equal(normal.status, 'Archive'); assert.equal(f.state.notifications[2].status, 'Deleted');
    assert.equal(f.state.requests[0].status, 'pending'); assert.equal(f.state.grants, 0);
  });
  test(`generic MCP restore skips board-access requests for ${name}`, async () => {
    const f = fixture(); await f.create(); f.state.notifications[0].status = 'Archive'; const normal = ordinary(f, 'Archive');
    const response = await handlers(f, auth)(unarchivePath).POST(request({ notification_ids: [1, 90] }));
    assert.equal(response.status, 200); assert.equal((await response.json()).unarchived_count, 1);
    assert.equal(f.state.notifications[0].status, 'Archive'); assert.equal(normal.status, 'Normal');
  });
  test(`generic MCP seen skips board-access requests for ${name}`, async () => {
    const f = fixture(); await f.create(); const normal = ordinary(f);
    const response = await handlers(f, auth)(seenPath).POST(request({ notification_ids: [1, 90] }));
    assert.equal(response.status, 200); assert.equal((await response.json()).seen_count, 1);
    assert.equal(f.state.notifications[0].seen, false); assert.equal(normal.seen, true);
  });
  test(`generic MCP reminder refuses board-access selection for ${name}`, async () => {
    const f = fixture(); await f.create(); ordinary(f);
    const response = await handlers(f, auth)(archivePath).POST(request({ notification_ids: [1, 90], remind_at: new Date(Date.now() + 60000).toISOString() }));
    assert.equal(response.status, 404);
    assert.ok(f.state.notifications.every(row => row.status === 'Normal'));
    assert.equal(f.state.requests[0].status, 'pending');
  });
}
test('generic MCP reminder still archives ordinary tasks and saves reminders', async () => {
  const f = fixture(); await f.create(); const normal = ordinary(f);
  const reminders = [];
  f.db.reminder = { findMany: async () => [], create: async ({ data }) => { const row = { id: 1, ...data }; reminders.push(row); return row; } };
  const response = await handlers(f, ctx())(archivePath).POST(request({ notification_ids: [90], remind_at: new Date(Date.now() + 60000).toISOString() }));
  assert.equal(response.status, 200); assert.equal((await response.json()).reminder_count, 1);
  assert.equal(reminders.length, 1); assert.equal(normal.status, 'Archive');
  assert.equal(f.state.notifications[0].status, 'Normal');
});
test('human request controls refuse flag-off archive, restore, seen and unseen', async () => {
  for (const change of [{ status: 'Archive' }, { status: 'Normal' }, { seen: true }, { seen: false }]) {
    const f = fixture(); await f.create(); f.state.flag = false;
    const before = structuredClone(f.state.notifications[0]);
    await assert.rejects(f.service.mutateBoardAccessNotification(session(), 1, null, change), error => error.code === 'feature_disabled');
    assert.deepEqual(f.state.notifications[0], before);
  }
});
test('human request controls still permit flag-on archive, restore, seen and unseen', async () => {
  const f = fixture(); await f.create(); f.state.requests[0].expiresAt = new Date(Date.now() + 60000);
  for (const change of [{ status: 'Archive' }, { status: 'Normal' }, { seen: true }, { seen: false }]) {
    await f.service.mutateBoardAccessNotification(session(), 1, null, change);
    for (const [key, value] of Object.entries(change)) assert.equal(f.state.notifications[0][key], value);
  }
  assert.equal(f.state.requests[0].status, 'pending'); assert.equal(f.state.grants, 0);
});

function aiTools(f) {
  const load = loader({ ...f.stubs,
    ai: { tool: definition => definition },
    '@/lib/ai/tools/execution': { withToolErrors: run => run },
    '@/lib/ai/tools/helpers': { sanitizeForJson: value => value },
    '@/lib/ai/bulkConfirmation': { requireCrossMessageConfirmation: async () => 'confirmed' },
    './inboxListReceipt': { inboxListCoversBatch: async () => true, readPendingInboxArchive: async () => null, recordPendingInboxArchive: async () => {} },
  });
  const context = { user: { id: 6 }, actingAgentId: null, sendStatus() {}, confirmationSessionId: 'offline' };
  return {
    archive: load('src/lib/ai/tools/inboxArchive.ts').createInboxArchiveTool(context).hypertask_inbox_archive.execute,
    restore: load('src/lib/ai/tools/inboxUnarchive.ts').createInboxUnarchiveTool(context).hypertask_inbox_unarchive.execute,
  };
}
test('AI archive and restore skip request notifications in legacy and confirmed batch paths', async () => {
  for (const batches of [false, true]) {
    const f = fixture(); await f.create(); ordinary(f); f.state.flag = batches;
    const tools = aiTools(f);
    const input = { notification_ids: [1, 90], list_tokens: [], confirmed: true };
    const mixed = await tools.archive(input);
    assert.equal(mixed.success, !batches);
    assert.equal(f.state.notifications[0].status, 'Normal');
    if (batches) assert.equal(f.state.notifications[1].status, 'Normal');
    const result = await tools.archive({ ...input, notification_ids: [90] });
    assert.equal(result.success, true);
    assert.equal(f.state.notifications[1].status, 'Archive');
    f.state.notifications[0].status = 'Archive';
    assert.equal((await tools.restore({ notification_ids: [1, 90] })).unarchived_count, 1);
    assert.equal(f.state.notifications[0].status, 'Archive');
    assert.equal(f.state.notifications[1].status, 'Normal');
  }
});
test('Inbox Zero undo cannot restore request notifications but still restores task notifications', async () => {
  const f = fixture(); await f.create(); f.state.notifications[0].status = 'Archive'; ordinary(f, 'Archive');
  const load = loader({ ...f.stubs, '@/lib/auth/getSessionUser': { getSessionUser: async () => session({ agentId: 'agent-1' }) } });
  const response = await load('src/app/api/notifications/inbox-zero/undo/route.ts').POST(request({ notificationIds: [1, 90] }));
  assert.equal(response.status, 200); assert.equal((await response.json()).restoredCount, 1);
  assert.equal(f.state.notifications[0].status, 'Archive'); assert.equal(f.state.notifications[1].status, 'Normal');
});
