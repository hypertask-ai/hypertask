const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
let setup;
const stubs = new Map([
  [
    "src/lib/auth/getSessionUser.ts",
    { getSessionUser: async () => setup.session },
  ],
  [
    "src/lib/prisma.ts",
    {
      default: {
        project: {
          findMany: async () => {
            if (setup.projectError) throw setup.projectError;
            return setup.projectIds.map((id) => ({ id }));
          },
        },
      },
    },
  ],
  [
    "src/utils/controllers/projects/getAllIncludes.ts",
    { projectContentAccessWhere: (userId) => ({ ownerId: userId }) },
  ],
  [
    "src/utils/controllers/search/document.ts",
    {
      turbopufferGetDocuments: async (...args) => setup.onSearch(...args),
    },
  ],
]);
for (const [relativePath, exports] of stubs) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
const jiti = require("jiti")(__filename, {
  alias: { "@": path.join(root, "src") },
  cache: false,
  interopDefault: true,
});
const handler = jiti(
  path.join(root, "src/pages/api/search/document.ts"),
).default;

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function call({
  session,
  accessibleProjectIds = [],
  body,
  onSearch = () => ({ status: 200 }),
  projectError,
}) {
  setup = { session, projectIds: accessibleProjectIds, onSearch, projectError };
  const res = response();
  await handler({ method: "POST", body, headers: {} }, res);
  return res;
}

test("document search requires an authenticated user", async () => {
  const res = await call({
    session: null,
    body: { projectIds: [15], searchQuery: "release" },
  });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "SESSION_REQUIRED");
});

test("document search rejects inaccessible projects", async () => {
  const res = await call({
    session: { userId: 6 },
    accessibleProjectIds: [15],
    body: { projectIds: [15, 16], searchQuery: "release" },
  });
  assert.equal(res.statusCode, 403);
});

test("document search passes normalized accessible project ids", async () => {
  let searchArgs;
  const res = await call({
    session: { userId: 6 },
    accessibleProjectIds: [15],
    body: {
      projectIds: [15, 15, "16"],
      searchQuery: "  release  ",
      archive: "Normal",
    },
    onSearch: (...args) => {
      searchArgs = args;
      return { status: 200 };
    },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(searchArgs, ["release", [15], "Normal"]);
});

test("document search reports access lookup failures as server errors", async () => {
  const res = await call({
    session: { userId: 6 },
    body: { projectIds: [15], searchQuery: "release" },
    projectError: new Error("database unavailable"),
  });
  assert.equal(res.statusCode, 500);
});
