const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function load(relPath, stubs) {
  const source = fs.readFileSync(path.join(root, relPath), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", javascript)(mod, mod.exports, (request) => {
    if (request === "@/lib/tasks/sameBoardRelations") return load("src/lib/tasks/sameBoardRelations.ts", {});
    if (request in stubs) return stubs[request];
    throw new Error(`Unexpected import in ${relPath}: ${request}`);
  });
  return mod.exports;
}

const { isShareLinkLive } = load("src/utils/controllers/tasks/getSharedTask.ts", {
  "@/lib/prisma": {},
  "@/lib/agents/publicAgent": {},
  "@/models/model": {},
});

function share(overrides = {}) {
  return {
    id: "share-1",
    shareType: "Anyone",
    expired: false,
    expiredAt: null,
    ...overrides,
    task: { projectId: 15, uniqueIndex: 7174, status: "Normal", ...(overrides.task || {}) },
  };
}

function harness(row, { session = null, membership = 201 } = {}) {
  const memberChecks = [];
  const { default: handler } = load("src/pages/api/share/getSharedTask.ts", {
    next: {},
    "@/lib/prisma": { taskSharing: { findUnique: async () => row } },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => session },
    "@/utils/controllers/tasks/getSharedTask": {
      isShareLinkLive,
      checkIfBoardMember: async (userId, projectId) => { memberChecks.push([userId, projectId]); return membership; },
    },
  });
  return { handler, memberChecks };
}

async function call(handler) {
  const res = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method: "POST", headers: {}, query: { shareId: "share-1" } }, res);
  return res;
}

test("an Anyone link returns only the ids needed to open the ticket, never task content", async () => {
  const { handler } = harness(share());
  const res = await call(handler);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { taskShared: { id: "share-1", shareType: "Anyone", projectId: 15, task: { uniqueIndex: 7174 } } });
});

test("a Domain link is refused without a signed-in session", async () => {
  const { handler, memberChecks } = harness(share({ shareType: "Domain" }), { session: null });
  const res = await call(handler);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, {});
  assert.deepEqual(memberChecks, []);
});

test("a Domain link is refused for a signed-in person outside the board", async () => {
  const { handler, memberChecks } = harness(share({ shareType: "Domain" }), { session: { userId: 99 }, membership: 201 });
  const res = await call(handler);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(memberChecks, [[99, 15]], "access is checked against the task's own board");
});

test("a Domain link works for a member of the task's board", async () => {
  const { handler } = harness(share({ shareType: "Domain" }), { session: { userId: 7 }, membership: 200 });
  const res = await call(handler);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.taskShared.task.uniqueIndex, 7174);
});

for (const [name, row] of [
  ["an expired link", share({ expired: true })],
  ["a link past its expiry date", share({ expiredAt: new Date(Date.now() - 1000) })],
  ["a link to a deleted task", share({ task: { status: "Deleted" } })],
  ["an unknown link", null],
]) {
  test(`${name} returns nothing`, async () => {
    const { handler } = harness(row, { session: { userId: 7 }, membership: 200 });
    const res = await call(handler);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, {});
  });
}
