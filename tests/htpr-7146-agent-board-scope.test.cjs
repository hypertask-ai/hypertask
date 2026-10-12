const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { fixture, access, matches, hydrate } = require('./helpers/agent-board-scope.cjs');

for (const helper of ['getProjectWhere', 'getProjectListingWhere', 'projectContentAccessWhere', 'taskWriteAccessWhere']) {
  test(`${helper}: agent grants only 15/4060, human owner still sees all three boards`, () => {
    const f = fixture();
    const allowed = agentId => f.projects.filter(project => matches(project, access[helper](f.user.id, agentId))).map(project => project.id);
    assert.deepEqual(allowed(f.agent.id), [15, 4060]);
    assert.deepEqual(allowed(null), [15, 4060, 2128]);
    for (const project of f.projects) project.members = [];
    assert.deepEqual(allowed(f.agent.id), []);
    f.projects[2].members = [{ agentId: f.agent.id, status: 'Pending', agent: f.agent }];
    assert.deepEqual(allowed(f.agent.id), []);
    f.projects[2].members[0].status = 'Accepted';
    assert.deepEqual(allowed(f.agent.id), [2128]);
    f.agent.revokedAt = new Date();
    assert.deepEqual(allowed(f.agent.id), []);
    f.agent.revokedAt = null;
    f.agent.userId = 7;
    assert.deepEqual(allowed(f.agent.id), []);
  });
}

test('real task resolver scopes raw IDs, ticket numbers, local numbers, forged boards and removed grants', async () => {
  const f = fixture();
  const { findTaskByIdentifier } = f.load('src/lib/mcp/tasks/resolveTask.ts');
  for (const task of f.tasks) {
    for (const options of [{ task_id: task.id }, { ticket_number: task.ticketNumber }, { project_id: task.projectId, unique_index: task.uniqueIndex }]) {
      const resolved = await findTaskByIdentifier(f.user, options, f.agent.id);
      assert.equal(resolved?.id ?? null, task.projectId === 2128 ? null : task.id);
      assert.equal((await findTaskByIdentifier(f.user, options))?.id, task.id);
    }
  }
  assert.equal(await findTaskByIdentifier(f.user, { task_id: 21280, project_id: 15 }, f.agent.id), null);
  f.projects[0].members = [];
  assert.equal(await findTaskByIdentifier(f.user, { task_id: 150 }, f.agent.id), null);
  f.prisma.task.findFirst = async () => { throw new Error('scope lookup unavailable'); };
  await assert.rejects(findTaskByIdentifier(f.user, { task_id: 150 }, f.agent.id), /unavailable/);
});

test('real task access helper does not authorize an unassigned board for comments or writes', async () => {
  const f = fixture();
  const { userCanAccessTask, taskAccessWhere } = f.load('src/utils/controllers/tasks/assertTaskAccess.ts');
  for (const task of f.tasks) {
    assert.equal(await userCanAccessTask(f.user.id, task.id, f.agent.id), task.projectId !== 2128);
    assert.equal(await userCanAccessTask(f.user.id, task.id), true);
    assert.equal(matches(task, taskAccessWhere(f.user.id, task.id, { agentId: f.agent.id, scope: 'content' })), task.projectId !== 2128);
  }
});

test('real JWT auth rejects present malformed agent claims and revoked agents, absent stays human', async () => {
  process.env.JWT_SECRET = 'scope-test-only-secret';
  const f = fixture();
  const auth = f.load('src/lib/mcp/auth/verifyJwt.ts', {
    '@/lib/mcp/managementKeyTeamScope': {},
  });
  const token = claims => jwt.sign({ userId: f.user.id, ...claims }, process.env.JWT_SECRET, { issuer: 'hypertask', audience: 'mcp-api', jwtid: 'fixture-generation' });
  for (const agentId of ['', ' ', null, 12, false, [], {}]) {
    assert.equal(await auth.validateJwtToken(token({ agentId })), null);
  }
  assert.equal((await auth.validateJwtToken(token({}))).agentId, null);
  const agentToken = token({ agentId: f.agent.id });
  f.agent.mcpTokenJti = 'fixture-generation';
  f.agent.mcpTokenHash = auth.hashAgentToken(agentToken);
  assert.equal((await auth.validateJwtToken(agentToken)).agentId, f.agent.id);
  f.agent.revokedAt = new Date();
  assert.equal(await auth.validateJwtToken(agentToken), null);
});

test('timer services scope running/report even with empty boardIds and the report flag both ways', async () => {
  const f = fixture();
  const entries = f.tasks.map(task => ({ id: task.id, taskId: task.id, userId: f.user.id, task, user: f.user, startedAt: new Date(), endedAt: null, pausedAt: null }));
  f.prisma.timeEntry = { findMany: async args => entries.filter(row => matches(row, args.where)) };
  let reportsEnabled = false;
  const service = f.load('src/lib/timeTracking.ts', {
    '@/lib/flags': { isFeatureEnabled: async () => reportsEnabled },
    '@/lib/timeTrackingPersistence': {},
  });
  assert.deepEqual((await service.listRunning(f.user.id, f.agent.id)).map(row => row.task.projectId), [15, 4060]);
  assert.equal((await service.listRunning(f.user.id)).length, 3);
  for (reportsEnabled of [false, true]) {
    assert.deepEqual((await service.listReport(f.user.id, { agentId: f.agent.id, adminProjectIds: reportsEnabled ? [15, 4060, 2128] : [] })).map(row => row.task.projectId), [15, 4060]);
    assert.deepEqual(await service.listReport(f.user.id, { agentId: f.agent.id, boardId: 2128, adminProjectIds: [] }), []);
    assert.deepEqual((await service.listReport(f.user.id, { agentId: f.agent.id, boardIds: [], adminProjectIds: [] })).map(row => row.task.projectId), [15, 4060]);
    assert.equal((await service.listReport(f.user.id, { adminProjectIds: [] })).length, 3);
  }
  f.projects.forEach(project => { project.members = []; });
  assert.deepEqual(await service.listRunning(f.user.id, f.agent.id), []);
  assert.deepEqual(await service.listReport(f.user.id, { agentId: f.agent.id, adminProjectIds: [] }), []);
});

test('presence service hides denied-board sessions and lease titles, including removed and zero grants', async () => {
  const f = fixture();
  const sessions = f.tasks.map(task => ({ task, agentId: `other-${task.projectId}`, agent: { id: `other-${task.projectId}`, displayName: 'Other', photoURL: null }, lastSeenAt: new Date() }));
  const leases = sessions.map(row => ({ ...row, heartbeatAt: new Date(), expiresAt: new Date(Date.now() + 10000) }));
  f.prisma.taskSession = { findMany: async args => sessions.filter(row => matches(row, args.where)) };
  f.prisma.taskLease = { findMany: async args => leases.filter(row => matches(row, args.where)) };
  const { getTeamAgentPresence } = f.load('src/lib/mcp/agents/presence.ts');
  const caller = { userId: f.user.id, agentId: f.agent.id };
  assert.deepEqual((await getTeamAgentPresence('team', caller)).map(row => row.currentTask.title), ['Task 15', 'Task 4060']);
  assert.equal((await getTeamAgentPresence('team')).length, 3);
  f.projects[0].members = [];
  assert.deepEqual((await getTeamAgentPresence('team', caller)).map(row => row.currentTask.title), ['Task 4060']);
  f.projects[1].members = [];
  assert.deepEqual(await getTeamAgentPresence('team', caller), []);
});

test('nested task hydration filters parent and subtasks with the real include, human hydration unchanged', () => {
  const f = fixture();
  const { taskMcpGetInclude, mapTaskToMcpGetResponse } = f.load('src/lib/mcp/tasks/mappers.ts', {
    '@/lib/mcp/agents': { mcpVisibleAgentSelect: () => ({}), mapVisibleMcpAgent: () => null },
  });
  const task = { ...f.tasks[0], parentTaskId: f.tasks[2].id, parentTask: f.tasks[2], subTasks: [f.tasks[1], f.tasks[2]] };
  const scoped = hydrate(task, { include: taskMcpGetInclude(f.user.id, f.agent.id) });
  assert.equal(scoped.parentTask, null);
  assert.deepEqual(scoped.subTasks.map(row => row.id), [40600]);
  assert.equal(mapTaskToMcpGetResponse(scoped, f.user.id, f.agent.id).parent_id, undefined);
  const human = hydrate(task, { include: taskMcpGetInclude(f.user.id) });
  assert.equal(human.parentTask.id, 21280);
  assert.equal(human.subTasks.length, 2);
});

test('historical inbox rows check both their notification board and current task board', () => {
  const f = fixture();
  const { notificationBoardAccessWhere } = f.load('src/utils/controllers/notifications/boardAccess.ts');
  assert.deepEqual(f.notifications.filter(row => matches(row, notificationBoardAccessWhere(f.user.id, f.agent.id))).map(row => row.projectId), [15, 4060]);
  const movedTask = { ...f.notifications[0], task: f.tasks[2] };
  assert.equal(matches(movedTask, notificationBoardAccessWhere(f.user.id, f.agent.id)), false);
  assert.equal(matches(movedTask, notificationBoardAccessWhere(f.user.id)), true);
});
