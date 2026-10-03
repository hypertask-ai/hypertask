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
    assert.ok(h.updates[0].where.OR, "mutation must retain the shared permission filter");
    assert.deepEqual(h.broadcasts, [[15, { originUserId: 6 }]]);
  });
}

test("board owner can rename a legacy teamless board", async () => {
  const h = harness({ ownerId: 6 });
  assert.equal((await h.patch("Owner rename")).status, 200);
});

test("an owned active managed agent member can rename without its owner being a board member", async () => {
  const h = harness({
    members: [agentMember()],
    auth: { user: { id: 6 }, agentId: "agent-owned" },
  });
  assert.equal((await h.patch("Agent rename")).status, 200);
  assert.equal(h.updates.length, 1);
});

for (const [name, options] of [
  ["non-member", {}],
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
  for (const allowed of [true, false]) {
    const h = harness({ members: allowed ? [humanMember()] : [] });
    const ui = loadTs("src/pages/api/projects/update.ts", {
      "@/utils/controllers/projects/update": h.controller,
      "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 6 }) },
      "@/lib/auth/sessionUserRecord": h.userRecord,
    }).default;
    const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await ui({ method: "POST", headers: {}, body: { projectId: 15, title: "  Shared rename  " } }, response);
    assert.equal(response.code, allowed ? 200 : 403);
    assert.equal(h.updates.length, allowed ? 1 : 0);
    if (allowed) assert.equal(h.board.title, "Shared rename");
  }
});
