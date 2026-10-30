const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const writes = [];
const flagUsers = [];
function stub(file, exports) {
  const filename = path.join(root, file);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
stub("src/lib/prisma.ts", { default: { team: { findUnique: async ({ where }) => ({
  aiKeyOnly: where.id === "restricted",
  aiProviderSettings: null,
  googleAccount: { userId: 42 },
  byokApiKeys: [],
}) } } });
stub("src/lib/flags.ts", { isFeatureEnabled: async (_key, userId) => { flagUsers.push(userId); return true; } });
stub("src/lib/turbopuffer.ts", {
  default: { namespace: () => ({ write: async (body) => { writes.push(body); return body; } }) },
  turbopufferNamespaces: { task: { name: "task" } },
});
stub("src/app/api/ai/_lib/aiUsage.ts", { logAiUsage: async () => {} });
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true });
const { upsertTaskRowsToTurbopuffer } = load(path.join(root, "src/utils/controllers/turbopuffer/turbopufferHelper.ts"));

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
    ]);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].upsert_rows[0].searchText, "private keyword");
    assert.equal(writes[0].upsert_rows[0].vector, null);
    assert.equal(writes[0].upsert_rows[1].searchText, "public keyword");
    assert.deepEqual(writes[0].upsert_rows[1].vector, Array(1536).fill(1));
    assert.deepEqual(requests.map((request) => request.input), [["public keyword"]]);
    assert.deepEqual(flagUsers, [42]);
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.TURBOPUFFER_EMBEDDINGS_API_KEY;
    else process.env.TURBOPUFFER_EMBEDDINGS_API_KEY = previousKey;
  }
});
