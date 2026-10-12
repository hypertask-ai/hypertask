const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
let allowed;
let queries;
let countError;
let guardHeaders;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

stubModule("src/lib/flags.ts", {
  isFeatureFlagOwner: async (headers) => {
    guardHeaders = headers;
    return allowed;
  },
});
stubModule("src/lib/prisma.ts", {
  default: {
    agent: {
      count: async (query) => {
        queries.push(query);
        if (countError) throw countError;
        return query.where.members ? 7 : 42;
      },
    },
  },
});

const jiti = require("jiti")(__filename, {
  alias: { "@": path.join(root, "src") },
  cache: false,
  interopDefault: true,
});
const { GET, dynamic, runtime } = jiti(
  path.join(root, "src/app/api/admin/agents/zero-board-count/route.ts"),
);

function request() {
  return new NextRequest("https://app.hypertask.ai/api/admin/agents/zero-board-count");
}

test.beforeEach(() => {
  allowed = true;
  queries = [];
  countError = null;
  guardHeaders = null;
});

test("owner gets only uncached aggregate counts across all owners and member statuses", async () => {
  const req = request();
  const response = await GET(req);
  assert.equal(dynamic, "force-dynamic");
  assert.equal(runtime, "nodejs");
  assert.equal(guardHeaders, req.headers);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(await response.json(), { zeroBoardActiveAgents: 7, activeAgents: 42 });
  assert.deepEqual(queries, [
    { where: { revokedAt: null, archivedAt: null, members: { none: {} } } },
    { where: { revokedAt: null, archivedAt: null } },
  ]);
});

test("non-owner gets 403 with no numbers and no Prisma calls", async () => {
  allowed = false;
  const response = await GET(request());
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(await response.json(), { error: "Forbidden" });
  assert.deepEqual(queries, []);
});

test("database failure returns an uncached generic error without counts", async () => {
  countError = new Error("test database failure");
  const original = console.error;
  console.error = () => {};
  try {
    const response = await GET(request());
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.deepEqual(await response.json(), { error: "Unable to count agents" });
  } finally {
    console.error = original;
  }
});
