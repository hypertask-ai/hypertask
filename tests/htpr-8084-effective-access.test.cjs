const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");
const { matches, hydrate } = require("./helpers/agent-board-scope.cjs");

function fixture({ enabled = true, expanded = true, watch = false } = {}) {
  const ownerId = 42;
  const agent = { id: "cross-team-agent", userId: ownerId, revokedAt: null, archivedAt: null,
    credentialTeamId: null, credentialTeamAccessBinding: null, crossTeamHomeTeamId: expanded ? "home" : null };
  const teams = ["home", "second", "foreign"].map(id => ({ id, googleAccount: { userId: id === "foreign" ? 99 : ownerId }, members: [] }));
  const projects = teams.map((team, index) => ({ id: index + 1, teamId: team.id, team, status: "Normal", ownerId,
    members: [{ agentId: agent.id, userId: ownerId, status: "Accepted", agent }] }));
  projects.push({ ...projects[1], id: 4, members: [] });
  const tasks = projects.map(project => ({ id: project.id * 10, projectId: project.id, project, status: "Normal", ticketNumber: `TEST-${project.id}`, uniqueIndex: 1 }));
  const model = rows => ({
    findFirst: async args => hydrate(rows.find(row => matches(row, args.where)), args),
    findUnique: async args => hydrate(rows.find(row => matches(row, args.where)), args),
    findMany: async args => rows.filter(row => matches(row, args.where)).map(row => hydrate(row, args)),
  });
  const db = { agent: model([agent]), project: model(projects), task: model(tasks), comment: model([]),
    member: { findMany: async () => projects.flatMap(project => project.members.map(member => ({ ...member, projectId: project.id }))) },
    chatSession: model([]), agentRun: model([]), taskNumberAlias: model([]) };
  const context = load("src/lib/auth/crossTeamContext.ts", {});
  const mocks = {
    "@/lib/prisma": { default: db },
    "@/lib/auth/crossTeamContext": context,
    "@/lib/flags": { isFeatureEnabled: async key => key === "htpr-8084-cross-team-agents" ? enabled : !watch },
    "@/lib/telemetry/signupAnalytics": { recordServerCapture() {} },
    "@/utils/controllers/projects/findPrefixAliasTasks": { findPrefixAliasTasks: async () => [] },
    "@/lib/auth/agentTeamScope": { resolveAgentTeamScope: async () => null },
  };
  const scope = load("src/lib/auth/agentScope.ts", mocks);
  mocks["@/lib/auth/agentScope"] = scope;
  const resolver = load("src/lib/mcp/tasks/resolveTask.ts", mocks);
  const access = load("src/utils/controllers/projects/getAllIncludes.ts", mocks);
  const replay = load("src/lib/mcp/idempotency/authorizeReplay.ts", mocks);
  const webhooks = load("src/lib/webhooks/credentialScope.ts", mocks);
  const principal = { userId: ownerId, agentId: agent.id, teamScope: null };
  return { agent, teams, projects, tasks, access, replay, webhooks, principal, db,
    run: fn => scope.withAgentScopeRequest({ url: "/api/mcp/tasks/TEST-1", method: "GET" }, async () => {
      await scope.prepareAgentScope(ownerId, agent.id);
      return fn();
    }),
    resolve: id => resolver.findTaskByIdentifier({ id: ownerId }, { task_id: id * 10 }, agent.id),
  };
}

test("real task identifier dispatch: explicit owner-team grants allowed; foreign and unassigned boards refused even in WATCH", async () => {
  const f = fixture({ watch: true });
  await f.run(async () => {
    assert.deepEqual(await f.resolve(1), { id: 10, projectId: 1 });
    assert.deepEqual(await f.resolve(2), { id: 20, projectId: 2 });
    assert.equal(await f.resolve(3), null);
    assert.equal(await f.resolve(4), null);
    for (const name of ["getProjectWhere", "getProjectListingWhere", "projectContentAccessWhere", "taskWriteAccessWhere", "savedViewBoardAccessWhere"]) {
      assert.deepEqual(f.projects.filter(project => matches(project, f.access[name](42, f.agent.id))).map(row => row.id), [1, 2], name);
    }
  });
});

test("rollback retains original home; removing home membership never promotes second-team access", async () => {
  const f = fixture({ enabled: false });
  await f.run(async () => {
    assert.deepEqual(await f.resolve(1), { id: 10, projectId: 1 });
    assert.equal(await f.resolve(2), null);
  });
  f.projects[0].members = [];
  await f.run(async () => {
    assert.equal(await f.resolve(1), null);
    assert.equal(await f.resolve(2), null);
  });
});

test("next request refuses removed owner-team access, pending grants and archived agents", async () => {
  const f = fixture();
  await f.run(async () => assert.equal((await f.resolve(2)).id, 20));
  f.teams[1].googleAccount.userId = 99;
  f.teams[1].members = [{ userId: 42, status: "Pending" }];
  await f.run(async () => {
    assert.equal(await f.resolve(2), null);
    assert.equal((await f.resolve(1)).id, 10);
  });
  f.teams[1].members[0].status = "Accepted";
  await f.run(async () => assert.equal((await f.resolve(2)).id, 20));
  f.projects[1].members[0].status = "Pending";
  await f.run(async () => assert.equal(await f.resolve(2), null));
  f.agent.archivedAt = new Date();
  await f.run(async () => assert.equal(await f.resolve(1), null));
});

test("legacy flag-off single-team identities keep their existing grants", async () => {
  const f = fixture({ expanded: false, enabled: false });
  await f.run(async () => assert.equal((await f.resolve(1)).id, 10));
});

test("queued webhook authorization rechecks unbound cross-team agent grants before delivery", async () => {
  const f = fixture();
  const allowed = projectId => f.webhooks.webhookCredentialAllows(f.agent.id, { event: "task.updated", projectId, taskId: projectId * 10 }, { projectId }, f.db);
  assert.equal(await allowed(2), true);
  assert.equal(await allowed(3), false);
  assert.equal(await allowed(4), false);
  f.teams[1].googleAccount.userId = 99;
  assert.equal(await allowed(2), false);
  assert.equal(await allowed(1), true);
});

test("flag rollback denies queued second-team webhook while original-team delivery stays allowed", async () => {
  const f = fixture({ enabled: false });
  assert.equal(await f.webhooks.webhookCredentialAllows(f.agent.id, { event: "task.updated", taskId: 20, projectId: 2 }, { projectId: 2 }, f.db), false);
  assert.equal(await f.webhooks.webhookCredentialAllows(f.agent.id, { event: "task.updated", taskId: 10, projectId: 1 }, { projectId: 1 }, f.db), true);
});

test("idempotency replay denies private cached task after owner-team removal without repeating a write", async () => {
  const f = fixture();
  const cached = { success: true, task: { id: 20, projectId: 2 } };
  await f.replay.authorizeIdempotencyReplay(cached, f.principal);
  f.teams[1].googleAccount.userId = 99;
  await assert.rejects(f.replay.authorizeIdempotencyReplay(cached, f.principal), /not found or access denied/);
  await f.replay.authorizeIdempotencyReplay({ task: { id: 10, projectId: 1 } }, f.principal);
  await assert.rejects(f.replay.authorizeIdempotencyReplay({ project_id: 2 }, f.principal), /not found or access denied/);
});


test("revoked expanded identity cannot replay cached private data after its authentication lookup", async () => {
  const f = fixture();
  await f.replay.authorizeIdempotencyReplay({ task: { id: 20, projectId: 2 } }, f.principal);
  f.agent.revokedAt = new Date();
  await assert.rejects(f.replay.authorizeIdempotencyReplay({ task: { id: 20, projectId: 2 } }, f.principal), /not found or access denied/);
});


for (const failure of ['database', 'flag']) {
  test(`cached replay ${failure} failure cannot repeat a completed write`, async () => {
    let writes = 0;
    const store = load('src/lib/mcp/idempotency/idempotencyStore.ts', {
      '@/lib/prisma': { default: { agent: { findFirst: async () => {
        if (failure === 'database') throw new Error('database unavailable');
        return { crossTeamHomeTeamId: 'home' };
      } } } },
      '@/lib/flags': { isFeatureEnabled: async () => { throw new Error('flag unavailable'); } },
      '@/utils/controllers/projects/getAllIncludes': { projectContentAccessWhere: () => ({}) },
      '@/lib/redis': { getRedis: async () => ({ get: async () => JSON.stringify({ task: { id: 20, projectId: 2 } }) }) },
    });
    await assert.rejects(store.withIdempotency('create_task', 42, 'cached-key', {}, async () => {
      writes++;
      return { task: { id: 21 } };
    }, 'expanded-agent', null), store.IdempotencyAccessError);
    assert.equal(writes, 0);
  });
}
