const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const jwt = require('jsonwebtoken');
const { fixture, access, matches, hydrate, load } = require('./helpers/agent-board-scope.cjs');

const agentDisplay = { mcpVisibleAgentSelect: () => ({}), mapVisibleMcpAgent: () => null, getMcpSessionAgentSummary: async () => null };
const request = (url, body, headers = {}) => new NextRequest(`http://localhost${url}`, { headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
function response() {
  return { statusCode: 0, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, setHeader() {} };
}

async function bearerFixture() {
  process.env.JWT_SECRET = 'scope-routes-test-only-secret';
  const f = fixture();
  const auth = f.load('src/lib/mcp/auth/verifyJwt.ts', { '@/lib/mcp/managementKeyTeamScope': {} });
  const token = jwt.sign({ userId: f.user.id, agentId: f.agent.id }, process.env.JWT_SECRET, { issuer: 'hypertask', audience: 'mcp-api', jwtid: 'scope-route-generation' });
  f.agent.mcpTokenHash = auth.hashAgentToken(token);
  f.agent.mcpTokenJti = 'scope-route-generation';
  f.state.ctx = await auth.validateJwtToken(token, { boundedLogging: true });
  assert.equal(f.state.ctx.agentId, f.agent.id);
  f.mocks['@/lib/mcp/agents'] = agentDisplay;
  return f;
}

test('authenticated agent task GET by ID/ticket and task/project lists never return board 2128', async () => {
  const f = await bearerFixture();
  const tasks = f.load('src/lib/mcp/operations/tasks/operation.ts').GET;
  const projects = f.load('src/lib/mcp/operations/projects/operation.ts').GET;
  for (const task of f.tasks) {
    for (const query of [`task_id=${task.id}`, `ticket_number=${task.ticketNumber}`, `project_id=${task.projectId}&unique_index=1`]) {
      const result = await tasks(request(`/api/mcp/tasks?${query}`));
      assert.equal(result.status, task.projectId === 2128 ? 404 : 200);
      if (task.projectId === 2128) assert.ok(!(await result.text()).includes('Task 2128'));
    }
  }
  assert.deepEqual((await (await tasks(request('/api/mcp/tasks'))).json()).tasks.map(task => task.projectId), [15, 4060]);
  assert.deepEqual((await (await projects(request('/api/mcp/projects'))).json()).projects.map(project => project.id), [15, 4060]);
  f.state.ctx.agentId = null;
  assert.equal((await (await tasks(request('/api/mcp/tasks'))).json()).tasks.length, 3);
  assert.equal((await (await projects(request('/api/mcp/projects'))).json()).projects.length, 3);
  f.state.ctx.agentId = f.agent.id;
  f.projects.forEach(project => { project.members = []; });
  assert.deepEqual((await (await projects(request('/api/mcp/projects'))).json()).projects, []);
  assert.deepEqual((await (await tasks(request('/api/mcp/tasks'))).json()).tasks, []);
});

test('search reauthorizes stale Turbopuffer hits and current grants, and denies explicit board 2128', async () => {
  const f = await bearerFixture();
  let searchScope;
  let removeGrant = false;
  const search = f.load('src/lib/mcp/operations/tasks/search/operation.ts', {
    '@/utils/controllers/search/document': { turbopufferSearchTaskIds: async input => {
      searchScope = input.projectIds;
      if (removeGrant) f.projects[0].members = [];
      return [21280, 150, 40600];
    } },
    '@/lib/search/serverOperators': { parseSearchWithChipNames: async text => ({ text, filters: {} }) }, '@/lib/search/rankedWhere': {},
  }).GET;
  assert.equal((await search(request('/api/mcp/tasks/search?q=scope&board_id=2128'))).status, 403);
  assert.deepEqual((await (await search(request('/api/mcp/tasks/search?q=scope'))).json()).tasks.map(task => task.projectId), [15, 4060]);
  assert.deepEqual(searchScope, [15, 4060]);
  removeGrant = true;
  assert.deepEqual((await (await search(request('/api/mcp/tasks/search?q=scope'))).json()).tasks.map(task => task.projectId), [4060]);
  f.state.ctx.agentId = null;
  assert.equal((await (await search(request('/api/mcp/tasks/search?q=scope'))).json()).tasks.length, 3);
});

test('signed agent session survives Better Auth and the real Pages adapter; all bridge destinations bind actor', async () => {
  process.env.SESSION_SECRET = 'scope-session-test-only-secret';
  process.env.BETTER_AUTH_ENABLED = '1';
  const f = fixture();
  const sessionModule = f.load('src/lib/auth/session.ts');
  const cookie = `ht_session=${sessionModule.signSession({ id: f.user.id, agentId: f.agent.id })}`;
  const authMocks = { '@/lib/auth/betterAuth': { auth: { api: { getSession: async () => ({ user: { id: String(f.user.id) } }) } } } };
  const getSessionUser = f.load('src/lib/auth/getSessionUser.ts', authMocks).getSessionUser;
  for (const mode of ['0', '1']) {
    process.env.AUTH_LEGACY_FAST_PATH = mode;
    assert.equal((await getSessionUser(new Headers({ cookie }))).agentId, f.agent.id);
  }
  const destinations = [
    ['src/lib/api/task-writes/update.ts', 'PUT', { newTask: { id: 150, title: 'After' } }],
    ['src/lib/api/task-writes/due-date.ts', 'POST', { taskId: 150, dueDate: null }],
    ['src/lib/api/task-writes/move.ts', 'PUT', { taskId: 150, projectId: 15, sectionId: 15, section_title: 'Todo', ranking: 'a' }],
    ['src/lib/api/task-writes/create.ts', 'POST', { title: 'Created', projectId: 15, sectionId: 15, section: 'Todo', ranking: 'a', userId: f.user.id }],
  ];
  const sideEffects = {
    ...authMocks,
    '@/utils/controllers/tasks/single': { updateTaskSingle: async (task, user, agentId) => {
      const oldTask = f.tasks.find(row => row.id === task.id);
      if (!matches(oldTask.project, access.taskWriteAccessWhere(user.id, agentId))) return { status: 403, json: {} };
      f.writes.push('task-update');
      return { status: 200, json: oldTask, oldTask };
    } },
    '@/utils/controllers/tasks/create': { default: async input => {
      if (!matches(f.projects.find(row => row.id === input.projectId), access.taskWriteAccessWhere(input.currentUser.id, input.agentId))) return { status: 403, json: {} };
      f.writes.push('task-create');
      return { status: 200, json: {} };
    } },
    '@/utils/controllers/activities/createTaskDueDateActivity': { default: async () => {} },
    '@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove': { default: async () => {} },
    '@/pages/api/queues/duedateQueue': { cancelDueDateJob: async () => {}, scheduleDueDateJob: async () => {} },
    '@/utils/controllers/tasks/addRelatedTasks': { addRelatedTasks: async () => {} },
  };
  for (const [file, method, baseBody] of destinations) {
    const route = f.load(file, sideEffects)[method];
    const adapter = f.load('src/lib/api/task-writes/route.ts', authMocks).taskWriteHandler({ [method]: async () => route });
    for (const agentId of [undefined, 'another-agent', f.agent.id]) {
      f.writes.length = 0;
      const res = response();
      await adapter({ method, headers: { cookie }, cookies: {}, query: {}, body: { ...baseBody, ...(agentId ? { agentId } : {}) } }, res);
      assert.equal(res.statusCode, agentId === f.agent.id ? 200 : 403, file);
      assert.equal(f.writes.length, agentId === f.agent.id ? 1 : 0, file);
    }
    for (const board of [4060, 2128]) {
      f.writes.length = 0;
      const deniedBody = { ...baseBody, agentId: f.agent.id, ...(baseBody.newTask ? { newTask: { id: board * 10, title: 'After' } } : { taskId: board * 10, projectId: board, sectionId: board }) };
      const res = response();
      await adapter({ method, headers: { cookie }, cookies: {}, query: {}, body: deniedBody }, res);
      assert.equal(res.statusCode, board === 2128 ? 403 : 200, file);
      assert.equal(f.writes.length, board === 2128 ? 0 : 1, file);
    }
  }
});

test('priority and estimate bridge targets reject omitted/forged actors and denied boards before writes', async () => {
  process.env.SESSION_SECRET = 'scope-session-test-only-secret';
  const f = fixture();
  const cookie = `ht_session=${f.load('src/lib/auth/session.ts').signSession({ id: f.user.id, agentId: f.agent.id })}`;
  for (const [file, body] of [
    ['priority/setPriority', { priority_index: 0, Priority_Value: 'None' }],
    ['estimate/setEstimate', { estimate_index: 0, estimate_value: 'None' }],
  ]) {
    f.prisma.priority = { deleteMany: async () => { f.writes.push('priority'); } };
    f.prisma.estimate = { deleteMany: async () => { f.writes.push('estimate'); } };
    const handler = f.load(`src/pages/api/${file}.ts`, {
      '@/utils/controllers/activities/CreatePriorityActivity': { default: async () => {} },
      '@/utils/controllers/activities/createEstimateActivity': { default: async () => {} },
    }).default;
    for (const task of f.tasks) {
      for (const agentId of [undefined, 'forged-agent', f.agent.id]) {
        f.writes.length = 0;
        const res = response();
        await handler({ method: 'POST', headers: { cookie }, body: { ...body, taskId: task.id, agentId } }, res);
        const allowed = task.projectId !== 2128 && agentId === f.agent.id;
        assert.equal(res.statusCode, allowed ? 200 : 403);
        assert.equal(f.writes.length, allowed ? 1 : 0);
      }
    }
  }
});

test('comment-ID edit/delete gate the authoritative task before mutation, human permissions preserved', async () => {
  const f = await bearerFixture();
  const comments = f.tasks.map(task => ({ id: task.id, task, creatorId: f.user.id, text: '<p>Before</p>' }));
  f.prisma.comment = { findUnique: async args => hydrate(comments.find(row => row.id === args.where.id), args) };
  const route = f.load('src/lib/mcp/operations/comments/[comment_id]/operation.ts', {
    '@/utils/controllers/comments/updateCommentService': { updateCommentService: async () => { f.writes.push('edit'); return { id: 1, text: 'After', createdAt: new Date(), updatedAt: new Date(), creator: f.user, reactions: [] }; } },
    '@/utils/controllers/comments/deleteCommentService': { deleteCommentService: async () => { f.writes.push('delete'); } },
    '@/utils/controllers/comments/processMentions': { convertPlainTextMentionsToHtml: async text => text },
    '@/utils/helperFunctions/multiPages': { extractTipTapContent: () => ({ mentions: [] }) },
    '@/lib/mcp/comments/visibleReactionAgents': { loadVisibleReactionAgents: async () => new Map() },
    '@/utils/controllers/urls/extractUrlsFromContent': { persistUrlsForComment: async () => {} },
    '@/lib/mcp/tasks/services': { validateProjectMemberIds: async () => ({ valid: true, invalidIds: [] }) },
  });
  for (const task of f.tasks) {
    for (const method of ['PATCH', 'DELETE']) {
      f.writes.length = 0;
      const result = await route[method](request('/api/mcp/comments/id', { text: 'After' }), { params: Promise.resolve({ comment_id: String(task.id) }) });
      assert.equal(result.status, task.projectId === 2128 ? 403 : 200);
      assert.equal(f.writes.length, task.projectId === 2128 ? 0 : 1);
    }
  }
  f.state.ctx.agentId = null;
  assert.equal((await route.DELETE(request('/api/mcp/comments/id'), { params: Promise.resolve({ comment_id: '21280' }) })).status, 200);
});

test('inbox archive/unarchive/seen scope selected IDs and sibling writes without changing response shape', async () => {
  for (const [file, key, initialStatus] of [
    ['src/lib/mcp/operations/inbox/archive/operation.ts', 'archived_count', 'Normal'],
    ['src/lib/mcp/operations/inbox/unarchive/operation.ts', 'unarchived_count', 'Archive'],
    ['src/app/api/mcp/inbox/seen/route.ts', 'seen_count', 'Normal'],
  ]) {
    const f = await bearerFixture();
    f.notifications.forEach(row => { row.status = initialStatus; });
    const route = f.load(file, { '@/pages/api/queues/inboxQueue': {}, '@/utils/controllers/tasks/myTasksSnooze': {} }).POST;
    const result = await route(request('/api/mcp/inbox', { notification_ids: [150, 40600, 21280] }));
    assert.equal(result.status, 200);
    assert.equal((await result.json())[key], 2);
    assert.equal(f.notifications[2].status, initialStatus);
    assert.equal(f.notifications[2].seen, false);
    const denied = await route(request('/api/mcp/inbox', { notification_ids: [21280] }));
    assert.equal((await denied.json())[key], 0);
    f.state.ctx.agentId = null;
    assert.equal((await (await route(request('/api/mcp/inbox', { notification_ids: [21280] }))).json())[key], 1);
  }
});

test('project archive/restore/delete deny board 2128 before lifecycle writes', async () => {
  const f = await bearerFixture();
  const route = f.load('src/lib/mcp/operations/projects/archive/operation.ts', {
    '@/lib/flags': { isFeatureEnabled: async () => true },
    '@/utils/controllers/projects/delete': { default: async () => { f.writes.push('delete-board'); return { status: 200, json: {} }; } },
  }).POST;
  for (const status of ['Archive', 'Normal', 'Deleted']) {
    for (const project of f.projects) {
      f.writes.length = 0;
      const result = await route(request('/api/mcp/projects/archive', { project_id: project.id, status }));
      assert.equal(result.status, project.id === 2128 ? 404 : 200);
      assert.equal(f.writes.length, project.id === 2128 ? 0 : 1);
    }
  }
});

test('bearer-only Pusher auth remains rejected with real cookie session resolution', async () => {
  process.env.BETTER_AUTH_ENABLED = '0';
  const f = fixture();
  let subscriptions = 0;
  const handler = f.load('src/pages/api/pusher/auth.ts', {
    '@/lib/mcp/tasks/services': {},
    '@/lib/realtime/server': { getRealtimeServer: () => ({ authorizeChannel: () => { subscriptions++; return {}; } }) },
  }).default;
  for (const channel_name of ['private-project-2128', 'private-task-21280', 'private-time-project-2128', 'private-user-6']) {
    const res = response();
    await handler({ method: 'POST', headers: { authorization: 'Bearer fixture-agent-token' }, body: { socket_id: '1.1', channel_name } }, res);
    assert.equal(res.statusCode, 403);
  }
  assert.equal(subscriptions, 0);
});

test('draft-ID update/delete/publish scope boards and description publish keeps the agent cookie', async () => {
  process.env.SESSION_SECRET = 'scope-session-test-only-secret';
  const f = await bearerFixture();
  const drafts = f.tasks.map(task => ({ id: task.id, taskId: task.id, task, userId: f.user.id, user: f.user, type: 'Description', content: '<p>Draft</p>', updatedAt: new Date() }));
  f.prisma.drafts = {
    findUnique: async args => hydrate(drafts.find(row => row.id === args.where.id), args),
    update: async args => { f.writes.push('draft-update'); return hydrate(drafts.find(row => row.id === args.where.id), args); },
    delete: async () => { f.writes.push('draft-delete'); },
  };
  const draftRoute = f.load('src/lib/mcp/operations/drafts/[draft_id]/operation.ts');
  const publish = f.load('src/lib/mcp/operations/drafts/[draft_id]/publish/operation.ts', {
    '@/utils/controllers/comments/createCommentService': {},
    '@/utils/controllers/urls/extractUrlsFromContent': { persistUrlsForDescription: async () => {} },
  }).POST;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const cookie = new Headers(options.headers).get('cookie');
    const claims = f.load('src/lib/auth/session.ts').verifySession(cookie.split('ht_session=')[1]);
    assert.equal(claims.agentId, f.agent.id);
    assert.equal(JSON.parse(options.body).agentId, f.agent.id);
    f.writes.push('publish-bridge');
    return Response.json({});
  };
  try {
    for (const task of f.tasks) {
      for (const operation of [draftRoute.PATCH, draftRoute.DELETE, publish]) {
        f.writes.length = 0;
        const result = await operation(request('/api/mcp/drafts/id', { text: 'After' }), { params: Promise.resolve({ draft_id: String(task.id) }) });
        assert.equal(result.status, task.projectId === 2128 ? 403 : 200);
        assert.equal(f.writes.length, task.projectId === 2128 ? 0 : 1);
      }
    }
  } finally { globalThis.fetch = oldFetch; }
});

test('real inbox list retains both inbox shapes but filters owner and historical agent rows to current boards', async () => {
  const f = await bearerFixture();
  f.agent.notificationsToAgent = f.notifications.map(row => ({ ...row, agentId: f.agent.id }));
  f.prisma.notification.groupBy = async () => [];
  f.prisma.taskReadState = { findMany: async () => [] };
  f.prisma.$queryRaw = async () => [];
  const route = f.load('src/lib/mcp/operations/inbox/list/operation.ts', {
    '@/utils/helperFunctions/helperFunctions': { getInboxTabs: rows => ({ all: rows }) },
    '@/utils/controllers/notifications/quietOwnerInbox': { markQuietAgentMentions: async (_client, _userId, rows) => rows },
  }).GET;
  const result = await route(request('/api/mcp/inbox/list'));
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.deepEqual(body.user_notifications.map(row => row.projectId), [15, 4060]);
  assert.deepEqual(body.agent_notifications.map(row => row.projectId), [15, 4060]);
  assert.ok(body.user_structured_data);
  assert.ok(body.agent_structured_data);
  f.projects.forEach(project => { project.members = []; });
  const empty = await (await route(request('/api/mcp/inbox/list'))).json();
  assert.deepEqual(empty.user_notifications, []);
  assert.deepEqual(empty.agent_notifications, []);
});

test('inbox composition denies the owner fallback on an unassigned board', async () => {
  const f = await bearerFixture();
  f.prisma.notification.groupBy = async () => [];
  const route = f.load('src/lib/mcp/operations/inbox/composition/operation.ts', {
    '@/utils/controllers/notifications/inboxZero': { loadDoneTitlesByProject: async () => new Map() },
  }).GET;
  for (const board of [15, 4060, 2128]) {
    assert.equal((await route(request(`/api/mcp/inbox/composition?project_id=${board}`))).status, board === 2128 ? 403 : 200);
  }
});

test('task-backed run activity GET/POST check current grants, boardless personal-chat runs stay accessible', async () => {
  const f = await bearerFixture();
  const runs = f.tasks.map(task => ({ id: `run-${task.projectId}`, agentId: f.agent.id, agent: { ...f.agent, user: f.user }, taskId: task.id, task, chatSessionId: null, chatSession: null, status: 'ACTIVE', activities: [] }));
  runs.push({ ...runs[0], id: 'personal-chat', taskId: null, task: null, chatSessionId: 'chat', chatSession: { id: 'chat', userId: f.user.id } });
  f.prisma.agentRun = { findFirst: async args => hydrate(runs.find(run => matches(run, args.where)), args) };
  const route = f.load('src/app/api/mcp/agents/runs/[id]/activities/route.ts', {
    '@/lib/flags': { isFeatureEnabled: async () => true },
    '@/lib/agentWebhooks/outbox': {},
    '@/lib/agentStatus/boardRefresh': { refreshBoardForAgentRun: async () => {} },
    '@/lib/agents/chatBroadcast': { broadcastChatSession: async () => {} },
    '@/utils/helperFunctions/toStoredHtml': { toStoredHtml: text => text },
    './persistence': { persistAgentRunActivity: async (_tx, input) => { f.writes.push('activity'); return { ...input, selectedAt: null, selectedValue: null }; } },
    '@/lib/realtime/server': { userChannel: () => 'user', broadcast: async () => {}, broadcastTaskComment: async () => {} },
  });
  for (const id of ['run-15', 'run-4060', 'run-2128', 'personal-chat']) {
    const params = { params: Promise.resolve({ id }) };
    const headers = { Authorization: 'Bearer fixture-token' };
    assert.equal((await route.GET(request('/api/mcp/agents/runs/id/activities', null, headers), params)).status, id === 'run-2128' ? 404 : 200);
    f.writes.length = 0;
    assert.equal((await route.POST(request('/api/mcp/agents/runs/id/activities', { type: 'thought', text: 'Scoped thought' }, headers), params)).status, id === 'run-2128' ? 404 : 200);
    assert.equal(f.writes.length, id === 'run-2128' ? 0 : 1);
  }
  f.projects[0].members = [];
  const params = { params: Promise.resolve({ id: 'run-15' }) };
  assert.equal((await route.GET(request('/api/mcp/agents/runs/id/activities', null, { Authorization: 'Bearer fixture' }), params)).status, 404);
  f.writes.length = 0;
  assert.equal((await route.POST(request('/api/mcp/agents/runs/id/activities', { type: 'thought', text: 'After removal' }, { Authorization: 'Bearer fixture' }), params)).status, 404);
  assert.deepEqual(f.writes, []);
});

test('comment creation by authenticated agent refuses board 2128 before dedupe or persistence', async () => {
  const f = await bearerFixture();
  f.prisma.comment = { findUnique: async () => null };
  const route = f.load('src/lib/mcp/operations/comments/operation.ts', {
    '@/lib/mcp/routeWrapper': { ...f.mocks['@/lib/mcp/routeWrapper'], readMcpRouteJsonBody: async req => ({ ok: true, body: await req.json() }) },
    '@/lib/mcp/idempotency/idempotencyStore': { normalizeIdempotencyKey: () => null, withIdempotency: async (_op, _user, _key, _body, run) => run() },
    '@/utils/controllers/comments/createCommentService': { createCommentService: async () => { f.writes.push('comment'); return { id: 1, text: 'After', createdAt: new Date() }; } },
    '@/utils/controllers/comments/processMentions': { resolveTextMentions: async text => text },
    '@/utils/helperFunctions/multiPages': { extractTipTapContent: () => ({ mentions: [] }) },
    '@/utils/controllers/urls/extractUrlsFromContent': { persistUrlsForComment: async () => {} },
    '@/lib/mcp/tasks/services': { validateProjectMemberIds: async () => ({ invalidIds: [] }) },
    '@/lib/mcp/comments/visibleReactionAgents': { loadVisibleReactionAgents: async () => new Map() },
  }).POST;
  for (const task of f.tasks) {
    f.writes.length = 0;
    const result = await route(request('/api/mcp/comments', { task_id: task.id, text: 'After' }));
    assert.equal(result.status, task.projectId === 2128 ? 404 : 201);
    assert.equal(f.writes.length, task.projectId === 2128 ? 0 : 1);
  }
});

test('all HTTP-backed update fields preserve the signed actor through real session resolution', async () => {
  process.env.SESSION_SECRET = 'scope-session-test-only-secret';
  const f = fixture();
  const signSession = f.load('src/lib/auth/session.ts').signSession;
  const getSessionUser = f.load('src/lib/auth/getSessionUser.ts').getSessionUser;
  const context = {
    ctx: f.state.ctx, baseUrl: 'http://localhost',
    authCookieHeader: `ht_session=${signSession({ id: f.user.id, agentId: f.agent.id })}`,
    requestBody: { title: 'After', status: 'Normal', sectionId: 15 },
    hasTextOrParentUpdate: true, hasDescriptionUpdate: false, hasDueDate: true,
    sectionInfo: { section_title: 'Todo', projectId: 15 },
    priorityConstant: { priority_index: 1, Priority_Value: 'Low' },
    estimateConstant: { estimate_index: 1, estimate_value: 'Small' },
    strictSideEffectFailures: true,
  };
  const oldFetch = globalThis.fetch;
  const paths = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const session = await getSessionUser(new Headers(options.headers));
    assert.equal(session.agentId, f.agent.id);
    assert.equal(body.agentId, session.agentId);
    paths.push(new URL(url).pathname);
    return Response.json({});
  };
  try {
    for (const [file, name, extra] of [
      ['text', 'updateTaskText'], ['dueDate', 'updateTaskDueDate', null],
      ['section', 'updateTaskSection'], ['priority', 'updateTaskPriority'],
      ['estimate', 'updateTaskEstimate'], ['status', 'updateTaskStatus'],
    ]) {
      await f.load(`src/lib/mcp/tasks/fields/${file}.ts`, { '@/utils/controllers/urls/extractUrlsFromContent': {} })[name](context, f.tasks[0], extra);
    }
    assert.deepEqual(paths, ['/api/tasks/single', '/api/tasks/setDueDate', '/api/tasks/moveTask', '/api/priority/setPriority', '/api/estimate/setEstimate', '/api/tasks/(un)archive']);
  } finally { globalThis.fetch = oldFetch; }
});

test('related search GET and POST rehydrate only accessible boards after Turbopuffer', async () => {
  const f = await bearerFixture();
  const related = f.load('src/lib/mcp/tasks/relatedTasks.ts', { '@/utils/controllers/turbopuffer/turbopufferHelper': { convertToPlain: text => text } });
  const dependencies = { searchTasks: async () => f.tasks.map(task => ({ id: String(task.id), title: 'Stale index title', ticketNumber: task.ticketNumber, uniqueIndex: task.uniqueIndex, projectId: task.projectId, $dist: 0.5 })) };
  const post = await related.handleRelatedTasksPost(request('/api/mcp/tasks/related'), f.state.ctx, { text: 'scope' }, dependencies);
  assert.deepEqual((await post.json()).related.map(row => row.title), ['Task 15', 'Task 4060']);
  const get = await related.handleRelatedTasksGet(request('/api/mcp/tasks/related'), f.state.ctx, { taskId: 150, limit: 10 }, dependencies);
  assert.deepEqual((await get.json()).related.map(row => row.projectId), [4060]);
});

test('MCP timer running/report and team presence forward the authenticated agent to real services', async () => {
  const f = await bearerFixture();
  const entries = f.tasks.map(task => ({ id: task.id, taskId: task.id, userId: f.user.id, task, user: f.user, startedAt: new Date(), endedAt: null, pausedAt: null }));
  f.prisma.timeEntry = { findMany: async args => entries.filter(row => matches(row, args.where)) };
  f.prisma.taskSession = { findMany: async args => f.tasks.map(task => ({ task, agentId: `other-${task.projectId}`, agent: { id: `other-${task.projectId}` }, lastSeenAt: new Date() })).filter(row => matches(row, args.where)) };
  f.prisma.taskLease = { findMany: async () => [] };
  f.prisma.member_Team = { findFirst: async () => ({ id: 1 }) };
  for (const type of ['running', 'report']) {
    const route = f.load(`src/lib/mcp/operations/time/${type}/operation.ts`).GET;
    const body = await (await route(request(`/api/mcp/time/${type}`))).json();
    assert.deepEqual((body.entries ?? body.timers).map(row => row.task.projectId), [15, 4060]);
    if (type === 'report') {
      assert.deepEqual((await (await route(request('/api/mcp/time/report?board=2128'))).json()).entries, []);
    }
  }
  const presence = f.load('src/lib/mcp/operations/agents/presence/operation.ts').GET;
  assert.deepEqual((await (await presence(request('/api/mcp/agents/presence?team_id=team'))).json()).agents.map(row => row.agent.id).sort(), ['other-15', 'other-4060']);
});

test('MCP cross-board move independently authorizes its source and destination', async () => {
  const f = await bearerFixture();
  const route = f.load('src/lib/mcp/operations/tasks/move/operation.ts', {
    '@/lib/mcp/routeWrapper': { ...f.mocks['@/lib/mcp/routeWrapper'], withMcpRouteMutationLease: async (_db, _actor, run) => run() },
    '@/utils/controllers/tasks/moveToDifferentBoard': { moveTaskToDifferentBoard: async () => { f.writes.push('cross-board-move'); return { success: true }; } },
    '@/lib/mcp/tasks/mappers': { taskDetailInclude: () => ({}), mapTaskToDetail: task => task },
    '@/utils/controllers/activities/createLabelActivity': {},
    '@/utils/controllers/urls/extractUrlsFromContent': {},
    '@/lib/agentWebhooks/outbox': {},
  }).POST;
  for (const [taskId, target, status] of [[21280, 15, 404], [150, 2128, 403], [150, 4060, 200]]) {
    f.writes.length = 0;
    const result = await route(request('/api/mcp/tasks/move', { task_id: taskId, target_project_id: target, target_section_id: target }));
    assert.equal(result.status, status);
    assert.equal(f.writes.length, status === 200 ? 1 : 0);
  }
});

test('global create bridge destination binds actor and denies unassigned boards before the creation transaction', async () => {
  process.env.SESSION_SECRET = 'scope-session-test-only-secret';
  const f = fixture();
  const cookie = `ht_session=${f.load('src/lib/auth/session.ts').signSession({ id: f.user.id, agentId: f.agent.id })}`;
  f.prisma.$executeRaw = async () => 1;
  f.prisma.section.findFirst = async ({ where }) => ({ id: where.projectId, section_title: 'Todo' });
  f.prisma.task.create = async ({ data }) => { f.writes.push('global-create'); return { ...data, id: 900, project: f.projects.find(project => project.id === data.projectId), description_: { content: '' } }; };
  const route = f.load('src/lib/api/task-writes/create-global.ts', {
    './create-global-effects': { getActiveAgentOwnerId: async () => f.user.id, schedulePostCreateWork: () => {} },
    '@/utils/controllers/agents/boardMembers': { isAgentOnBoard: async () => true },
    '@/utils/controllers/tasks/getNextUniqueTaskIndex': { getNextUniqueTaskIndex: async () => 2 },
    '@/lib/mcp/webhooks/taskEvents': { createTaskWithBoardWebhookOutbox: async (_db, _actor, run) => ({ ...(await run(f.prisma)), boardWebhookDeliveryIds: [] }) },
    '@/lib/mcp/webhooks/outbox': { publishBoardWebhookDeliveries: async () => {} },
    '@/lib/agentWebhooks/outbox': { persistAgentTaskCreatedPending: async () => {} },
  }).POST;
  for (const project of f.projects) {
    for (const agentId of [undefined, 'forged-agent', f.agent.id]) {
      f.writes.length = 0;
      const result = await route(request('/api/tasks/createGlobally', { title: 'New task', userId: f.user.id, projectId: project.id, agentId }, { cookie }));
      const allowed = project.id !== 2128 && agentId === f.agent.id;
      assert.equal(result.status, allowed ? 200 : 403);
      assert.equal(f.writes.length, allowed ? 1 : 0);
    }
  }
});

const { configureActor } = require('./helpers/agent-board-scope.cjs');
for (const mode of ['WATCH', 'ENFORCE']) {
  for (const kind of ['granted', 'zero', 'pending', 'revoked', 'other-owner', 'human']) {
    for (const action of ['read', 'write', 'comment', 'search', 'list']) {
      test(`route grid ${mode} ${kind} ${action} boards 15/2128`, async () => {
        const f = fixture();
        f.state.enforce = mode === 'ENFORCE';
        configureActor(f, kind);
        f.mocks['@/lib/mcp/agents'] = agentDisplay;
        let invoke;
        if (action === 'read' || action === 'list') {
          const route = f.load('src/lib/mcp/operations/tasks/operation.ts').GET;
          invoke = board => route(request(`/api/mcp/tasks?${action === 'read' ? `task_id=${board * 10}` : `project_id=${board}`}`));
        } else if (action === 'search') {
          const route = f.load('src/lib/mcp/operations/tasks/search/operation.ts', {
            '@/utils/controllers/search/document': { turbopufferSearchTaskIds: async () => f.tasks.map(task => task.id) },
            '@/lib/search/serverOperators': { parseSearchWithChipNames: async text => ({ text, filters: {} }) },
            '@/lib/search/rankedWhere': {},
          }).GET;
          invoke = board => route(request(`/api/mcp/tasks/search?q=scope&board_id=${board}`));
        } else if (action === 'write') {
          f.prisma.priority = { deleteMany: async () => { f.writes.push('priority'); } };
          const handler = f.load('src/pages/api/priority/setPriority.ts', {
            '@/lib/auth/getSessionUser': { getSessionUser: async () => { await f.scope.prepareAgentScope(f.user.id, f.state.ctx.agentId); return { userId: f.user.id, agentId: f.state.ctx.agentId }; } },
            '@/utils/controllers/activities/CreatePriorityActivity': { default: async () => {} },
          }).default;
          invoke = async board => {
            const res = response();
            await handler({ url: '/api/priority/setPriority', method: 'POST', headers: {}, body: { taskId: board * 10, priority_index: 0, Priority_Value: 'None', agentId: f.state.ctx.agentId } }, res);
            return { status: res.statusCode };
          };
        } else {
          f.prisma.comment = { findUnique: async () => null };
          const route = f.load('src/lib/mcp/operations/comments/operation.ts', {
            '@/lib/mcp/routeWrapper': { ...f.mocks['@/lib/mcp/routeWrapper'], readMcpRouteJsonBody: async req => ({ ok: true, body: await req.json() }) },
            '@/lib/mcp/idempotency/idempotencyStore': { normalizeIdempotencyKey: () => null, withIdempotency: async (_op, _user, _key, _body, run) => run() },
            '@/utils/controllers/comments/createCommentService': { createCommentService: async () => { f.writes.push('comment'); return { id: 1, text: 'Never in telemetry', createdAt: new Date() }; } },
            '@/utils/controllers/comments/processMentions': { resolveTextMentions: async text => text },
            '@/utils/helperFunctions/multiPages': { extractTipTapContent: () => ({ mentions: [] }) },
            '@/utils/controllers/urls/extractUrlsFromContent': { persistUrlsForComment: async () => {} },
            '@/lib/mcp/tasks/services': { validateProjectMemberIds: async () => ({ invalidIds: [] }) },
            '@/lib/mcp/comments/visibleReactionAgents': { loadVisibleReactionAgents: async () => new Map() },
          }).POST;
          invoke = board => route(request('/api/mcp/comments', { task_id: board * 10, text: 'Never in telemetry' }));
        }
        for (const board of [15, 2128]) {
          f.writes.length = 0;
          const result = await invoke(board);
          const valid = !['revoked', 'other-owner'].includes(kind);
          const allowed = kind === 'human' || valid && (mode === 'WATCH' || kind === 'granted' && board === 15);
          if (!allowed && ['search', 'list'].includes(action) && result.status === 200) assert.deepEqual((await result.json()).tasks, []);
          else assert.ok(allowed ? [200, 201].includes(result.status) : [403, 404].includes(result.status), `${board}: got ${result.status}, allowed=${allowed}`);
          if (['write', 'comment'].includes(action)) assert.equal(f.writes.length, allowed ? 1 : 0);
          const event = f.state.events.find(event => event.properties.projectId === board);
          const miss = mode === 'WATCH' && valid && kind !== 'human' && (board === 2128 || kind !== 'granted');
          assert.equal(Boolean(event), miss, `miss for ${board}`);
          if (event) assert.deepEqual(event, { distinctId: '6', event: 'agent_board_scope_miss', properties: { agentId: f.agent.id, ownerUserId: f.user.id, projectId: board, route: action === 'write' ? '/api/priority/setPriority' : action === 'comment' ? '/api/mcp/comments' : `/api/mcp/tasks${action === 'search' ? '/search' : ''}`, action: ['write', 'comment'].includes(action) ? 'write' : 'read', zeroBoard: kind === 'zero' || kind === 'pending' } });
        }
        assert.equal(f.state.grantReads, mode === 'WATCH' && kind !== 'human' ? 2 : 0);
      });
    }
  }
}

test('WATCH priority and estimate preserve production writes on owned teamless boards', async () => {
  for (const mode of ['WATCH', 'ENFORCE']) {
    for (const field of ['priority', 'estimate']) {
      const f = fixture();
      f.state.enforce = mode === 'ENFORCE';
      f.projects.forEach(project => { project.teamId = null; });
      f.prisma[field] = { deleteMany: async () => { f.writes.push(field); } };
      const handler = f.load(`src/pages/api/${field}/${field === 'priority' ? 'setPriority' : 'setEstimate'}.ts`, {
        '@/lib/auth/getSessionUser': { getSessionUser: async () => { await f.scope.prepareAgentScope(f.user.id, f.agent.id); return { userId: f.user.id, agentId: f.agent.id }; } },
        '@/utils/controllers/activities/CreatePriorityActivity': { default: async () => {} },
        '@/utils/controllers/activities/createEstimateActivity': { default: async () => {} },
      }).default;
      const res = response();
      await handler({ url: `/api/${field}`, method: 'POST', headers: {}, body: { taskId: 21280, agentId: f.agent.id, priority_index: 0, Priority_Value: 'None', estimate_index: 0, estimate_value: 'None' } }, res);
      assert.equal(res.statusCode, mode === 'WATCH' ? 200 : 403);
      assert.equal(f.state.events.length, mode === 'WATCH' ? 1 : 0);
    }
  }
});

test('priority and estimate retain human and WATCH body-agent content access, including teamless boards and 404s', async () => {
  for (const mode of ['WATCH', 'ENFORCE']) {
    for (const field of ['priority', 'estimate']) {
      for (const bodyAgent of [false, true]) {
        const f = fixture();
        f.state.enforce = mode === 'ENFORCE';
        f.projects[2].teamId = null;
        f.prisma[field] = { deleteMany: async () => { f.writes.push(field); } };
        const queries = [];
        const findFirst = f.prisma.task.findFirst;
        f.prisma.task.findFirst = async args => { queries.push(args); return findFirst(args); };
        const handler = f.load(`src/pages/api/${field}/${field === 'priority' ? 'setPriority' : 'setEstimate'}.ts`, {
          '@/lib/auth/getSessionUser': { getSessionUser: async () => ({ userId: 6 }) },
          '@/utils/controllers/activities/CreatePriorityActivity': { default: async () => {} },
          '@/utils/controllers/activities/createEstimateActivity': { default: async () => {} },
        }).default;
        const invoke = async () => {
          const res = response();
          await handler({ url: `/api/${field}`, method: 'POST', headers: {}, body: {
            taskId: 21280, ...(bodyAgent ? { agentId: f.agent.id } : {}),
            priority_index: 0, Priority_Value: 'None', estimate_index: 0, estimate_value: 'None',
          } }, res);
          return res;
        };
        const allowed = !bodyAgent || mode === 'WATCH';
        assert.equal((await invoke()).statusCode, allowed ? 200 : 403);
        assert.deepEqual(f.writes, allowed ? [field] : []);
        assert.equal(queries.length, allowed ? 1 : 0);
        assert.equal(f.state.events.length, bodyAgent && mode === 'WATCH' ? 1 : 0);
        if (allowed) {
          assert.deepEqual(Object.keys(queries[0]).sort(), ['include', 'where']);
          f.projects[2].ownerId = 7;
          f.projects[2].owner = { id: 7, agents: [] };
          f.writes.length = 0;
          assert.equal((await invoke()).statusCode, 404);
          assert.deepEqual(f.writes, []);
          assert.equal(queries.length, 2);
        }
      }
    }
  }
});
