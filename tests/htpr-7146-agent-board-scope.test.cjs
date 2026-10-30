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

test('saved views require an accepted owned active agent grant, without owner fallback', () => {
  const f = fixture();
  const allowed = agentId => f.projects.filter(project => matches(project, access.savedViewBoardAccessWhere(f.user.id, agentId))).map(project => project.id);
  assert.deepEqual(allowed(f.agent.id), [15, 4060]);
  assert.deepEqual(allowed(null), [15, 4060, 2128]);
  f.projects.forEach(project => { project.members = []; });
  f.user.agents = [f.agent];
  f.agent.members = [];
  assert.deepEqual(allowed(f.agent.id), []);
  f.projects[2].members = [{ agentId: f.agent.id, status: 'Invited', agent: f.agent }];
  assert.deepEqual(allowed(f.agent.id), []);
  f.projects[2].members[0].status = 'Accepted';
  assert.deepEqual(allowed(f.agent.id), [2128]);
  f.agent.revokedAt = new Date();
  assert.deepEqual(allowed(f.agent.id), []);
  f.agent.revokedAt = null;
  f.agent.userId = 7;
  assert.deepEqual(allowed(f.agent.id), []);
  f.projects[2].ownerId = 7;
  f.projects[2].members = [{ userId: f.user.id, agentId: null, status: 'Invited' }];
  assert.deepEqual(allowed(null), [15, 4060]);
  f.projects[2].members[0].status = 'Accepted';
  assert.deepEqual(allowed(null), [15, 4060, 2128]);
});

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

test('timer services scope running/report with and without administered boards', async () => {
  const f = fixture();
  const entries = f.tasks.map(task => ({ id: task.id, taskId: task.id, userId: f.user.id, task, user: f.user, startedAt: new Date(), endedAt: null, pausedAt: null }));
  f.prisma.timeEntry = { findMany: async args => entries.filter(row => matches(row, args.where)) };
  const service = f.load('src/lib/timeTracking.ts', {
    '@/lib/timeTrackingPersistence': {},
  });
  assert.deepEqual((await service.listRunning(f.user.id, f.agent.id)).map(row => row.task.projectId).sort((a, b) => a - b), [15, 4060]);
  assert.equal((await service.listRunning(f.user.id)).length, 3);
  for (const adminProjectIds of [[], [15, 4060, 2128]]) {
    assert.deepEqual((await service.listReport(f.user.id, { agentId: f.agent.id, adminProjectIds })).map(row => row.task.projectId).sort((a, b) => a - b), [15, 4060]);
    assert.deepEqual(await service.listReport(f.user.id, { agentId: f.agent.id, boardId: 2128, adminProjectIds: [] }), []);
    assert.deepEqual((await service.listReport(f.user.id, { agentId: f.agent.id, boardIds: [], adminProjectIds: [] })).map(row => row.task.projectId).sort((a, b) => a - b), [15, 4060]);
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
  assert.deepEqual((await getTeamAgentPresence('team', caller)).map(row => row.currentTask.title).sort(), ['Task 15', 'Task 4060']);
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

const { configureActor } = require('./helpers/agent-board-scope.cjs');
for (const mode of ['WATCH', 'ENFORCE']) {
  for (const kind of ['granted', 'zero', 'pending', 'revoked', 'other-owner', 'human']) {
    for (const action of ['read', 'write', 'comment', 'search', 'list']) {
      for (const board of [15, 2128]) {
        test(`predicate grid ${mode} ${kind} ${action} board ${board}`, async () => {
          const f = fixture();
          f.state.enforce = mode === 'ENFORCE';
          configureActor(f, kind);
          const helper = action === 'write' || action === 'comment' ? 'taskWriteAccessWhere' : 'getProjectWhere';
          await f.run({ url: `/api/mcp/tasks/${action}?content=never-log`, method: ['write', 'comment'].includes(action) ? 'POST' : 'GET' }, async () => {
            const project = f.projects.find(row => row.id === board);
            const allowed = matches(project, f.access[helper](f.user.id, f.state.ctx.agentId));
            const valid = !['revoked', 'other-owner'].includes(kind);
            const expected = kind === 'human' || valid && (mode === 'WATCH' || kind === 'granted' && board === 15);
            assert.equal(allowed, expected);
            if (allowed && kind !== 'human') f.scope.recordAgentBoardScopeMiss(board);
            assert.equal(f.state.grantReads, mode === 'WATCH' && valid && kind !== 'human' ? 1 : 0);
            assert.equal(f.state.events.length, mode === 'WATCH' && valid && kind !== 'human' && (board === 2128 || kind !== 'granted') ? 1 : 0);
          });
        });
      }
    }
  }
}

test('WATCH predicates exactly preserve production owner, human-member, agent-member, discovery and saved-view branches', async () => {
  const f = fixture();
  f.state.enforce = false;
  await f.run({ url: '/api/mcp/tasks' }, async () => {
    const activeAgent = { id: f.agent.id, userId: f.user.id, revokedAt: null };
    const branches = [
      { owner: { id: f.user.id, agents: { some: activeAgent } } },
      { members: { some: { userId: f.user.id, agentId: null, user: { agents: { some: activeAgent } } } } },
      { members: { some: { agentId: f.agent.id, agent: { userId: f.user.id, revokedAt: null } } } },
    ];
    for (const helper of ['projectContentAccessWhere', 'taskWriteAccessWhere']) assert.deepEqual(f.access[helper](f.user.id, f.agent.id), { OR: branches });
    assert.deepEqual(f.access.getProjectWhere(f.user.id, f.agent.id), { teamId: { not: null }, OR: branches });
    assert.deepEqual(f.access.getProjectListingWhere(f.user.id, f.agent.id), { teamId: { not: null }, members: branches[2].members });
    const saved = f.access.savedViewBoardAccessWhere(f.user.id, f.agent.id);
    assert.deepEqual(saved.OR[0], branches[0]);
    assert.equal(saved.OR[1].members.some.status, 'Accepted');
    assert.equal(saved.OR[2].members.some.status, 'Accepted');
    f.projects.forEach(project => { project.members = []; });
    assert.equal(matches(f.projects[2], saved), true);
    assert.equal(matches(f.projects[2], f.access.getProjectListingWhere(f.user.id, f.agent.id)), false);
  });
});

test('WATCH mode and Accepted grants are request-cached; miss capture is ids-only, hourly, and action-specific', async () => {
  const f = fixture();
  f.state.enforce = false;
  const req = { url: '/api/mcp/tasks/search?token=never-log', method: 'GET' };
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    await f.run(req, async () => {
      await Promise.all([f.scope.prepareAgentScope(f.user.id, f.agent.id), f.scope.agentScopeMode(f.user.id), f.scope.agentScopeMode(f.user.id)]);
      for (let i = 0; i < 100; i++) f.scope.recordAgentBoardScopeMiss(2128);
      f.scope.recordAgentBoardScopeMiss(15);
      f.scope.recordAgentBoardScopeMiss(2128, 'write');
      assert.equal(f.state.flagReads, 1);
      assert.equal(f.state.grantReads, 1);
    });
    await f.run(req, async () => f.scope.recordAgentBoardScopeMiss(2128));
    assert.equal(f.state.events.length, 2);
    now += 60 * 60 * 1000;
    await f.run(req, async () => f.scope.recordAgentBoardScopeMiss(2128));
    assert.equal(f.state.events.length, 3);
    assert.deepEqual(f.state.events[0], { distinctId: '6', event: 'agent_board_scope_miss', properties: { agentId: f.agent.id, ownerUserId: 6, projectId: 2128, route: '/api/mcp/tasks/search', action: 'read', zeroBoard: false } });
    assert.equal(f.state.events[1].properties.action, 'write');
  } finally { Date.now = originalNow; }
});

test('only flag-read failure falls back to WATCH with a safe log; grant errors propagate', async () => {
  const f = fixture();
  f.state.flagError = new Error('private flag failure');
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    await f.run({ url: '/api/mcp/tasks' }, async () => assert.equal(f.scope.agentScopeEnforced(), false));
  } finally { console.warn = warn; }
  assert.deepEqual(warnings, [['[agent-board-scope] flag read failed; using WATCH']]);
  f.state.flagError = null;
  f.state.enforce = false;
  f.prisma.member.findMany = async () => { throw new Error('grants unavailable'); };
  await assert.rejects(f.run({ url: '/api/mcp/tasks' }, async () => {}), /grants unavailable/);
});

test('scope flag is registered as default OFF for everyone', () => {
  const flags = require('./helpers/flag-files.cjs').load(require('node:path').resolve(__dirname, '../src/lib/flags/definitions.ts'));
  assert.equal(flags.FEATURE_FLAG_DEFINITIONS.find(row => row.key === 'htpr-7146-agent-scope-enforce').defaultMode, 'OFF');
});

test('WATCH leaves production notification visibility, hierarchy includes and team-wide presence intact', async () => {
  const f = fixture();
  f.state.enforce = false;
  f.projects[2].ownerId = 7;
  f.projects[2].owner = { id: 7, agents: [] };
  const { notificationBoardAccessWhere } = f.load('src/utils/controllers/notifications/boardAccess.ts');
  const { taskMcpGetInclude } = f.load('src/lib/mcp/tasks/mappers.ts', { '@/lib/mcp/agents': { mcpVisibleAgentSelect: () => ({}), mapVisibleMcpAgent: () => null } });
  f.prisma.taskSession = { findMany: async args => f.tasks.map(task => ({ task, agentId: `other-${task.projectId}`, agent: { id: `other-${task.projectId}` }, lastSeenAt: new Date() })).filter(row => matches(row, args.where)) };
  f.prisma.taskLease = { findMany: async () => [] };
  const { getTeamAgentPresence } = f.load('src/lib/mcp/agents/presence.ts');
  await f.run({ url: '/api/mcp/agents/presence' }, async () => {
    assert.deepEqual(notificationBoardAccessWhere(f.user.id, f.agent.id), {});
    const include = taskMcpGetInclude(f.user.id, f.agent.id);
    assert.equal(include.parentTask.where, undefined);
    assert.equal(include.subTasks.where, undefined);
    assert.equal((await getTeamAgentPresence('team', { userId: f.user.id, agentId: f.agent.id })).length, 3);
  });
});

test('concurrent requests have independent mode/grant snapshots and nested wrappers reuse the request', async () => {
  const f = fixture();
  f.state.enforce = false;
  await Promise.all([15, 2128].map(board => f.run({ url: `/api/mcp/projects/${board}` }, async () => {
    await f.run({ url: '/nested' }, async () => {
      assert.equal(await f.scope.agentScopeMode(f.user.id), 'WATCH');
      f.scope.recordAgentBoardScopeMiss(board);
    });
  })));
  assert.equal(f.state.flagReads, 2);
  assert.equal(f.state.grantReads, 2);
  assert.equal(f.state.events.length, 1);
  assert.equal(f.state.events[0].properties.route, '/api/mcp/projects/2128');
});
