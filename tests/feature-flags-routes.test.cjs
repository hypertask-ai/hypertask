const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
function loadRoute(relativePath, stubs) {
  const filename = path.join(root, relativePath);
  const javascript = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", "__filename", "__dirname", javascript)(
    mod,
    mod.exports,
    (request) => stubs[request] ?? require(request),
    filename,
    path.dirname(filename),
  );
  return mod.exports;
}

const nextServer = {
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
};
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

let userId = 7;
let reads = 0;
let writes = 0;
let broadcasts = 0;
const admin = loadRoute("src/app/api/admin/flags/route.ts", {
  "next/server": nextServer,
  "@/lib/flags": {
    FEATURE_FLAG_MODES: ["OWNER_ONLY", "EVERYONE", "OFF"],
    FeatureFlagInputError: class FeatureFlagInputError extends Error {},
    isFeatureFlagOwner: async () => userId === 6,
    listFeatureFlagModes: async () => {
      reads += 1;
      return [{ key: "htpr-6091-feature-flags", mode: "OWNER_ONLY", updatedAt: null }];
    },
    setFeatureFlagMode: async (key, mode) => {
      writes += 1;
      return { key, mode, updatedAt: new Date() };
    },
  },
  "@/lib/realtime/server": {
    broadcastFeatureFlagsChange: async () => {
      broadcasts += 1;
    },
  },
});

test.beforeEach(() => {
  userId = 7;
  reads = 0;
  writes = 0;
  broadcasts = 0;
});

test("non-owners receive 404 before flag data is read", async () => {
  assert.deepEqual(await json(await admin.GET(request())), { status: 404, body: { error: "Not found" } });
  assert.equal(reads, 0);
});

test("the owner can list and change a declared flag", async () => {
  userId = 6;
  assert.equal((await admin.GET(request())).status, 200);
  const result = await json(
    await admin.PATCH(request("PATCH", { key: "htpr-6091-feature-flags", mode: "OFF" })),
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
  const route = loadRoute("src/app/api/flags/route.ts", {
    "next/server": nextServer,
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 8 }) },
    "@/lib/flags": { featureFlagsForUser: async (id) => ({ example: id === 6 }) },
  });
  const response = await route.GET(request());
  assert.deepEqual(await json(response), { status: 200, body: { flags: { example: false } } });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});
