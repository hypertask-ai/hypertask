const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");
const { matches, hydrate } = require("./helpers/agent-board-scope.cjs");

const createdAt = new Date("2026-10-27T10:00:00Z");
const original = { id: 2128, teamId: "factory", name: "Factory", title: null, status: "Normal", ownerId: 6 };
const target = { id: 4060, teamId: "hypertask", name: "Agents & Infra", title: null, status: "Normal", ownerId: 6 };
const membership = (project, id = 1, status = "Accepted") => ({ id, projectId: project.id, project, status });
function agent(id = "mini-boss", changes = {}) {
  return {
    id, displayName: "Mini Boss", userId: 6, visibility: "PRIVATE", createdAt,
    revokedAt: null, archivedAt: null, credentialTeamId: null, credentialTeamAccessBinding: null,
    crossTeamHomeTeamId: null, permissions: {}, members: [membership(original)], byokApiKeys: [],
    heartbeatAt: null, mcpTokenJti: null, mcpTokenExpiresAt: null, prompt: null,
    ...changes,
  };
}

function harness({ enabled = true, rows = [agent()], ownerAccess = true, access = true, userId = 6 } = {}) {
  const calls = { agents: [], comments: [], flags: [] };
  const comments = [
    { agentId: "mini-boss", task: { project: target }, createdAt },
    { agentId: "mini-boss", task: { project: original }, createdAt: new Date("2026-10-28T10:00:00Z") },
  ];
  const teams = [{ id: target.teamId, googleAccount: { userId: ownerAccess ? 6 : 99 }, members: [] }];
  const projectRows = [original, target].map(project => ({ ...project, owner: { id: 6, displayName: "Owner" }, members: [] }));
  const prisma = {
    agent: { findMany: async args => {
      calls.agents.push(args);
      return rows.filter(row => matches(row, args.where)).map(row => hydrate(row, args));
    } },
    team: { findFirst: async args => hydrate(teams.find(row => matches(row, args.where)), args) },
    project: {
      findFirst: async args => hydrate(projectRows.find(row => access && matches(row, args.where)), args),
      findMany: async args => projectRows.filter(row => access && matches(row, args.where)).map(row => hydrate(row, args)),
    },
    member: { findMany: async args => rows.flatMap(row => row.members.map(member => ({
      ...member, agentId: row.id, userId: row.userId, agent: row, user: { id: row.userId },
    }))).filter(row => matches(row, args.where)).map(row => hydrate(row, args)) },
    comment: { groupBy: async args => {
      calls.comments.push(args);
      const selected = comments.filter(row => matches(row, args.where));
      return [...new Set(selected.map(row => row.agentId))].map(agentId => ({
        agentId, _max: { createdAt: new Date(Math.max(...selected.filter(row => row.agentId === agentId).map(row => row.createdAt.getTime()))) },
      }));
    } },
    oAuthAuthorizationCode: { findMany: async () => [] },
    invite: { findMany: async () => [] },
    user: { findFirst: async () => ({ id: 332, displayName: "HyperAI" }) },
    task: { findMany: async () => [] },
    page: { findMany: async () => [] },
  };
  const mocks = {
    "@/lib/prisma": { default: prisma },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => userId ? { userId } : null },
    "@/lib/flags": {
      isFeatureEnabled: async (key, actor) => {
        calls.flags.push({ key, actor });
        return key === "htpr-8084-cross-team-agents" && enabled;
      },
      isOwnerOrQaUserId: async () => false,
    },
    "@/lib/mcp/auth": {},
    "@/lib/mcp/agents/delegatedAccess": {},
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}), projectContentAccessWhere: () => ({}) },
    "@/utils/controllers/teams/hasTeamMembershipAccess": { hasTeamMembershipAccess: async () => access },
    "@/utils/controllers/agents/ensureDefaultTeamAgent": {},
    "@/lib/agents/maskAgentProviderKey": { maskAgentProviderKey: () => null },
    "@/utils/controllers/pages/standalonePagesEnabled": { standalonePagesEnabled: async () => false },
    "@/lib/aiModelOptions": { aiModelDefinitions: [], aiImageModelDefinitions: [] },
    "../search/document": { turbopufferFetchMentionTasks: async () => [] },
  };
  const teamRoute = load("src/app/api/agents/route.ts", mocks);
  const allRoute = load("src/app/api/agents/all/route.ts", mocks);
  return {
    rows, calls, mocks,
    team: () => teamRoute.GET({ headers: new Headers(), url: `http://localhost/api/agents?teamId=${target.teamId}` }),
    board: () => allRoute.GET({ headers: new Headers(), url: `http://localhost/api/agents/all?projectId=${target.id}` }),
  };
}

for (const enabled of [false, true]) {
  test(`team list original-team filter, cross-team flag ${enabled}`, async () => {
    const shared = agent("shared", { userId: 7, visibility: "TEAM", members: [membership(original), membership(target, 2)] });
    const h = harness({ enabled, rows: [shared] });
    const response = await h.team();
    assert.equal(response.status, 200);
    const { agents } = await response.json();
    assert.deepEqual(agents.map(row => row.id), enabled ? ["shared"] : []);
    if (enabled) {
      assert.deepEqual(agents[0].boards, [{ id: 4060, name: "Agents & Infra" }]);
      assert.deepEqual(h.calls.agents[0].select.members.where, { status: "Accepted", project: { teamId: "hypertask" } });
    }
    assert.ok(h.calls.flags.some(row => row.key === "htpr-8084-cross-team-agents" && row.actor === 6));
  });
}

test("owned cross-team candidates become available without implying board grants", async () => {
  const h = harness();
  const { agents } = await (await h.team()).json();
  assert.deepEqual(agents.map(row => row.id), ["mini-boss"]);
  assert.deepEqual(agents[0].boards, []);
  assert.deepEqual((await (await h.board()).json()).agents, []);
});

test("requested-team lastPostedAt never reveals a newer foreign-team comment", async () => {
  const h = harness({ rows: [agent("mini-boss", { members: [membership(original), membership(target, 2)] })] });
  const { agents } = await (await h.team()).json();
  assert.equal(agents[0].lastPostedAt, createdAt.toISOString());
  assert.deepEqual(agents[0].boards, [{ id: 4060, name: "Agents & Infra" }]);
  assert.deepEqual(h.calls.comments[0].where.task, { project: { teamId: "hypertask" } });
});

test("credential-bound agents cannot become candidates outside credentialTeamId", async () => {
  const rows = [
    agent(),
    agent("foreign-bound", { credentialTeamId: "factory", credentialTeamAccessBinding: "bound" }),
    agent("foreign-bound-unattached", { credentialTeamId: "factory", members: [] }),
    agent("binding-without-team", { credentialTeamAccessBinding: "bound" }),
    agent("target-bound", { credentialTeamId: "hypertask", credentialTeamAccessBinding: "bound" }),
  ];
  const { agents } = await (await harness({ rows }).team()).json();
  assert.deepEqual(agents.map(row => row.id), ["mini-boss", "target-bound"]);
});

test("candidate expansion excludes guests, foreign owners, private identities, revoked and archived agents", async () => {
  const variants = [
    agent("foreign-owned", { userId: 9 }),
    agent("foreign-private-granted", { userId: 9, members: [membership(target)] }),
    agent("revoked", { revokedAt: createdAt }),
    agent("archived", { archivedAt: createdAt }),
  ];
  const { agents } = await (await harness({ rows: [agent(), ...variants] }).team()).json();
  assert.deepEqual(agents.map(row => row.id), ["mini-boss"]);
  assert.deepEqual((await (await harness({ ownerAccess: false }).team()).json()).agents, []);
  assert.equal((await harness({ access: false }).team()).status, 403);
  assert.equal((await harness({ userId: null }).team()).status, 401);
});

for (const enabled of [false, true]) {
  test(`board 4060 includes explicitly granted Mini Boss only with cross-team flag ${enabled}`, async () => {
    const h = harness({ enabled, rows: [agent("mini-boss", { members: [membership(original), membership(target, 2)] })] });
    const response = await h.board();
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).agents.map(row => row.id), enabled ? ["mini-boss"] : []);
  });
}

test("existing mention and assignment entry points expose Mini Boss after explicit grant, not before", async () => {
  const h = harness();
  const mention = load("src/utils/controllers/tasks/taskSearchByParam.ts", h.mocks).default;
  const assignment = load("src/pages/api/members/getAllForAssignees.ts", h.mocks).default;
  async function assignedAgents() {
    let status;
    let body;
    const res = { status(value) { status = value; return this; }, json(value) { body = value; return this; } };
    await assignment({ method: "GET", headers: {}, query: { projectId: "4060" } }, res);
    assert.equal(status, 200);
    return body.boardAgents;
  }
  assert.deepEqual((await mention("Mini Boss", 6, 4060)).json.filter(row => row.type === "agent"), []);
  assert.deepEqual(await assignedAgents(), []);
  h.rows[0].members.push(membership(target, 2));
  const result = await mention("Mini Boss", 6, 4060);
  assert.equal(result.status, 200);
  assert.deepEqual(result.json.filter(row => row.type === "agent"), [
    { id: "mini-boss", name: "Mini Boss", userId: 6, type: "agent" },
  ]);
  assert.deepEqual((await assignedAgents()).map(row => row.id), ["mini-boss"]);
});

const { addExistingAgentGroups } = load("src/lib/agents/addExistingAgentGroups.ts", {});
for (const enabled of [false, true]) {
  test(`existing picker group permits cross-team identities only with flag ${enabled}`, () => {
    const rows = [agent()].map(row => ({ ...row, boards: [{ ...original, teamName: "Factory" }] }));
    const groups = addExistingAgentGroups(rows, 4060, "hypertask", "mini", enabled);
    assert.deepEqual(groups.onThisTeam.map(row => row.id), enabled ? ["mini-boss"] : []);
    assert.equal(groups.unavailable.length, enabled ? 0 : 1);
    assert.deepEqual(addExistingAgentGroups(rows, 4060, null, "", enabled).onThisTeam, []);
    assert.deepEqual(addExistingAgentGroups(rows, 4060, "hypertask", "absent", enabled).onThisTeam, []);
  });
}

test("picker still excludes revoked, archived, and already-granted identities", () => {
  const rows = [
    { ...agent(), boards: [original] },
    { ...agent("revoked", { revokedAt: createdAt.toISOString() }), boards: [original] },
    { ...agent("archived", { archivedAt: createdAt.toISOString() }), boards: [original] },
    { ...agent("member"), boards: [target] },
  ];
  const groups = addExistingAgentGroups(rows, 4060, "hypertask", "", true);
  assert.deepEqual(groups.onThisTeam.map(row => row.id), ["mini-boss"]);
  assert.deepEqual(groups.unavailable.map(row => row.agent.id), ["revoked"]);
});

test("board list excludes a pending cross-team invitation", async () => {
  const h = harness({ rows: [
    agent("mini-boss", { members: [membership(original), membership(target, 2)] }),
    agent("pending", { members: [membership(original), membership(target, 3, "Pending")] }),
  ] });
  assert.deepEqual((await (await h.board()).json()).agents.map(row => row.id), ["mini-boss"]);
});

function pickerHarness(enabled) {
  const fs = require("node:fs");
  const path = require("node:path");
  const ts = require("typescript");
  let query;
  let groupArgs;
  const rows = [agent(), agent("foreign-bound", { credentialTeamId: "factory" })]
    .map(row => ({ ...row, boards: [original] }));
  const mocks = {
    react: {
      Fragment: Symbol.for("react.fragment"), useEffect() {},
      useRef: value => ({ current: value }), useState: value => [value, () => {}],
    },
    "next/link": { default() {} },
    "next/navigation": { useRouter: () => ({}) },
    "@tanstack/react-query": {
      useQuery: options => { query = options; return { data: rows }; },
      useQueryClient: () => ({}),
    },
    "react-hot-toast": { default: {} },
    "@/components/Common/CommonModalComponents": {},
    "@/components/Common/UserAvatar": { default() {} },
    "@/hooks/MultiPages/useAgents": { useAgents: () => ({ addAgentToBoard: {} }) },
    "@/lib/agents/addExistingAgentGroups": {
      addExistingAgentGroups: (...args) => { groupArgs = args; return addExistingAgentGroups(...args); },
    },
    "@/lib/constants/keyboard-handler": { KeyCodes: {} },
    "@/lib/state": { useRecoilValue: () => ({ id: 6 }) },
    "@/store": { currentUserAtom: {} },
    "@/hooks/useFlag": { useFlag: key => { assert.equal(key, "htpr-8084-cross-team-agents"); return enabled; } },
    "@/lib/flags/definitions/htpr-8084-cross-team-agents": { HTPR_8084_CROSS_TEAM_AGENTS_FLAG: "htpr-8084-cross-team-agents" },
  };
  const filename = path.resolve(__dirname, "../src/components/Modals/Settings/AddExistingAgentPicker.tsx");
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", compiled)(specifier => {
    if (Object.hasOwn(mocks, specifier)) return { __esModule: true, ...mocks[specifier] };
    assert.equal(specifier, "react/jsx-runtime");
    return require(specifier);
  }, loadedModule, loadedModule.exports);
  loadedModule.exports.default({ projectId: 4060, boardName: "Agents & Infra", boardTeamId: "hypertask", onClose() {} });
  return { query, groupArgs, rows };
}

for (const enabled of [false, true]) {
  test(`existing caller passes flag ${enabled} and intersects server eligibility before grouping`, async () => {
    const h = pickerHarness(enabled);
    assert.equal(h.groupArgs[4], enabled);
    assert.deepEqual(h.query.queryKey, ["htpr-7577-owned-agents", 6, "hypertask", enabled]);
    const urls = [];
    const previous = global.fetch;
    global.fetch = async url => {
      urls.push(url);
      return Response.json({ success: true, agents: url === "/api/agents/owned" ? h.rows : [{ id: "mini-boss" }] });
    };
    try {
      const rows = await h.query.queryFn();
      assert.deepEqual(rows.map(row => row.id), enabled ? ["mini-boss"] : ["mini-boss", "foreign-bound"]);
      assert.deepEqual(urls, enabled ? ["/api/agents/owned", "/api/agents?teamId=hypertask"] : ["/api/agents/owned"]);
    } finally {
      global.fetch = previous;
    }
  });
}

test("picker refuses to offer candidates when server eligibility fails", async () => {
  const h = pickerHarness(true);
  const previous = global.fetch;
  global.fetch = async url => url === "/api/agents/owned"
    ? Response.json({ success: true, agents: h.rows })
    : Response.json({ success: false, error: "Team access denied" }, { status: 403 });
  try {
    await assert.rejects(h.query.queryFn(), /Team access denied/);
  } finally {
    global.fetch = previous;
  }
});

test("flag Off uses durable home after original board removal, never the new first membership", async () => {
  const h = harness({ enabled: false, rows: [agent("mini-boss", {
    crossTeamHomeTeamId: "factory", members: [membership(target, 2)],
  })] });
  assert.deepEqual((await (await h.team()).json()).agents, []);
  assert.deepEqual((await (await h.board()).json()).agents, []);
});

test("flag Off keeps original-home grants even when another membership comes first", async () => {
  const h = harness({ enabled: false, rows: [agent("mini-boss", {
    crossTeamHomeTeamId: "hypertask", members: [membership(original), membership(target, 2)],
  })] });
  const { agents } = await (await h.team()).json();
  assert.deepEqual(agents.map(row => row.id), ["mini-boss"]);
  assert.equal(Object.hasOwn(agents[0], "crossTeamHomeTeamId"), false);
  assert.deepEqual((await (await h.board()).json()).agents.map(row => row.id), ["mini-boss"]);
});

function detailHarness({ enabled = true, changes = {}, targetMembership = null, actingAgentId = null } = {}) {
  const projects = [
    { ...original, team: { id: "factory", title: "Factory", googleAccount: { userId: 6 }, members: [] } },
    { ...target, team: { id: "hypertask", title: "Hypertask", googleAccount: { userId: targetMembership ? 99 : 6 }, members: targetMembership ? [{ userId: 6, status: targetMembership }] : [] } },
    { id: 8084, name: "Guest board", title: null, status: "Normal", teamId: "guest", team: { id: "guest", title: "Guest team", googleAccount: { userId: 99 }, members: [] } },
    { id: 8085, name: "Personal board", title: null, status: "Normal", teamId: null, team: null },
  ];
  const row = agent("mini-boss", { runtimeGeneration: 1, members: [membership(projects[0])], ...changes });
  const projectQueries = [];
  const flags = [];
  const prisma = {
    agent: { findFirst: async args => matches(row, args.where) ? hydrate(row, args) : null },
    project: { findMany: async args => {
      projectQueries.push(args);
      return projects.filter(project => matches(project, args.where)).map(project => hydrate(project, args));
    } },
    member: { findMany: async args => row.members.map(member => hydrate(member, args)) },
    comment: { aggregate: async () => ({ _max: { createdAt: null } }) },
    task: { count: async () => 0, findMany: async () => [] },
  };
  const mocks = {
    "@/lib/prisma": { default: prisma },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 6, agentId: actingAgentId }) },
    "@/lib/auth/agentScope": { withAgentScopeRequest: (_request, run) => run() },
    "@/lib/auth/agentTeamScope": {},
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => {
      flags.push({ key, userId });
      return key === "htpr-8084-cross-team-agents" && enabled;
    } },
    "@/lib/mcp/auth": {},
    "@/lib/aiModelOptions": {},
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
    "@/utils/controllers/agents/changeTeamAgentRole": {},
    "@/lib/nativeAgent/modelPin": { UNPINNABLE_MODEL_OPTION_IDS: new Set() },
    "@/lib/agents/working": { workingOnByAgent: async () => new Map() },
    "@/lib/agents/ownedSlugs": { resolveOwnedAgent: async () => ({ id: row.id, slug: "mini-boss" }) },
    "@/lib/agents/slug": {},
    "@/lib/mcp/agents/ownedAgents": {},
    "@/lib/agents/runtimeState": {
      readAgentRuntimeSnapshot: async () => null,
      filterRuntimeSnapshotToBoards: () => null,
      classifyRuntimeHealth: () => "offline",
      selectAgentOperationsQueue: () => ({ source: "inferred", queue: [] }),
      MAX_RUNTIME_QUEUE_ITEMS: 10,
    },
  };
  const route = load("src/app/api/agents/[agentId]/route.ts", mocks);
  return {
    projectQueries, flags,
    get: () => route.GET({ headers: new Headers(), url: "http://localhost/api/agents/mini-boss" }, {
      params: Promise.resolve({ agentId: "mini-boss" }),
    }),
  };
}

for (const enabled of [false, true]) {
  test(`direct Board access exposes eligible cross-team board with ticket flag ${enabled}`, async () => {
    const h = detailHarness({ enabled });
    const response = await h.get();
    assert.equal(response.status, 200);
    const { agent: result } = await response.json();
    const targetBoard = result.boardAccess.find(board => board.id === 4060);
    assert.equal(targetBoard.member, false);
    assert.equal(targetBoard.canChange, enabled);
    assert.equal(targetBoard.unavailableReason, enabled ? null : "Agent belongs to another team");
    assert.deepEqual(result.boards.map(board => board.id), [2128]);
    assert.equal(result.boardAccess.find(board => board.id === 2128).canChange, true);
    for (const key of ["credentialTeamId", "credentialTeamAccessBinding", "crossTeamHomeTeamId"]) {
      assert.equal(Object.hasOwn(result, key), false);
    }
    assert.ok(h.flags.some(flag => flag.key === "htpr-8084-cross-team-agents" && flag.userId === 6));
  });
}

for (const status of ["Accepted", "Pending"]) {
  test(`direct Board access respects owner team membership ${status}`, async () => {
    const { agent: result } = await (await detailHarness({ targetMembership: status }).get()).json();
    assert.equal(result.boardAccess.find(board => board.id === 4060).canChange, status === "Accepted");
    assert.equal(result.boardAccess.find(board => board.id === 8084).canChange, false);
    assert.equal(result.boardAccess.find(board => board.id === 8085).canChange, false);
  });
}

for (const [name, changes, allowed] of [
  ["foreign credential team", { credentialTeamId: "factory", credentialTeamAccessBinding: "bound" }, false],
  ["target credential team", { credentialTeamId: "hypertask", credentialTeamAccessBinding: "bound" }, true],
  ["orphan access binding", { credentialTeamAccessBinding: "bound" }, false],
  ["revoked", { revokedAt: createdAt }, false],
  ["archived", { archivedAt: createdAt }, false],
]) {
  test(`direct Board access preserves eligibility fences: ${name}`, async () => {
    const { agent: result } = await (await detailHarness({ changes }).get()).json();
    assert.equal(result.boardAccess.find(board => board.id === 4060).canChange, allowed);
    assert.equal(result.boardAccess.find(board => board.id === 2128).canChange, true);
  });
}

test("direct Board access uses durable original team with flag Off after its last board was removed", async () => {
  const h = detailHarness({ enabled: false, changes: {
    crossTeamHomeTeamId: "factory",
    members: [membership({ ...target, team: { id: "hypertask", title: "Hypertask" } })],
  } });
  const { agent: result } = await (await h.get()).json();
  const originalBoard = result.boardAccess.find(board => board.id === 2128);
  assert.equal(originalBoard.member, false);
  assert.equal(originalBoard.canChange, true);
  assert.equal(result.boardAccess.find(board => board.id === 4060).member, true);
});
