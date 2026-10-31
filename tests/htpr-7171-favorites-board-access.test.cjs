const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function load(relPath, stubs) {
  const source = fs.readFileSync(path.join(root, relPath), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", javascript)(mod, mod.exports, (request) => {
    assert.ok(request in stubs, `Unexpected import in ${relPath}: ${request}`);
    return stubs[request];
  });
  return mod.exports;
}

const ACCESS = { 7: new Set([1, 2]) };
const projectWhere = { getProjectWhere: (userId) => ({ acl: userId }) };

function reorderHarness() {
  const calls = { transaction: 0, created: null, aclQueries: [] };
  const prisma = {
    userSetting: { findUnique: async () => ({ id: 70 }) },
    project: {
      findMany: async ({ where }) => {
        calls.aclQueries.push(where);
        assert.equal(where.acl, 7, "the board check must use the session user's ACL");
        return where.id.in.filter((id) => ACCESS[7].has(id)).map((id) => ({ id }));
      },
    },
    favorites: {
      deleteMany: (args) => ({ op: "deleteMany", args }),
      createMany: (args) => { calls.created = args.data; return { op: "createMany", args }; },
    },
    $transaction: async () => { calls.transaction += 1; },
  };
  const { default: handler } = load("src/pages/api/favorites/reorderFavorites.ts", {
    next: {},
    "@/lib/prisma": prisma,
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 7 }) },
    "@/utils/controllers/projects/getAllIncludes": projectWhere,
  });
  return { handler, calls };
}

async function put(handler, favorites) {
  const res = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method: "PUT", headers: {}, body: { favorites } }, res);
  return res;
}

test("reorder refuses a board the user cannot open and changes nothing", async () => {
  const { handler, calls } = reorderHarness();
  const res = await put(handler, [{ projectId: 1 }, { projectId: 999 }]);
  assert.equal(res.statusCode, 403);
  assert.equal(calls.transaction, 0);
  assert.equal(calls.created, null);
});

test("reorder saves boards the user can open, in order", async () => {
  const { handler, calls } = reorderHarness();
  const res = await put(handler, [{ projectId: 2 }, { projectId: 1 }, { projectId: 2 }]);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.transaction, 1);
  assert.deepEqual(calls.created, [
    { userSettingId: 70, projectId: 2, index: 1 },
    { userSettingId: 70, projectId: 1, index: 2 },
  ]);
});

test("reorder ignores non-integer ids instead of querying with them", async () => {
  const { handler, calls } = reorderHarness();
  const res = await put(handler, [{ projectId: 1.5 }, { projectId: -3 }, { projectId: "1" }]);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.aclQueries[0].id.in, [1]);
});

test("an empty favorites list still clears without a board query", async () => {
  const { handler, calls } = reorderHarness();
  const res = await put(handler, []);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.aclQueries.length, 0);
  assert.equal(calls.transaction, 1);
});

test("the favorites list only returns boards the user can still open", async () => {
  let where = null;
  const { getFavoritesForUser } = load("src/utils/controllers/favorites/getAll.ts", {
    "@/lib/prisma": { favorites: { findMany: async (args) => { where = args.where; return []; } } },
    "@/lib/agents/publicAgent": { publicAgentSelect: { id: true } },
    "@/utils/controllers/projects/getAllIncludes": projectWhere,
  });
  await getFavoritesForUser(7);
  assert.deepEqual(where, { userSetting: { userId: 7 }, project: { acl: 7 } });
});
