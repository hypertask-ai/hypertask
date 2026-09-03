const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const stubModule = (relativePath, exports) => {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

let userId = 7;
let reads = 0;
let writes = 0;
let broadcasts = 0;
class FeatureFlagInputError extends Error {}

stubModule("src/lib/flags.ts", {
  FEATURE_FLAG_MODES: ["OWNER_ONLY", "EVERYONE", "OFF"],
  FeatureFlagInputError,
  isFeatureFlagOwner: async () => userId === 6,
  listFeatureFlagModes: async () => {
    reads += 1;
    return [{ key: "htpr-6091-feature-flags", mode: "OWNER_ONLY", updatedAt: null }];
  },
  setFeatureFlagMode: async (key, mode) => {
    writes += 1;
    return { key, mode, updatedAt: new Date() };
  },
  featureFlagsForUser: async (id) => ({ example: id === 6 }),
});
stubModule("src/lib/auth/getSessionUser.ts", {
  getSessionUser: async () => (userId ? { userId } : null),
});
stubModule("src/lib/realtime/server.ts", {
  broadcastFeatureFlagsChange: async () => {
    broadcasts += 1;
  },
});

const jiti = createJiti(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const admin = jiti(path.join(root, "src/app/api/admin/flags/route.ts"));
const flagsRoute = jiti(path.join(root, "src/app/api/flags/route.ts"));

function request(method = "GET", body, origin = "https://app.hypertask.ai") {
  const value = new Request("https://app.hypertask.ai/api/admin/flags", {
    method,
    headers: {
      host: "app.hypertask.ai",
      origin,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  Object.defineProperty(value, "nextUrl", { value: new URL(value.url) });
  return value;
}
async function json(response) {
  return { status: response.status, body: await response.json() };
}

test.beforeEach(() => {
  userId = 7;
  reads = 0;
  writes = 0;
  broadcasts = 0;
});

test("non-owners receive 404 before flag data is read", async () => {
  assert.deepEqual(await json(await admin.GET(request())), {
    status: 404,
    body: { error: "Not found" },
  });
  assert.equal(reads, 0);
});

test("the owner can list and change a declared flag", async () => {
  userId = 6;
  assert.equal((await admin.GET(request())).status, 200);
  const result = await json(
    await admin.PATCH(
      request("PATCH", { key: "htpr-6091-feature-flags", mode: "OFF" }),
    ),
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.flag.mode, "OFF");
  assert.equal(writes, 1);
  assert.equal(broadcasts, 1);
});

test("owner writes reject cross-origin and invalid modes", async () => {
  userId = 6;
  assert.equal(
    (await admin.PATCH(request("PATCH", { key: "htpr-6091-feature-flags", mode: "OFF" }, "https://evil.test"))).status,
    403,
  );
  assert.equal(
    (await admin.PATCH(request("PATCH", { key: "htpr-6091-feature-flags", mode: "MAYBE" }))).status,
    400,
  );
  assert.equal(writes, 0);
});

test("user flag responses are private, per-user booleans", async () => {
  userId = 8;
  const response = await flagsRoute.GET(request());
  assert.deepEqual(await json(response), {
    status: 200,
    body: { flags: { example: false } },
  });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("unauthenticated flag reads fail closed", async () => {
  userId = 0;
  assert.equal((await flagsRoute.GET(request())).status, 401);
});
