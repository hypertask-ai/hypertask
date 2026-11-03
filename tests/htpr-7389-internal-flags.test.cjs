const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { NextRequest, NextResponse } = require("next/server");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

let owner = true;
let rows = [];
let reads = 0;
class FeatureFlagInputError extends Error {}

stubModule("src/lib/flags/http.ts", {
  noStore: (body, status = 200) => {
    const response = NextResponse.json(body, { status });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  },
});
stubModule("src/lib/flags.ts", {
  FEATURE_FLAG_MODES: ["OWNER_ONLY", "OWNER_AND_QA", "EVERYONE", "OFF"],
  FeatureFlagInputError,
  isFeatureFlagOwner: async () => owner,
  listFeatureFlagModes: async () => {
    reads++;
    return rows;
  },
  setFeatureFlagKeep: async () => ({}),
  setFeatureFlagMode: async () => ({}),
});
stubModule("src/lib/realtime/server.ts", { broadcastFeatureFlagsChange: async () => {} });
stubModule("src/lib/auth/getSessionUser.ts", {
  getSessionUser: async () => ({ userId: 6, source: "session" }),
});

const jiti = createJiti(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });
const { GET } = jiti(path.join(root, "src/app/api/admin/flags/route.ts"));
const { withoutInternalFlags } = jiti(path.join(root, "src/lib/flags/internal.ts"));

function request() {
  return new NextRequest("https://app.hypertask.ai/api/admin/flags", {
    headers: { host: "app.hypertask.ai", "x-forwarded-proto": "https" },
  });
}

test.beforeEach(() => {
  owner = true;
  rows = [];
  reads = 0;
});

test("internal flags never reach the owner's flags page", async () => {
  rows = [
    { key: "htpr-1000-live-feature", kind: "feature", mode: "EVERYONE" },
    { key: "htpr-1001-qa-login", kind: "internal", mode: "OWNER_AND_QA" },
    { key: "htpr-1002-bug", kind: "bugfix", mode: "EVERYONE" },
  ];
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json();
  assert.deepEqual(body.flags.map((flag) => flag.key), ["htpr-1000-live-feature", "htpr-1002-bug"]);
  assert.equal(body.detailsEnabled, true);
});

test("a page with only internal flags stays empty rather than showing them", async () => {
  rows = [{ key: "htpr-1001-qa-login", kind: "internal", mode: "OWNER_AND_QA" }];
  const body = await (await GET(request())).json();
  assert.deepEqual(body.flags, []);
});

test("someone who is not the flag owner reads no flags at all", async () => {
  owner = false;
  rows = [{ key: "htpr-1000-live-feature", kind: "feature", mode: "EVERYONE" }];
  const response = await GET(request());
  assert.equal(response.status, 404);
  assert.equal(reads, 0);
});

test("flags without a declared kind stay visible", () => {
  const kept = withoutInternalFlags([
    { key: "legacy-rollout" },
    { key: "htpr-1001-qa-login", kind: "internal" },
    { key: "htpr-1002-bug", kind: "bugfix" },
  ]);
  assert.deepEqual(kept.map((flag) => flag.key), ["legacy-rollout", "htpr-1002-bug"]);
});
