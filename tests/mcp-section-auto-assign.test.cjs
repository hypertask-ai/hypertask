const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function loadSectionServices({ memberCheck, agentOnBoard }) {
  const source = ts.transpileModule(
    read("src/lib/mcp/sections/services.ts"),
    {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  const updateCalls = [];
  const prisma = {
    project: {
      findFirst: async () => ({ id: 15 }),
    },
    section: {
      findFirst: async () => ({
        id: 4389,
        projectId: 15,
        deleted: false,
      }),
    },
  };
  const sectionService = {
    updateSection: async (input) => {
      updateCalls.push(input);
      return {
        status: 200,
        json: {
          id: 4389,
          section_title: "Bugs",
          projectId: 15,
          visibility: true,
          deleted: false,
          ranking: "A1",
          isDone: null,
          autoAssignUserId: input.autoAssignUserId ?? null,
          autoAssignAgentId: input.autoAssignAgentId ?? null,
        },
      };
    },
  };
  const mod = { exports: {} };
  new Function("module", "exports", "require", source)(
    mod,
    mod.exports,
    (request) => {
      const stubs = {
        "@/lib/prisma": prisma,
        "@/utils/controllers/projects/getAllIncludes": {
          getProjectWhere: () => ({}),
        },
        "@/utils/controllers/section/sectionService": sectionService,
        "@/lib/mcp/tasks/services": {
          validateProjectMemberIds: memberCheck,
        },
        "@/utils/controllers/agents/boardMembers": {
          isAgentOnBoard: agentOnBoard,
        },
      };
      return stubs[request] ?? require(request);
    },
  );
  return { ...mod.exports, updateCalls };
}

test("MCP section updates store and return a user auto-assignee", async () => {
  const service = loadSectionServices({
    memberCheck: async () => ({ invalidIds: [] }),
    agentOnBoard: async () => false,
  });

  const result = await service.updateSection({
    projectId: 15,
    sectionId: 4389,
    userId: 6,
    autoAssign: 6,
  });

  assert.equal(result.success, true);
  assert.equal(result.section.autoAssign, 6);
  assert.equal(service.updateCalls[0].autoAssignUserId, 6);
  assert.equal(service.updateCalls[0].autoAssignAgentId, null);
});

test("MCP section updates store and return an agent auto-assignee", async () => {
  const agentId = "33832850-a941-4a7e-922a-8751ce80197e";
  const service = loadSectionServices({
    memberCheck: async () => ({ invalidIds: [] }),
    agentOnBoard: async (_projectId, candidate) => candidate === agentId,
  });

  const result = await service.updateSection({
    projectId: 15,
    sectionId: 4389,
    userId: 6,
    autoAssign: agentId,
  });

  assert.equal(result.success, true);
  assert.equal(result.section.autoAssign, agentId);
  assert.equal(service.updateCalls[0].autoAssignUserId, null);
  assert.equal(service.updateCalls[0].autoAssignAgentId, agentId);
});

test("MCP section updates clear both auto-assignee fields", async () => {
  const service = loadSectionServices({
    memberCheck: async () => ({ invalidIds: [] }),
    agentOnBoard: async () => false,
  });

  const result = await service.updateSection({
    projectId: 15,
    sectionId: 4389,
    userId: 6,
    autoAssign: null,
  });

  assert.equal(result.success, true);
  assert.equal(result.section.autoAssign, null);
  assert.equal(service.updateCalls[0].autoAssignUserId, null);
  assert.equal(service.updateCalls[0].autoAssignAgentId, null);
});

test("MCP section updates reject auto-assignees outside the board", async () => {
  const userService = loadSectionServices({
    memberCheck: async () => ({ invalidIds: [42] }),
    agentOnBoard: async () => false,
  });
  const userResult = await userService.updateSection({
    projectId: 15,
    sectionId: 4389,
    userId: 6,
    autoAssign: 42,
  });
  assert.equal(userResult.success, false);
  assert.equal(userResult.status, 400);
  assert.equal(userService.updateCalls.length, 0);

  const agentService = loadSectionServices({
    memberCheck: async () => ({ invalidIds: [] }),
    agentOnBoard: async () => false,
  });
  const agentResult = await agentService.updateSection({
    projectId: 15,
    sectionId: 4389,
    userId: 6,
    autoAssign: "deleted-agent",
  });
  assert.equal(agentResult.success, false);
  assert.equal(agentResult.status, 400);
  assert.equal(agentService.updateCalls.length, 0);
});

test("MCP section list and update routes expose autoAssign", () => {
  const listRoute = read("src/lib/mcp/operations/projects/[projectId]/sections/operation.ts");
  const updateRoute = read(
    "src/lib/mcp/operations/projects/[projectId]/sections/[sectionId]/operation.ts",
  );

  assert.match(listRoute, /autoAssignUserId: true/);
  assert.match(listRoute, /autoAssignAgentId: true/);
  assert.match(listRoute, /autoAssign: section\.autoAssignAgentId \?\? section\.autoAssignUserId \?\? null/);
  assert.match(updateRoute, /['"]auto_assign['"] in body/);
  assert.match(updateRoute, /isDone,\s*autoAssign/);
});

function sectionMutationHarness({ role = 'write', human = false, scopeEnforced = true } = {}) {
  const { fixture, matches, hydrate } = require('./helpers/agent-board-scope.cjs');
  const { loadRouteWrapper } = require('./helpers/mcp-route-wrapper.cjs');
  const { NextRequest } = require('next/server');
  const f = fixture();
  f.state.enforce = scopeEnforced;
  f.agent.permissions = role ? { role } : {};
  if (human) f.state.ctx.agentId = null;
  const effects = [];
  const sections = [
    { id: 15, projectId: 15, section_title: 'Todo', ranking: 'a', deleted: false, visibility: true, isDone: null },
    { id: 16, projectId: 15, section_title: 'Done', ranking: 'b', deleted: false, visibility: true, isDone: true },
    { id: 4060, projectId: 4060, section_title: 'Other', ranking: 'a', deleted: false, visibility: true },
  ];
  f.prisma.section = {
    findFirst: async (args) => hydrate(sections.find((row) => matches(row, args.where)), args),
    findUnique: async (args) => hydrate(sections.find((row) => matches(row, args.where)), args),
    findMany: async (args) => sections.filter((row) => matches(row, args.where)).map((row) => hydrate(row, args)),
    create: async ({ data }) => {
      const row = { id: 17, ...data, projectId: data.project.connect.id };
      sections.push(row);
      f.state.writes.push('section.create');
      return { ...row };
    },
    update: async ({ where, data }) => {
      const row = sections.find((candidate) => matches(candidate, where));
      assert.ok(row);
      Object.assign(row, data);
      f.state.writes.push('section.update');
      return { ...row };
    },
  };
  f.prisma.task.updateManyAndReturn = async ({ where, data }) => {
    const rows = f.tasks.filter((row) => matches(row, where));
    rows.forEach((row) => Object.assign(row, data));
    if (rows.length) f.state.writes.push('task.update');
    return rows.map((row) => ({ ...row }));
  };
  f.prisma.taskSectionEvent = { createMany: async () => { f.state.writes.push('taskSectionEvent.create'); return { count: 1 }; } };
  f.prisma.$queryRaw = async (_query, projectId, sectionId, title) => f.tasks.filter((row) =>
    row.projectId === projectId && row.status === 'Normal' && (row.sectionId === sectionId || row.section === title),
  ).map((row) => ({ ...row }));
  const record = (name) => async () => { effects.push(name); return name; };
  const controller = f.load('src/utils/controllers/section/sectionService.ts', {
    '@/utils/generateRank': { default: () => 'c' },
    '@/utils/controllers/notifications/agentFirstTaskEmail': { scheduleAgentFirstTaskEmailBatch: record('email') },
    '@/lib/telemetry/activationOccurrences': { enqueueAgentTaskCompletion: record('completion') },
    '@/lib/telemetry/savedWork': {
      enqueueColumnCreated: record('column.created'),
      enqueueColumnRenamed: record('column.renamed'),
      processAnalyticsIntentSoon: record('analytics.process'),
    },
    './viewHelpers': {
      appendSectionToAllViews: record('view.append'),
      updateSectionInAllViews: record('view.update'),
      removeSectionFromAllViews: record('view.remove'),
    },
  });
  const services = f.load('src/lib/mcp/sections/services.ts', {
    '@/utils/controllers/section/sectionService': controller,
    '@/lib/mcp/tasks/services': { validateProjectMemberIds: async (_id, ids) => ({ invalidIds: ids.filter((id) => id !== 6) }) },
    '@/utils/controllers/agents/boardMembers': { isAgentOnBoard: async (_id, id) => id === f.agent.id },
  });
  const mocks = {
    ...f.mocks,
    '@/lib/mcp/sections/services': services,
    '@/lib/mcp/auth': {
      validateMcpAuth: async () => {
        await f.scope.prepareAgentScope(f.state.ctx.user.id, f.state.ctx.agentId);
        return f.state.ctx;
      },
      checkMcpRateLimit: async () => null,
    },
    '@/lib/mcp/readListQuery': { readListQuery: () => ({ listQuery: null }) },
    '@/lib/aiFeedback/automatic': { queueRestFailure: () => {} },
    '@/lib/mcp/tasks/agentMutationLeaseAdoption': {},
    '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash: (request, error) => { throw error; } },
    '@/lib/realtime/server': { broadcastBoardChange: record('broadcast') },
  };
  mocks['@/lib/mcp/routeWrapper'] = loadRouteWrapper(mocks);
  const collection = f.load('src/lib/mcp/operations/projects/[projectId]/sections/operation.ts', mocks);
  const item = f.load('src/lib/mcp/operations/projects/[projectId]/sections/[sectionId]/operation.ts', mocks);
  const invoke = (method, body = { title: 'Renamed' }, sectionId = '15') => {
    const route = method === 'POST' || method === 'GET' ? collection : item;
    const request = new NextRequest(`https://app.hypertask.ai/api/mcp/projects/15/sections${method === 'POST' || method === 'GET' ? '' : `/${sectionId}`}`, {
      method,
      headers: { Authorization: `Bearer ${require('jsonwebtoken').sign({ userId: 6 }, 'fixture-section-key')}`, 'Content-Type': 'application/json' },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    });
    return route[method](request, { params: Promise.resolve({ projectId: '15', sectionId }) });
  };
  return { ...f, effects, sections, invoke };
}

for (const scopeEnforced of [false, true]) {
  const mode = `scope=${scopeEnforced ? 'ENFORCE' : 'WATCH'}`;


  test(`read agents cannot PATCH, DELETE or create sections (${mode})`, async () => {
    for (const method of ['PATCH', 'DELETE', 'POST']) {
      const h = sectionMutationHarness({ role: 'read', scopeEnforced });
      const response = await h.invoke(method);
      assert.equal(response.status, 403, method);
      assert.equal((await response.json()).code, 'insufficient_scope');
      assert.equal(response.headers.has('Server-Timing'), true);
      assert.deepEqual(h.state.writes, []);
      assert.deepEqual(h.effects, []);
      assert.equal(h.tasks[0].section, 'Todo');
      assert.equal(h.sections[0].deleted, false);
      assert.ok(h.state.flagReads > 0);
    }
  });

  test(`write/admin and human section mutations retain behavior (${mode})`, async () => {
    for (const role of ['write', 'admin', null, 'human']) {
      for (const method of ['PATCH', 'DELETE', 'POST']) {
        const h = sectionMutationHarness({ role, human: role === 'human', scopeEnforced });
        const response = await h.invoke(method);
        assert.equal(response.status, 200, `${role} ${method}`);
        assert.equal((await response.json()).success, true);
        assert.equal(response.headers.has('Server-Timing'), true);
        assert.ok(h.effects.includes('broadcast'));
        if (method === 'PATCH') {
          assert.equal(h.sections[0].section_title, 'Renamed');
          assert.equal(h.tasks[0].section, 'Renamed');
          assert.ok(h.effects.includes('view.update'));
          assert.ok(h.effects.includes('column.renamed'));
        } else if (method === 'DELETE') {
          assert.equal(h.sections[0].deleted, true);
          assert.equal(h.tasks[0].sectionId, 16);
          assert.equal(h.tasks[0].section, 'Done');
          assert.ok(h.effects.includes('view.remove'));
        } else {
          assert.equal(h.sections.at(-1).section_title, 'Renamed');
          assert.ok(h.effects.includes('view.append'));
          assert.ok(h.effects.includes('column.created'));
        }
        assert.ok(h.state.writes.includes(method === 'POST' ? 'section.create' : 'section.update'));
      }
    }
  });

  test(`write agents retain section resource restrictions (${mode})`, async () => {
    for (const method of ['PATCH', 'DELETE', 'POST']) {
      const h = sectionMutationHarness({ scopeEnforced });
      h.projects[0].ownerId = 99;
      h.projects[0].owner = { id: 99, agents: [] };
      h.projects[0].members = [];
      assert.equal((await h.invoke(method)).status, 403, method);
      assert.deepEqual(h.state.writes, []);
      assert.deepEqual(h.effects, []);
    }
    for (const method of ['PATCH', 'DELETE']) {
      const h = sectionMutationHarness({ scopeEnforced });
      assert.equal((await h.invoke(method, { title: 'Renamed' }, '4060')).status, 404);
      assert.deepEqual(h.state.writes, []);
      assert.deepEqual(h.effects, []);
    }
    for (const auto_assign of [42, 'unlisted-agent']) {
      const h = sectionMutationHarness({ scopeEnforced });
      assert.equal((await h.invoke('PATCH', { auto_assign })).status, 400);
      assert.deepEqual(h.state.writes, []);
      assert.deepEqual(h.effects, []);
    }
    const last = sectionMutationHarness({ scopeEnforced });
    last.sections.splice(1, 1);
    assert.equal((await last.invoke('DELETE')).status, 400);
    assert.deepEqual(last.state.writes, []);
    assert.deepEqual(last.effects, []);
  });

  test(`valid section targets and read-agent GET remain allowed (${mode})`, async () => {
    const readOnly = sectionMutationHarness({ role: 'read', scopeEnforced });
    const listed = await readOnly.invoke('GET');
    assert.equal(listed.status, 200);
    assert.deepEqual((await listed.json()).sections.map((section) => section.id), [15, 16]);
    assert.deepEqual(readOnly.state.writes, []);
    for (const auto_assign of [6, 'scope-agent', null]) {
      const h = sectionMutationHarness({ scopeEnforced });
      const response = await h.invoke('PATCH', { auto_assign });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).section.autoAssign, auto_assign);
    }
    const empty = sectionMutationHarness({ scopeEnforced });
    empty.sections.splice(1, 1);
    empty.tasks[0].status = 'Deleted';
    assert.equal((await empty.invoke('DELETE')).status, 200);
    assert.equal(empty.sections[0].deleted, true);
  });
}
