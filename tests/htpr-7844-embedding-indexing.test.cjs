const test = require("node:test");
const assert = require("node:assert/strict");
const writes = [];
const queries = [];
const flagUsers = [];
const { loadModule } = require("./helpers/loadModule.cjs");
const stubs = {};
function stub(file, exports) {
  stubs["@/" + file.slice(4).replace(/\.ts$/, "")] = exports;
}
stub("src/lib/prisma.ts", { default: { team: { findUnique: async ({ where }) => ({
  aiKeyOnly: where.id === "restricted",
  aiProviderSettings: null,
  googleAccount: { userId: 42 },
}) }, teamByokApiKey: { findMany: async () => [] }, project: { findUnique: async ({ where }) => ({ teamId: where.id === 1 ? "allowed" : where.id === 2 ? "restricted" : null }) } } });
stub("src/lib/flags.ts", { isFeatureEnabled: async (_key, userId) => { flagUsers.push(userId); return true; } });
stub("src/lib/turbopuffer.ts", {
  default: { namespace: () => ({ write: async (body) => { writes.push(body); return body; }, query: async (body) => { queries.push(body); return { rows: [] }; } }) },
  turbopufferNamespaces: { task: { name: "task" }, comment: { name: "comment" } },
});
stub("src/app/api/ai/_lib/aiUsage.ts", { logAiUsage: async () => {} });
const { upsertTaskRowsToTurbopuffer, searchTasks, searchComments } = loadModule("src/utils/controllers/turbopuffer/turbopufferHelper.ts", stubs);

test("mixed-team upsert retains keywords and clears refused vectors", async () => {
  const previousFetch = global.fetch;
  const previousKey = process.env.TURBOPUFFER_EMBEDDINGS_API_KEY;
  const requests = [];
  process.env.TURBOPUFFER_EMBEDDINGS_API_KEY = "platform-test";
  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ data: [{ index: 0, embedding: Array(1536).fill(1) }] }) };
  };
  try {
    await upsertTaskRowsToTurbopuffer([
      { id: 1, teamId: "restricted", searchText: "private keyword" },
      { id: 2, teamId: "allowed", searchText: "public keyword" },
      { id: 3, projectId: 3, searchText: "teamless keyword" },
    ]);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].upsert_rows[0].searchText, "private keyword");
    assert.equal(writes[0].upsert_rows[0].vector, null);
    assert.equal(writes[0].upsert_rows[1].searchText, "public keyword");
    assert.deepEqual(writes[0].upsert_rows[1].vector, Array(1536).fill(1));
    assert.equal(writes[0].upsert_rows[2].searchText, "teamless keyword");
    assert.equal(writes[0].upsert_rows[2].vector, null);
    assert.deepEqual(requests.map((request) => request.input), [["public keyword"]]);
    assert.deepEqual(flagUsers, [42]);
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.TURBOPUFFER_EMBEDDINGS_API_KEY;
    else process.env.TURBOPUFFER_EMBEDDINGS_API_KEY = previousKey;
  }
});

for (const search of [searchTasks, searchComments]) {
  test(`${search.name} checks every team's funding before embedding`, async () => {
    const previousFetch = global.fetch;
    const previousKey = process.env.TURBOPUFFER_EMBEDDINGS_API_KEY;
    const requests = [];
    process.env.TURBOPUFFER_EMBEDDINGS_API_KEY = "platform-test";
    global.fetch = async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ data: [{ index: 0, embedding: Array(1536).fill(1) }] }) };
    };
    try {
      queries.length = 0;
      assert.deepEqual(await search({ searchQuery: "needle", projectIds: [1, 2], projectId: 99 }), []);
      assert.equal(requests.length, 0);
      assert.ok(queries.length > 0);
      assert.deepEqual(await search({ searchQuery: "needle", projectIds: [1, 3] }), []);
      assert.equal(requests.length, 0);
      assert.deepEqual(await search({ searchQuery: "needle", projectIds: [1] }), []);
      assert.equal(requests.length, 1);
      assert.deepEqual(requests[0].input, ["needle"]);
    } finally {
      global.fetch = previousFetch;
      if (previousKey === undefined) delete process.env.TURBOPUFFER_EMBEDDINGS_API_KEY;
      else process.env.TURBOPUFFER_EMBEDDINGS_API_KEY = previousKey;
    }
  });
}
