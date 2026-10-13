const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
let signedIn = null;
let board = null;
const controllerCalls = [];

function stub(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

stub("src/lib/auth/getSessionUser.ts", { getSessionUser: async () => signedIn });
stub("src/lib/prisma.ts", { default: { project: { findFirst: async () => board } } });
stub("src/utils/controllers/projects/getAllIncludes.ts", { getProjectWhere: () => ({}) });
stub("src/utils/controllers/members/getAll.ts", { default: async (...args) => {
  controllerCalls.push(args);
  return { status: 200, json: { members: [], teamMembers: [] } };
} });

const jiti = createJiti(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });
const handler = jiti(path.join(root, "src/pages/api/members/getAll.ts")).default;

function call(query) {
  return new Promise((resolve) => {
    const res = { status(code) { return { json: (json) => resolve({ code, json }) }; } };
    handler({ method: "GET", headers: {}, query }, res);
  });
}

test("HTPR-7170: a teamId in the query cannot pull another team's members", async () => {
  signedIn = { userId: 985 };
  board = { id: 12, teamId: "team-A" };
  controllerCalls.length = 0;
  const result = await call({ projectId: "12", teamMembers: "true", teamId: "team-B" });
  assert.equal(result.code, 200);
  assert.equal(controllerCalls.length, 1);
  assert.equal(controllerCalls[0][3], "team-A");
});

test("HTPR-7170: a board with no team never enters the team branch", async () => {
  signedIn = { userId: 985 };
  board = { id: 12, teamId: null };
  controllerCalls.length = 0;
  await call({ projectId: "12", teamMembers: "true", teamId: "team-B" });
  assert.equal(controllerCalls[0][3], undefined);
});

test("HTPR-7170: a board the user cannot open returns nothing", async () => {
  signedIn = { userId: 985 };
  board = null;
  controllerCalls.length = 0;
  const result = await call({ projectId: "12", teamMembers: "true", teamId: "team-B" });
  assert.equal(result.code, 404);
  assert.equal(controllerCalls.length, 0);
});
