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
let keepWrites = 0;
let broadcasts = 0;
let broadcastFails = false;
let authFails = false;
let detailsEnabled = true;
class FeatureFlagInputError extends Error {}

stubModule("src/lib/flags.ts", {
  FEATURE_FLAG_DETAILS_FLAG: "htpr-6133-feature-flag-details",
  FEATURE_FLAG_MODES: ["OWNER_ONLY", "OWNER_AND_QA", "EVERYONE", "OFF"],
  FEATURE_FLAG_OWNER_USER_ID: 6,
  FeatureFlagInputError,
  isFeatureEnabled: async () => detailsEnabled,
  isFeatureFlagOwner: async () => {
    if (authFails) throw new Error("auth unavailable");
    return userId === 6;
  },
  listFeatureFlagModes: async () => {
    reads += 1;
    return [
      {
        key: "htpr-6091-feature-flags",
        mode: "OWNER_ONLY",
        updatedAt: null,
        description: "Registers the feature flag controls themselves.",
        ticketUrl: "https://app.hypertask.ai/detail/project-15/6091",
      },
    ];
  },
  setFeatureFlagMode: async (key, mode) => {
    writes += 1;
    return {
      key,
      mode,
      updatedAt: new Date(),
      description: "Registers the feature flag controls themselves.",
      ticketUrl: "https://app.hypertask.ai/detail/project-15/6091",
    };
  },
  setFeatureFlagKeep: async (key, keep) => {
    keepWrites += 1;
    return {
      key,
      mode: "EVERYONE",
      keep,
      updatedAt: new Date(),
      description: "Registers the feature flag controls themselves.",
      ticketUrl: "https://app.hypertask.ai/detail/project-15/6091",
    };
  },
  featureFlagsForUser: async (id) => ({ example: id === 6 }),
});
stubModule("src/lib/auth/getSessionUser.ts", {
  getSessionUser: async () => {
    if (authFails) throw new Error("auth unavailable");
    return userId ? { userId } : null;
  },
});
stubModule("src/lib/realtime/server.ts", {
  broadcastFeatureFlagsChange: async () => {
    broadcasts += 1;
    if (broadcastFails) throw new Error("realtime unavailable");
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
  keepWrites = 0;
  broadcasts = 0;
  broadcastFails = false;
  authFails = false;
  detailsEnabled = true;
});

test("non-owners receive 404 before flag metadata is read or changed", async () => {
  assert.deepEqual(await json(await admin.GET(request())), {
    status: 404,
    body: { error: "Not found" },
  });
  assert.deepEqual(
    await json(
      await admin.PATCH(
        request("PATCH", { key: "htpr-6091-feature-flags", mode: "EVERYONE" }),
      ),
    ),
    { status: 404, body: { error: "Not found" } },
  );
  assert.equal(reads, 0);
  assert.equal(writes, 0);
});

test("authentication failures return private structured errors", async (t) => {
  t.mock.method(console, "error", () => {});
  authFails = true;
  const adminResponse = await admin.GET(request());
  const userResponse = await flagsRoute.GET(request());
  assert.equal(adminResponse.status, 500);
  assert.equal(userResponse.status, 500);
  assert.equal(adminResponse.headers.get("cache-control"), "private, no-store");
  assert.equal(userResponse.headers.get("cache-control"), "private, no-store");
});

test("the owner can list and change a declared flag with server-owned metadata", async () => {
  userId = 6;
  const listed = await json(await admin.GET(request()));
  assert.equal(listed.status, 200);
  assert.equal(listed.body.detailsEnabled, true);
  assert.deepEqual(listed.body.flags[0], {
    key: "htpr-6091-feature-flags",
    mode: "OWNER_ONLY",
    updatedAt: null,
    description: "Registers the feature flag controls themselves.",
    ticketUrl: "https://app.hypertask.ai/detail/project-15/6091",
  });
  const result = await json(
    await admin.PATCH(
      request("PATCH", {
        key: "htpr-6091-feature-flags",
        mode: "OWNER_AND_QA",
        description: "attacker copy",
        ticketUrl: "https://evil.test",
      }),
    ),
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.flag.mode, "OWNER_AND_QA");
  assert.equal(result.body.flag.description, "Registers the feature flag controls themselves.");
  assert.equal(result.body.flag.ticketUrl, "https://app.hypertask.ai/detail/project-15/6091");
  assert.equal(writes, 1);
  assert.equal(broadcasts, 1);
});

test("the owner response disables ticket details when the rollout flag is off", async () => {
  userId = 6;
  detailsEnabled = false;
  const listed = await json(await admin.GET(request()));
  assert.equal(listed.status, 200);
  assert.equal(listed.body.detailsEnabled, false);
});

test("committed updates still succeed when realtime delivery fails", async (t) => {
  t.mock.method(console, "warn", () => {});
  userId = 6;
  broadcastFails = true;
  const result = await admin.PATCH(
    request("PATCH", { key: "htpr-6091-feature-flags", mode: "EVERYONE" }),
  );
  assert.equal(result.status, 200);
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

test("the owner can pause removal with Keep without touching the mode", async () => {
  userId = 6;
  const result = await json(
    await admin.PATCH(request("PATCH", { key: "htpr-6091-feature-flags", keep: true })),
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.flag.keep, true);
  assert.equal(keepWrites, 1);
  assert.equal(writes, 0);
  assert.equal(broadcasts, 1);
});

test("Keep writes are refused while the countdown flag is off for the owner", async () => {
  userId = 6;
  detailsEnabled = false;
  const result = await json(
    await admin.PATCH(request("PATCH", { key: "htpr-6091-feature-flags", keep: true })),
  );
  assert.deepEqual(result, { status: 404, body: { error: "Not found" } });
  assert.equal(keepWrites, 0);
});

test("a Keep write must say exactly one thing", async () => {
  userId = 6;
  const bodies = [
    // Both fields: which change was meant is ambiguous, so neither is applied.
    { key: "htpr-6091-feature-flags", mode: "EVERYONE", keep: true },
    // Neither field: nothing to change.
    { key: "htpr-6091-feature-flags" },
    // Keep must be a boolean, not a truthy string.
    { key: "htpr-6091-feature-flags", keep: "yes" },
  ];
  for (const body of bodies) {
    assert.equal((await admin.PATCH(request("PATCH", body))).status, 400);
  }
  assert.equal(writes, 0);
  assert.equal(keepWrites, 0);
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
