const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { NextRequest } = require('next/server');
const { loadModule } = require('./helpers/loadModule.cjs');
const root = path.resolve(__dirname, '..');
const jiti = require('jiti')(__filename, { interopDefault: true, alias: { '@': path.join(root, 'src') }, cache: false });
const { createCommentSaveHandler } = jiti(path.join(root, 'src/lib/mcp/comments/commentSaveHandler.ts'));

function setup(mode = 'pin', overrides = {}) {
  let row = null;
  const created = [];
  const queries = [];
  const tx = { savedContent: {
    findFirst: async ({ where }) => { queries.push(where); return row; },
    deleteMany: async () => { row = null; },
    create: async ({ data }) => { created.push(data); row = data; return data; },
  } };
  const { toggleSavedContent } = loadModule('src/utils/controllers/savedContent/toggleSavedContent.ts', {
    '@/lib/taskCardActions/writeLocks': { withTaskStarWriteLock: async (_id, operation) => operation(tx) },
    '@/utils/controllers/savedContent/helper': { includeSavedContentComment: () => ({}) },
  });
  const context = { user: { id: 6 }, agentId: mode === 'pin' ? 'agent' : null, teamScope: { teamId: 'team' } };
  const POST = createCommentSaveHandler({
    mode, checkRateLimit: async () => null, validateAuth: async () => context,
    authorizeWrite: async () => null, refuse: async () => null,
    findTarget: async () => ({ commentId: 7, taskId: 42, projectId: 15 }),
    toggle: async (ctx, target, selectedMode) => (await toggleSavedContent({ ...target, userId: ctx.user.id, type: selectedMode === 'pin' ? 'Public' : 'Private' })).status === 200,
    ...overrides,
  });
  const request = () => new NextRequest(`https://example.test/mcp/comments/7/${mode}`, { method: 'POST' });
  const props = { params: Promise.resolve({ comment_id: '7' }) };
  return { POST, request, props, created, queries, toggleSavedContent };
}

for (const [mode, type, on, off] of [['pin', 'Public', 'pinned', 'unpinned'], ['star', 'Private', 'starred', 'unstarred']]) {
  test(`${mode} toggles on and off`, async () => {
    const { POST, request, props, created, queries } = setup(mode);
    assert.deepEqual(await (await POST(request(), props)).json(), { success: true, state: on });
    assert.deepEqual(await (await POST(request(), props)).json(), { success: true, state: off });
    assert.deepEqual(created[0], { userId: 6, taskId: 42, projectId: 15, commentId: 7, type });
    assert.equal(queries[0].userId, mode === 'star' ? 6 : undefined);
  });
}

test('inaccessible comments do not write', async () => {
  const { POST, request, props, created } = setup('pin', { findTarget: async () => null });
  assert.equal((await POST(request(), props)).status, 404);
  assert.deepEqual(created, []);
});

test('unauthenticated requests do not write', async () => {
  const { POST, request, props, created } = setup('pin', { validateAuth: async () => null });
  assert.equal((await POST(request(), props)).status, 401);
  assert.deepEqual(created, []);
});

test('disabled flag does not write', async () => {
  const { POST, request, props, created } = setup('pin', { refuse: async () => Response.json({ success: false, error: 'Comment pin and star are not enabled' }, { status: 404 }) });
  const response = await POST(request(), props);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { success: false, error: 'Comment pin and star are not enabled' });
  assert.deepEqual(created, []);
});

test('human API session still toggles', async () => {
  const { toggleSavedContent } = setup();
  const api = loadModule('src/pages/api/savedContent/toggleSaved.ts', {
    '@/lib/auth/agentScope': { withAgentScopeRequest: (_req, run) => run() },
    '@/lib/auth/desktopCliTokenUser': { getDesktopCliTokenUser: async () => null, logDesktopCliAuthorization: () => {} },
    '@/lib/auth/getSessionUser': { getSessionUser: async () => ({ userId: 6, agentId: null, teamScope: null }) },
    '@/lib/prisma': { default: { task: { findFirst: async () => ({ id: 42, projectId: 15 }) }, comment: { findFirst: async () => ({ id: 7 }) } } },
    '@/utils/controllers/projects/getAllIncludes': { projectContentAccessWhere: () => ({}) },
    '@/utils/controllers/savedContent/toggleSavedContent': { toggleSavedContent },
  }).default;
  const req = { method: 'POST', headers: {}, body: { taskId: 42, commentId: 7, type: 'Public' } };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await api(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.saved.commentId, 7);
  await api(req, res);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, {});
});

test('operation applies agent, team, and user project scope', async () => {
  const calls = [];
  const context = { user: { id: 6 }, agentId: 'agent', teamScope: { teamId: 'team', accessBinding: 'binding' } };
  const { POST } = loadModule('src/lib/mcp/operations/comments/[comment_id]/pin/operation.ts', {
    '@/lib/mcp/comments/commentSaveHandler': { createCommentSaveHandler },
    '@/lib/mcp/agents/readRoleGuard': { requireAgentWriteRole: async () => null },
    '@/lib/mcp/routeWrapper': { wrapMcpRoute: (handler) => handler, validateMcpRouteAuth: async () => context, checkMcpRouteRateLimit: async () => null },
    '@/lib/flags': { isFeatureEnabled: async () => true },
    '@/lib/prisma': { default: { comment: { findFirst: async (query) => { calls.push(query); return null; } } } },
    '@/utils/controllers/projects/getAllIncludes': { projectContentAccessWhere: (...args) => ({ scope: args }) },
    '@/utils/controllers/savedContent/toggleSavedContent': { toggleSavedContent: async () => { throw new Error('must not write'); } },
  });
  const response = await POST(new NextRequest('https://example.test/mcp/comments/7/pin', { method: 'POST' }), { params: Promise.resolve({ comment_id: '7' }) });
  assert.equal(response.status, 404);
  assert.deepEqual(calls[0].where.task, {
    project: { scope: [6, 'agent', context.teamScope] },
    AND: [{ project: { scope: [6] } }],
  });
});

test('a managed agent cannot write a private comment star', async () => {
  const { POST, request, props, created } = setup('star', { validateAuth: async () => ({ user: { id: 6 }, agentId: 'agent', teamScope: null }) });
  const response = await POST(request(), props);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { success: false, error: 'Private comment stars are available only to human accounts' });
  assert.deepEqual(created, []);
});

test('write role refusal prevents changes', async () => {
  const { POST, request, props, created } = setup('pin', { authorizeWrite: async () => Response.json({}, { status: 403 }) });
  assert.equal((await POST(request(), props)).status, 403);
  assert.deepEqual(created, []);
});

test('the comment tool offers pin and star as actions', () => {
  const { AddCommentCrudInputSchema } = jiti(path.join(root, 'src/lib/mcp-server/validations/comment.validation.ts'));
  assert.equal(AddCommentCrudInputSchema.safeParse({ action: 'pin', comment_id: 7 }).success, true);
  assert.equal(AddCommentCrudInputSchema.safeParse({ action: 'star', comment_id: 7 }).success, true);
  assert.equal(AddCommentCrudInputSchema.safeParse({ action: 'pin' }).success, false);
  assert.equal(AddCommentCrudInputSchema.safeParse({ action: 'star', comment_id: 7, text: 'hi' }).success, false);
});
