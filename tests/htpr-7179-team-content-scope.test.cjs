const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { fixture, matches, hydrate } = require('./helpers/agent-board-scope.cjs');

process.env.JWT_SECRET = 'fixture';
process.env.SESSION_SECRET = 'fixture';
const teamScope = { teamId: 'team-a', accessBinding: 'owner:account-a:0' };
const req = (path, method = 'GET', body) => new NextRequest(`http://localhost/api/mcp/${path}`, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });

function teamFixture(mode, actor = 'bound') {
  const f = fixture();
  f.state.enforce = mode === 'ENFORCE';
  if (mode === 'FLAG_ERROR') f.state.flagError = new Error('fixture flag lookup failed');
  f.state.ctx.teamScope = actor === 'bound' ? teamScope : null;
  if (actor === 'human') f.state.ctx.agentId = null;
  const originalProject = f.projects[0];
  const originalTask = f.tasks[0];
  const unrelated = { id: 7, agents: [] };
  const definitions = [
    [15, 'A1', 'team-a', true, false], [16, 'A2', 'team-a', false, true],
    [17, 'A3', 'team-a', false, false], [25, 'B1', 'team-b', true, false],
    [26, 'B2', 'team-b', false, true], [35, 'C1', 'team-c', false, false],
    [45, 'L', null, true, false],
  ];
  f.projects.splice(0, f.projects.length, ...definitions.map(([id, label, teamId, owned, member]) => {
    const humanMember = { userId: f.user.id, user: f.user, agentId: null, status: 'Accepted' };
    const grant = (label === 'A1' || label === 'A2' || actor === 'unbound' && ['B1', 'B2'].includes(label));
    return { ...originalProject, id, title: `${label}-sentinel`, name: label, uniqueIdentifier: label, teamId, ownerId: owned ? f.user.id : unrelated.id, owner: owned ? f.user : unrelated, members: [...(member ? [humanMember] : []), ...(grant ? [{ userId: f.user.id, agentId: f.agent.id, status: 'Accepted', agent: f.agent }] : [])] };
  }));
  f.tasks.splice(0, f.tasks.length, ...f.projects.map(project => ({ ...originalTask, id: project.id * 10, projectId: project.id, project, title: `${project.name}-sentinel`, description: `${project.name}-sentinel`, description_: { content: `${project.name}-sentinel` }, ticketNumber: `${project.name}-1`, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), dueDate: null, savedContent: [], _count: { comments: 1, taskLabels: 0 } })));
  f.agent.members = f.projects.filter(p => p.members.some(m => m.agentId === f.agent.id)).map(project => ({ project }));
  function model(rows, name) {
    return {
      findFirst: async args => hydrate(rows.find(row => matches(row, args.where)), args),
      findUnique: async args => hydrate(rows.find(row => matches(row, args.where)), args),
      findMany: async (args = {}) => rows.filter(row => matches(row, args.where)).map(row => hydrate(row, args)),
      count: async ({ where }) => rows.filter(row => matches(row, where)).length,
      create: async ({ data }) => { f.writes.push(name); return { id: 900, createdAt: new Date('2026-01-01'), ...data }; },
      updateMany: async () => { f.writes.push(name); return { count: 1 }; },
    };
  }
  const pages = f.tasks.map(task => ({ id: task.id, publicId: `page-${task.projectId}`, projectId: task.projectId, project: task.project, taskId: null, task: null, links: [], _count: { links: 0 }, subPages: [], parentPage: null, parentPageId: null, archived: false, title: task.title, contentHtml: `<p>${task.title}</p>`, contentText: task.title, version: 1, updatedAt: task.updatedAt }));
  const comments = f.tasks.map(task => ({ id: task.id, taskId: task.id, task, creatorId: f.user.id, creator: f.user, text: task.title, activity: null, createdAt: task.createdAt, editedAt: null, editedByUserId: null, editedByAgentId: null, attachments: [], reactions: [], agent: null }));
  f.prisma.section = model(f.projects.map(project => ({ id: project.id, projectId: project.id, section_title: 'Todo', visibility: true, deleted: false, ranking: 'a' })), 'section');
  f.prisma.page = model(pages, 'page');
  f.prisma.comment = model(comments, 'comment');
  const agents = { getMcpSessionAgentSummary: async () => null, mapVisibleMcpAgent: () => null, mcpVisibleAgentSelect: () => ({ id: true }), loadVisibleMcpAgents: async () => new Map() };
  Object.assign(f.mocks, {
    '@/utils/controllers/comments/processMentions': { convertPlainTextMentionsToHtml: text => text, resolveTextMentions: async text => text },
    '@/utils/helperFunctions/multiPages': { extractTipTapContent: () => ({ mentions: [] }) },
    '@/lib/mcp/agents': agents,
    '@/lib/mcp/agents/scopes': { requireRole: async () => null },
    '@/utils/controllers/activities/createLabelActivity': {},
    '@/lib/agentWebhooks/outbox': {},
    '@/utils/controllers/urls/extractUrlsFromContent': { persistUrlsForDescription: async () => {}, persistUrlsForComment: async () => {} },
    '@/utils/controllers/pages/standalonePagesEnabled': { standalonePagesEnabled: async () => true },
    '@/utils/controllers/turbopuffer/turbopufferHelper': { convertToPlain: s => s, upsertPageToTurbopuffer: async () => {}, deletePageFromTurbopuffer: async () => {} },
  });
  const services = f.load('src/lib/mcp/tasks/services.ts');
  f.mocks['@/lib/mcp/tasks/services'] = services;
  return { ...f, pages, comments, model, services };
}

async function assertResult(response, allowed, sentinel, writes, before) {
  assert.equal(response.status, allowed ? 200 : response.status === 403 ? 403 : 404);
  const body = await response.json();
  const text = JSON.stringify(body);
  if (allowed) assert.ok(text.includes(sentinel), 'positive control returns the fixture content');
  else {
    assert.ok(!text.includes(sentinel), 'refusal does not disclose the denied sentinel');
    assert.equal(writes.length, before, 'refusal causes no protected write');
  }
  return body;
}

for (const mode of ['WATCH', 'ENFORCE', 'FLAG_ERROR']) {
  for (const actor of ['bound', 'unbound', 'human']) {
    test(`${mode} ${actor}: all five predicate families intersect rather than grant team access`, async () => {
      const f = teamFixture(mode, actor);
      await f.run(req('tasks'), async () => {
        for (const helper of ['getProjectWhere', 'getProjectListingWhere', 'projectContentAccessWhere', 'taskWriteAccessWhere', 'savedViewBoardAccessWhere']) {
          const where = f.access[helper](f.user.id, f.state.ctx.agentId, f.state.ctx.teamScope);
          const ids = f.projects.filter(p => matches(p, where)).map(p => p.id);
          assert.ok(ids.includes(15));
          assert.ok(ids.includes(16));
          assert.ok(!ids.includes(17));
          assert.ok(!ids.includes(35));
          assert.equal(ids.includes(25), actor !== 'bound');
          assert.equal(ids.includes(26), actor !== 'bound');
          if (actor === 'bound') assert.ok(!ids.includes(45));
          else assert.equal(JSON.stringify(where), JSON.stringify(f.access[helper](f.user.id, f.state.ctx.agentId)), 'unbound output is byte-identical');
          for (const malformed of [{}, { teamId: '', accessBinding: 'fixture' }, { teamId: 'team-a' }, { teamId: 'team-a', accessBinding: '' }]) {
            assert.deepEqual(f.projects.filter(p => matches(p, f.access[helper](f.user.id, f.state.ctx.agentId, malformed))), []);
          }
        }
      });
    });

    for (const operation of ['get', 'list', 'search']) {
      test(`${mode} ${actor}: task ${operation} A still allowed, B refused or unchanged`, async () => {
        const f = teamFixture(mode, actor);
        const extra = operation === 'search' ? {
          '@/utils/controllers/search/document': { turbopufferSearchTaskIds: async () => f.tasks.map(t => t.id) },
          '@/lib/search/serverOperators': { parseSearchWithChipNames: async query => ({ text: query, filters: {} }) },
        } : {};
        const route = f.load(`src/lib/mcp/operations/tasks/${operation === 'search' ? 'search/' : ''}operation.ts`, extra);
        for (const board of [15, 16, 25, 26]) {
          const path = operation === 'get' ? `tasks?task_id=${board * 10}` : operation === 'list' ? `tasks?project_id=${board}` : `tasks/search?query=sentinel&project_id=${board}`;
          await assertResult(await route.GET(req(path)), actor !== 'bound' || board < 20, `${f.projects.find(p => p.id === board).name}-sentinel`, f.writes, 0);
        }
        const broad = await route.GET(req(operation === 'search' ? 'tasks/search?query=sentinel' : 'tasks'));
        assert.equal(broad.status, 200);
        const text = JSON.stringify(await broad.json());
        assert.ok(text.includes('A1-sentinel'));
        assert.equal(text.includes('B1-sentinel'), actor !== 'bound');
        assert.equal(text.includes('B2-sentinel'), actor !== 'bound');
      });
    }

    test(`${mode} ${actor}: real task creation authorization refuses B before its producer`, async () => {
      const f = teamFixture(mode, actor);
      f.mocks['@/lib/mcp/routeWrapper'].readMcpRouteJsonBody = async request => ({ ok: true, body: await request.json() });
      const route = f.load('src/lib/mcp/operations/tasks/create/operation.ts', {
        '@/utils/controllers/agents/boardMembers': { isAgentOnBoard: async () => true },
        '@/lib/media/inlineAgentImages.server': { inlineAgentImagesForUser: async text => text },
        '@/lib/mcp/tasks/mappers': { mapTaskToDetail: task => task },
        '@/lib/mcp/tasks/services': { ...f.services, createTask: async data => { f.writes.push('task'); return { id: 900, title: data.title, projectId: data.projectId }; } },
        '@/lib/mcp/idempotency/idempotencyStore': { normalizeIdempotencyKey: () => null, withIdempotency: async (_op, _user, _key, _body, run) => run() },
      });
      for (const board of [15, 16, 25, 26]) {
        const sentinel = `${f.projects.find(p => p.id === board).name}-sentinel`;
        const before = f.writes.length;
        const result = await route.POST(req('tasks/create', 'POST', { project_id: board, title: sentinel, description: 'fixture' }));
        await assertResult(result, actor !== 'bound' || board < 20, sentinel, f.writes, before);
      }
    });

    test(`${mode} ${actor}: real update preflight refuses B before persistence`, async () => {
      const f = teamFixture(mode, actor);
      const { executeTaskUpdateV2 } = f.load('src/lib/mcp/tasks/updateTaskV2.ts', {
        '@/lib/pullRequests/taskPullRequests': {},
        './fields/persist': { persistTaskUpdates: async (_ctx, tasks) => { f.writes.push('task'); return { success: true, tasks: tasks.map(t => ({ id: t.id, title: `${f.projects.find(p => p.id === t.projectId).name}-sentinel` })) }; } },
      });
      for (const board of [15, 16, 25, 26]) {
        const before = f.writes.length;
        const request = req('tasks/update', 'POST', { task_id: board * 10, title: 'Updated' });
        const result = await f.run(request, () => executeTaskUpdateV2({ request, ctx: f.state.ctx, requestBody: { task_id: board * 10, title: 'Updated' } }));
        await assertResult(result.response, actor !== 'bound' || board < 20, `${f.projects.find(p => p.id === board).name}-sentinel`, f.writes, before);
      }
    });

    test(`${mode} ${actor}: comment list returns A and refuses B without content`, async () => {
      const f = teamFixture(mode, actor);
      const route = f.load('src/lib/mcp/operations/comments/operation.ts', {
        '@/lib/mcp/comments/visibleReactionAgents': { loadVisibleReactionAgents: async () => new Map() },
        '@/utils/controllers/comments/createCommentService': {},
      });
      for (const board of [15, 16, 25, 26]) {
        await assertResult(await route.GET(req(`comments?task_id=${board * 10}&include_activity=true`)), actor !== 'bound' || board < 20, `${f.projects.find(p => p.id === board).name}-sentinel`, f.writes, 0);
      }
    });

    test(`${mode} ${actor}: comment access and creation use the real resolver and locked predicate`, async () => {
      const f = teamFixture(mode, actor);
      const { findTaskByIdentifier } = f.load('src/lib/mcp/tasks/resolveTask.ts');
      const { persistComment } = f.load('src/utils/controllers/comments/persistComment.ts', { './agentCommentFanout': { findCommentWebhookAgentIds: async () => [], isAgentCommentFanoutFixOn: async () => false } });
      f.prisma.$queryRaw = async () => [{ id: 1 }];
      for (const board of [15, 16, 25, 26]) {
        await f.run(req('comments', 'POST'), async () => {
          const resolved = await findTaskByIdentifier(f.user, { task_id: board * 10 }, f.state.ctx.agentId, undefined, f.state.ctx.teamScope);
          const allowed = actor !== 'bound' || board < 20;
          assert.equal(Boolean(resolved), allowed);
          const rows = resolved ? await f.prisma.comment.findMany({ where: { taskId: resolved.id } }) : [];
          assert.equal(rows.length, allowed ? 1 : 0);
          const before = f.writes.length;
          const params = { text: `${f.projects.find(p => p.id === board).name}-sentinel`, creatorId: f.user.id, taskId: board * 10, currentUser: f.user, ownerId: f.user.id, agentId: f.state.ctx.agentId, teamScope: f.state.ctx.teamScope };
          const dependencies = { prisma: f.prisma, taskWriteAccessWhere: f.access.taskWriteAccessWhere, claimPendingAgentInvocation: async () => null, persistBoardWebhookEvents: async () => [], persistAgentWebhookEvents: async () => [], persistAgentTaskRunPromptWebhooks: async () => [] };
          if (!allowed) await assert.rejects(persistComment(dependencies, params, params.text, f.user.id, 0, []), /not found or access denied/);
          else {
            const result = await persistComment(dependencies, params, params.text, f.user.id, 0, []);
            assert.equal(result.comment.text, params.text);
            assert.equal(f.writes.length, before + 1);
          }
          if (!allowed) assert.equal(f.writes.length, before);
        });
      }
    });

    for (const operation of ['get', 'list']) {
      test(`${mode} ${actor}: page ${operation} authorizes the page's own board, including standalone pages`, async () => {
        const f = teamFixture(mode, actor);
        const route = f.load(`src/lib/mcp/operations/pages/${operation}/operation.ts`, { '@/utils/controllers/pages/htmlToMarkdown': { htmlToMarkdown: s => s } });
        for (const board of [15, 16, 25, 26]) {
          const path = operation === 'get' ? `pages/get?id=${board * 10}&format=html` : `pages/list?project_id=${board}`;
          await assertResult(await route.GET(req(path)), actor !== 'bound' || board < 20, `${f.projects.find(p => p.id === board).name}-sentinel`, f.writes, 0);
        }
      });
    }
  }

  test(`${mode}: signed bridge round trip retains A authorization and refuses B`, async () => {
    const f = teamFixture(mode);
    Object.assign(f.agent, { credentialTeamId: teamScope.teamId, credentialTeamAccessBinding: teamScope.accessBinding, mcpTokenJti: 'fixture-generation' });
    f.prisma.team.findFirst = async () => ({ id: 'team-a', title: 'A', googleAccount: { id: 'account-a', userId: f.user.id }, managementKeyOwnerGeneration: 0, members: [] });
    const { signSession } = f.load('src/lib/auth/session.ts');
    const { getSessionUser } = f.load('src/lib/auth/getSessionUser.ts', { '@/lib/auth/sessionRevocation': { isSessionTokenRevoked: async () => false } });
    const { taskAccessWhere } = f.load('src/utils/controllers/tasks/assertTaskAccess.ts');
    await f.run(req('tasks/update', 'POST'), async () => {
      const session = await getSessionUser(new Headers({ Cookie: `ht_session=${signSession({ id: f.user.id, agentId: f.agent.id, teamScope, agentTokenGeneration: 'fixture-generation' })}` }));
      assert.deepEqual(session.teamScope, teamScope);
      for (const [id, allowed] of [[150, true], [250, false]]) {
        const task = await f.prisma.task.findFirst({ where: taskAccessWhere(session.userId, id, { agentId: session.agentId, teamScope: session.teamScope }) });
        assert.equal(Boolean(task), allowed);
      }
    });
  });
}

for (const mode of ['WATCH', 'ENFORCE', 'FLAG_ERROR']) {
  test(`${mode}: custom task filter cannot override the team boundary; scope does not grant unrelated A boards`, async () => {
    const f = teamFixture(mode);
    const resolver = f.load('src/lib/mcp/tasks/resolveTask.ts');
    await f.run(req('tasks'), async () => {
      assert.equal((await resolver.findTaskByIdentifier(f.user, { task_id: 150 }, f.agent.id, {}, teamScope)).id, 150);
      assert.equal(await resolver.findTaskByIdentifier(f.user, { task_id: 250 }, f.agent.id, {}, teamScope), null);
      f.projects.find(p => p.id === 16).members = f.projects.find(p => p.id === 16).members.filter(m => !m.agentId);
      assert.equal(Boolean(await resolver.findTaskByIdentifier(f.user, { task_id: 160 }, f.agent.id, undefined, teamScope)), mode !== 'ENFORCE');
      assert.equal(await resolver.findTaskByIdentifier(f.user, { task_id: 170 }, f.agent.id, undefined, teamScope), null);
    });
  });

  test(`${mode}: in-process client retains the complete auth context through a real task operation`, async () => {
    const f = teamFixture(mode);
    const operationContext = f.load('src/lib/mcp/operationContext.ts');
    const taskRoute = f.load('src/lib/mcp/operations/tasks/operation.ts');
    const { createInProcessMcpClient } = f.load('src/lib/mcp/inProcessClient.ts', {
      './auth': f.mocks['@/lib/mcp/auth'],
      './operationContext': operationContext,
      './operations': { executeMcpOperation: async request => {
        const ctx = operationContext.getMcpOperationContext(request).auth;
        assert.deepEqual(ctx.teamScope, teamScope);
        f.state.ctx = ctx;
        return taskRoute.GET(request);
      } },
    });
    const { client, auth } = await createInProcessMcpClient('fixture');
    assert.deepEqual(auth.teamScope, teamScope);
    const allowed = await client.makeRequest('/mcp/tasks?task_id=150');
    assert.equal(allowed.tasks[0].title, 'A1-sentinel');
    await assert.rejects(client.makeRequest('/mcp/tasks?task_id=250'), error => {
      assert.ok(!String(error).includes('B1-sentinel'));
      assert.ok(/not found|access denied/i.test(error.message));
      return true;
    });
    assert.deepEqual(f.writes, []);
  });

  for (const action of ['PATCH', 'DELETE']) {
    test(`${mode}: manual comment ${action} owner checks cannot bypass a bound team`, async () => {
      const f = teamFixture(mode);
      const route = f.load('src/lib/mcp/operations/comments/[comment_id]/operation.ts', {
        '@/lib/media/inlineAgentImages.server': { inlineAgentImagesForUser: async text => text },
        '@/lib/mcp/comments/visibleReactionAgents': { loadVisibleReactionAgents: async () => new Map() },
        '@/utils/controllers/comments/updateCommentService': { updateCommentService: async ({ commentId, text }) => { f.writes.push('comment'); return { ...f.comments.find(c => c.id === commentId), text }; } },
        '@/utils/controllers/comments/deleteCommentService': { deleteCommentService: async () => { f.writes.push('comment'); } },
      });
      for (const board of [15, 25]) {
        const before = f.writes.length;
        const result = await route[action](req(`comments/${board * 10}`, action, action === 'PATCH' ? { text: 'fixture edit' } : undefined), { params: Promise.resolve({ comment_id: String(board * 10) }) });
        assert.equal(result.status, board === 15 ? 200 : 403);
        const text = JSON.stringify(await result.json());
        assert.ok(!text.includes('B1-sentinel'));
        assert.equal(f.writes.length, before + (board === 15 ? 1 : 0));
      }
    });
  }
}

for (const mode of ['WATCH', 'ENFORCE', 'FLAG_ERROR']) {
  test(`${mode}: signed cookie reaches the actual task bridge, A writes and B cannot write`, async () => {
    const f = teamFixture(mode);
    Object.assign(f.agent, { credentialTeamId: teamScope.teamId, credentialTeamAccessBinding: teamScope.accessBinding, mcpTokenJti: 'fixture-generation' });
    f.prisma.team.findFirst = async () => ({ id: 'team-a', title: 'A', googleAccount: { id: 'account-a', userId: f.user.id }, managementKeyOwnerGeneration: 0, members: [] });
    const { signSession } = f.load('src/lib/auth/session.ts');
    const route = f.load('src/lib/api/task-writes/update.ts', {
      '@/lib/auth/sessionRevocation': { isSessionTokenRevoked: async () => false },
      '@/lib/media/inlineAgentImages.server': {},
      '@/utils/controllers/tasks/single': { updateTaskSingle: async (task, _user, agentId, options) => {
        assert.equal(agentId, f.agent.id);
        assert.deepEqual(options.teamScope, teamScope);
        f.writes.push('task');
        return { status: 200, json: task };
      } },
    });
    const token = signSession({ id: f.user.id, agentId: f.agent.id, teamScope, agentTokenGeneration: 'fixture-generation' });
    for (const [id, status] of [[150, 200], [250, 403]]) {
      const before = f.writes.length;
      const result = await route.PUT(new NextRequest('http://localhost/api/tasks/single', {
        method: 'PUT', headers: { Cookie: `ht_session=${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ newTask: { id, title: 'fixture update' }, agentId: f.agent.id }),
      }));
      assert.equal(result.status, status);
      assert.ok(!JSON.stringify(await result.json()).includes('B1-sentinel'));
      assert.equal(f.writes.length, before + (status === 200 ? 1 : 0));
    }
  });
}

for (const mode of ['WATCH', 'ENFORCE', 'FLAG_ERROR']) {
  for (const actor of ['bound', 'unbound', 'human']) {
    test(`${mode} ${actor}: comment create route allows A and refuses B before its writer`, async () => {
      const f = teamFixture(mode, actor);
      f.mocks['@/lib/mcp/routeWrapper'].readMcpRouteJsonBody = async request => ({ ok: true, body: await request.json() });
      const route = f.load('src/lib/mcp/operations/comments/operation.ts', {
        '@/lib/media/inlineAgentImages.server': { inlineAgentImagesForUser: async text => text },
        '@/utils/controllers/comments/processMentions': { resolveTextMentions: async text => text },
        '@/utils/controllers/comments/createCommentService': { createCommentService: async data => {
          assert.deepEqual(data.teamScope, f.state.ctx.teamScope);
          f.writes.push('comment');
          return { id: 900, text: data.text, createdAt: new Date('2026-01-01') };
        } },
        '@/lib/mcp/comments/visibleReactionAgents': { loadVisibleReactionAgents: async () => new Map() },
        '@/lib/mcp/idempotency/idempotencyStore': { normalizeIdempotencyKey: () => null, withIdempotency: async (_op, _user, _key, _body, run) => run() },
      });
      for (const board of [15, 16, 25, 26]) {
        const allowed = actor !== 'bound' || board < 20;
        const before = f.writes.length;
        const sentinel = `${f.projects.find(p => p.id === board).name}-sentinel`;
        const response = await route.POST(req('comments', 'POST', { task_id: board * 10, text: sentinel, kind: 'question' }));
        assert.equal(response.status, allowed ? 201 : 404);
        const text = JSON.stringify(await response.json());
        assert.equal(text.includes(sentinel), allowed);
        assert.equal(f.writes.length, before + (allowed ? 1 : 0));
      }
    });
  }

  for (const action of ['PATCH', 'DELETE', 'publish']) {
    test(`${mode}: manual draft ${action} owner check preserves A and refuses B`, async () => {
      const f = teamFixture(mode);
      const drafts = f.tasks.map(task => ({ id: task.id, taskId: task.id, task, userId: f.user.id, user: f.user, type: 'Comment', content: task.title, updatedAt: task.updatedAt }));
      f.prisma.drafts = {
        ...f.model(drafts, 'draft'),
        update: async args => {
          const draft = drafts.find(row => matches(row, args.where));
          assert.ok(draft);
          f.writes.push('draft');
          return hydrate({ ...draft, ...args.data }, args);
        },
        delete: async args => { assert.ok(drafts.find(row => matches(row, args.where))); f.writes.push('draft'); },
      };
      const route = f.load(`src/lib/mcp/operations/drafts/[draft_id]/${action === 'publish' ? 'publish/' : ''}operation.ts`, {
        '@/utils/controllers/comments/createCommentService': { createCommentService: async data => {
          assert.deepEqual(data.teamScope, teamScope);
          f.writes.push('comment');
          return { id: 900 };
        } },
      });
      for (const board of [15, 25]) {
        const before = f.writes.length;
        const response = await route[action === 'publish' ? 'POST' : action](req(`drafts/${board * 10}`, action === 'publish' ? 'POST' : action, action === 'PATCH' ? { text: 'fixture edit' } : undefined), { params: Promise.resolve({ draft_id: String(board * 10) }) });
        assert.equal(response.status, board === 15 ? 200 : 403);
        assert.ok(!JSON.stringify(await response.json()).includes('B1-sentinel'));
        assert.equal(f.writes.length, before + (board === 15 ? 1 : 0));
      }
    });
  }
}
