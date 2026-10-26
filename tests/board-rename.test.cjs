const test = require("node:test");
const assert = require("node:assert/strict");
const { read, loadTs, harness, humanMember, agentMember } = require("./helpers/board-rename.cjs");

for (const role of ["Member", "Admin"]) {
  test(`PATCH renames for a human ${role}, trimming the title and preserving board settings`, async () => {
    const h = harness({ members: [humanMember(role)] });
    const response = await h.patch("  Agents & Infra  ");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      success: true, project: { id: 15, title: "Agents & Infra", name: "project-15" },
    });
    assert.equal(h.board.sorting_mode, "Manual");
    assert.equal(h.board.uniqueIdentifier, "HTPR");
    assert.equal(h.updates.length, 1);
    assert.ok(h.updates[0].where.AND.OR, "mutation must retain the shared permission filter");
    assert.deepEqual(h.broadcasts, [[15, { originUserId: 6 }]]);
  });
}

test("renaming a board does not load every task row (YPER4-388)", async () => {
  const h = harness({ ownerId: 6 });
  assert.equal((await h.patch("Renamed")).status, 200);
  assert.equal(h.updates.length, 1);
  assert.equal(h.updates[0].include?.tasks, undefined, "rename must not include the board's tasks");
});

test("board owner can rename a legacy teamless board", async () => {
  const h = harness({ ownerId: 6 });
  assert.equal((await h.patch("Owner rename")).status, 200);
});

for (const role of ["Member", "Admin"]) {
  test(`an owned active managed agent ${role} can rename without its owner being a board member`, async () => {
    const h = harness({
      members: [agentMember({ role })],
      auth: { user: { id: 6 }, agentId: "agent-owned" },
    });
    assert.equal((await h.patch("Agent rename")).status, 200);
    assert.equal(h.updates.length, 1);
  });
}

for (const scope of ["owner", "member"]) {
  test(`an active managed agent cannot borrow its human's board ${scope} permission`, async () => {
    const agent = { id: "agent-owned", userId: 6, revokedAt: null };
    const h = harness({
      ...(scope === "owner"
        ? { ownerId: 6, ownerAgents: [agent] }
        : { members: [humanMember("Member", { user: { agents: [agent] } })] }),
      auth: { user: { id: 6 }, agentId: agent.id },
    });
    assert.equal((await h.patch("Delegated rename")).status, 403);
    assert.equal(h.updates.length, 0);
  });
}

test("team admin role alone does not grant permission to rename a board", async () => {
  const h = harness();
  h.board.team = { ownerId: 6, members: [{ userId: 6, role: "Admin" }] };
  const response = await h.patch("Denied");
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /not allowed/i);
  assert.equal(h.updates.length, 0);
});

for (const [name, options] of [
  ["non-member", {}],
  ["another user's board admin role", { members: [humanMember("Admin", { userId: 7 })] }],
  ["agent non-member", { auth: { user: { id: 6 }, agentId: "agent-owned" } }],
  ["revoked agent delegating board ownership", { ownerId: 6, ownerAgents: [{ id: "agent-owned", userId: 6, revokedAt: new Date() }], auth: { user: { id: 6 }, agentId: "agent-owned" } }],
  ["agent membership mistaken for a human membership", { members: [agentMember()] }],
  ["foreign managed agent", { members: [agentMember({ agent: { userId: 7, revokedAt: null } })], auth: { user: { id: 6 }, agentId: "agent-owned" } }],
  ["revoked managed agent", { members: [agentMember({ agent: { userId: 6, revokedAt: new Date() } })], auth: { user: { id: 6 }, agentId: "agent-owned" } }],
]) {
  test(`${name} gets readable 403 and does not mutate`, async () => {
    const h = harness(options);
    const response = await h.patch("Denied");
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /not allowed/i);
    assert.equal(h.updates.length, 0);
    assert.equal(h.broadcasts.length, 0);
  });
}

test("missing and deleted boards get 404", async () => {
  for (const options of [{ missing: true }, { status: "Deleted" }]) {
    const h = harness(options);
    assert.equal((await h.patch("Unknown")).status, 404);
    assert.equal(h.updates.length, 0);
  }
});

test("empty, non-string and overlong titles get 400 without writing", async () => {
  for (const title of ["", "  \n ", "x".repeat(201), undefined, null, 123, {}]) {
    const h = harness({ members: [humanMember()] });
    assert.equal((await h.patch(title)).status, 400, JSON.stringify(title));
    assert.equal(h.updates.length, 0);
  }
  const h = harness({ members: [humanMember()] });
  assert.equal((await h.patch(`  ${"x".repeat(200)}  `)).status, 200);
});

test("malformed JSON and invalid board IDs get 400", async () => {
  const h = harness({ ownerId: 6 });
  assert.equal((await h.patch("x", "15", "{")).status, 400);
  assert.equal((await h.patch("x", "15", "null")).status, 400);
  for (const id of ["abc", "0", "-1", "1.5", "15oops", "9007199254740992"]) {
    assert.equal((await h.patch("x", id)).status, 400);
  }
  assert.equal(h.updates.length, 0);
});

test("authentication and rate limiting happen before mutation", async () => {
  const anonymous = harness({ auth: null });
  assert.equal((await anonymous.patch("x")).status, 401);
  assert.equal(anonymous.updates.length, 0);
  const limited = harness({ rateLimited: Response.json({ error: "Too many requests" }, { status: 429 }) });
  assert.equal((await limited.patch("x")).status, 429);
  assert.equal(limited.updates.length, 0);
});

test("the scoped update fails closed if board access changes after the permission check", async () => {
  const h = harness({ ownerId: 6, loseAccess: true });
  const response = await h.patch("x");
  assert.equal(response.status, 403);
  assert.equal(h.updates.length, 0);
});

test("UI rename calls the same controller and permission behavior as the API", async () => {
  assert.match(read("src/components/generalCommandActions.ts"), /axios\.post\("\/api\/projects\/update"/);
  for (const [allowed, title, expectedStatus] of [
    [true, "  Shared rename  ", 200],
    [false, "Shared rename", 403],
    [true, "  ", 400],
    [true, "x".repeat(201), 400],
    [true, "x".repeat(200), 200],
  ]) {
    const h = harness({ members: allowed ? [humanMember()] : [] });
    const getSessionUser = { getSessionUser: async () => ({ userId: 6 }) };
    const nextServer = { NextResponse: Response };
    const sharedRoute = loadTs("src/lib/api/task-writes/route.ts", {
      "next/server": nextServer,
      "zod": {},
      "@/lib/auth/getSessionUser": getSessionUser,
      "better-auth/cookies": require("better-auth/cookies"),
      "@/lib/auth/session": {},
    });
    const ui = loadTs("src/lib/api/project-writes/update.ts", {
      "next/server": nextServer,
      "zod": require("zod"),
      "@/lib/api/task-writes/route": sharedRoute,
      "@/utils/controllers/projects/update": h.controller,
      "@/lib/auth/sessionUserRecord": h.userRecord,
    }).POST;
    const result = await ui({
      headers: new Headers(),
      json: async () => ({ projectId: 15, title }),
    });
    const response = { code: result.status, body: await result.json() };
    assert.equal(response.code, expectedStatus);
    assert.equal(h.updates.length, expectedStatus === 200 ? 1 : 0);
    if (expectedStatus === 200) assert.equal(h.board.title, title.trim());
  }
});

for (const scopeEnforced of [false, true]) {
  const mode = `scope=${scopeEnforced ? 'ENFORCE' : 'WATCH'}`;


  test(`read-role accepted agent cannot rename board (${mode})`, async () => {
    const h = harness({
      members: [agentMember()],
      auth: { user: { id: 6 }, agentId: 'agent-owned' },
      agentRole: 'read', scopeEnforced,
    });
    const response = await h.patch('New name');
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'insufficient_scope');
    assert.equal(response.headers.has('Server-Timing'), true);
    assert.equal(h.board.title, 'Old name');
    assert.deepEqual(h.updates, []);
    assert.deepEqual(h.broadcasts, []);
  });

  test(`write/admin agents and human members can still rename (${mode})`, async () => {
    for (const agentRole of ['write', 'admin', null, 'human']) {
      const human = agentRole === 'human';
      const h = harness({
        members: [human ? humanMember() : agentMember()],
        auth: { user: { id: 6 }, agentId: human ? null : 'agent-owned' },
        agentRole: human ? 'read' : agentRole, scopeEnforced,
      });
      const response = await h.patch('  New name  ');
      assert.equal(response.status, 200, String(agentRole));
      assert.equal(response.headers.has('Server-Timing'), true);
      assert.equal(h.board.title, 'New name');
      assert.equal(h.board.sorting_mode, 'Manual');
      assert.equal(h.board.uniqueIdentifier, 'HTPR');
      assert.equal(h.updates.length, 1);
      assert.ok(h.updates[0].where.AND.OR);
      assert.deepEqual(h.broadcasts, [[15, { originUserId: 6 }]]);
    }
  });
}
