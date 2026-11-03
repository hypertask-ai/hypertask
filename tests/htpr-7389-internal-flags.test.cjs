const assert = require("node:assert/strict");
const test = require("node:test");
const { NextRequest, NextResponse } = require("next/server");
const { loadModule } = require("./helpers/loadModule.cjs");

let owner = true;
let rows = [];
let reads = 0;
class FeatureFlagInputError extends Error {}

const stubs = {
  "@/lib/flags/http": {
    noStore: (body, status = 200) => {
      const response = NextResponse.json(body, { status });
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    },
  },
  "@/lib/flags": {
    FEATURE_FLAG_MODES: ["OWNER_ONLY", "OWNER_AND_QA", "EVERYONE", "OFF"],
    FeatureFlagInputError,
    isFeatureFlagOwner: async () => owner,
    listFeatureFlagModes: async () => {
      reads++;
      return rows;
    },
    setFeatureFlagKeep: async () => ({}),
    setFeatureFlagMode: async () => ({}),
  },
  "@/lib/realtime/server": { broadcastFeatureFlagsChange: async () => {} },
  "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 6, source: "session" }) },
};
const { GET } = loadModule("src/app/api/admin/flags/route.ts", stubs);
const { withoutInternalFlags } = loadModule("src/lib/flags/internal.ts");

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
