const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

function load(relativePath, stubs) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8").replace(/^#![^\n]*\n/, "");
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", "__dirname", "__filename", javascript)(
    mod, mod.exports, (request) => stubs[request] ?? jiti(request),
    path.dirname(path.join(root, relativePath)), path.join(root, relativePath),
  );
  return mod.exports;
}

function fixture() {
  const state = {
    plan: "Pro",
    row: null,
    requests: [],
    writes: [],
    held: true,
    response: { ok: true, status: 200, json: async () => ({ apiKeyString: "vck_new_team_key" }) },
  };
  const prisma = {
    teamByokApiKey: {
      findUnique: async ({ where }) => {
        assert.deepEqual(where, { teamId_provider: { teamId: "team_paid", provider: "managed_gateway" } });
        return state.row;
      },
      upsert: async (args) => {
        state.writes.push(args);
        if (state.failWrite) throw new Error("database unavailable");
        state.row ??= args.create;
        return state.row;
      },
    },
  };
  const provision = load("src/lib/provisionManagedTeamGatewayKey.ts", {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/app/api/ai/_lib/planGate": { storePlanIdForProject: async () => state.plan },
  });
  return {
    state,
    ensure: (options) => provision.ensureManagedTeamGatewayKeyWithTeamLockHeld("team_paid", () => {
      if (!state.held) throw new Error("lock lost");
    }, options),
  };
}

const originalFetch = global.fetch;
const originalEnv = { ...process.env };
test.beforeEach(() => {
  process.env.MANAGED_GATEWAY_VERCEL_TOKEN = "vercel_test_token";
  process.env.MANAGED_GATEWAY_VERCEL_TEAM_ID = "team_vercel";
  process.env.BYOK_CIPHER_SECRET = "test-managed-gateway-cipher-secret";
});
test.afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

function mockFetch(state, afterRequest) {
  global.fetch = async (url, options) => {
    state.requests.push({ url: String(url), options });
    afterRequest?.();
    return state.response;
  };
}

test("new Pro and AI teams receive encrypted, dedicated managed keys", async () => {
  for (const plan of ["Pro", "AI"]) {
    const { state, ensure } = fixture();
    state.plan = plan;
    mockFetch(state);
    assert.equal(await ensure(), "created");
    assert.equal(state.requests.length, 1);
    const { url, options } = state.requests[0];
    assert.equal(url, "https://api.vercel.com/v1/api-keys?teamId=team_vercel");
    assert.equal(options.headers.Authorization, "Bearer vercel_test_token");
    assert.equal(options.method, "POST");
    assert.equal(options.signal.aborted, false);
    assert.deepEqual(JSON.parse(options.body), {
      purpose: "ai-gateway", name: "Hypertask team team_paid",
      metadata: { spendAttribution: "team" },
    });
    assert.equal(state.writes.length, 1);
    assert.equal(state.row.enabled, true);
    assert.equal(state.row.provider, "managed_gateway");
    assert.notEqual(state.row.ciphertext, "vck_new_team_key");
    const { decryptByokSecret } = jiti(path.join(root, "src/lib/crypto/byokCipher.ts"));
    assert.equal(decryptByokSecret(state.row.ciphertext), "vck_new_team_key");
    const { getTeamGatewayFunding } = load("src/app/api/ai/_lib/byokKeys.ts", {
      "@/lib/prisma": { __esModule: true, default: {
        teamByokApiKey: { findUnique: async ({ where }) =>
          where.teamId_provider.provider === "managed_gateway" ? state.row : null },
      } },
      "@/app/api/ai/_lib/planGate": { storePlanIdForProject: async () => plan },
      "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
    });
    assert.deepEqual(await getTeamGatewayFunding({ trustedTeamId: "team_paid" }), {
      apiKey: "vck_new_team_key", source: "managed",
    });
    assert.equal(await ensure(), "existing");
    assert.equal(state.requests.length, 1);
  }
});

test("Free and BYOK plans never receive a managed key", async () => {
  for (const plan of ["Free", "BYOK"]) {
    const { state, ensure } = fixture();
    state.plan = plan;
    mockFetch(state);
    assert.equal(await ensure(), "ineligible");
    assert.equal(state.requests.length, 0);
    assert.equal(state.writes.length, 0);
  }
});

test("existing keys, including deliberately disabled keys, are never replaced", async () => {
  for (const enabled of [true, false]) {
    const { state, ensure } = fixture();
    state.row = { enabled, ciphertext: "existing_secret" };
    mockFetch(state);
    delete process.env.MANAGED_GATEWAY_VERCEL_TOKEN;
    assert.equal(await ensure(), "existing");
    assert.deepEqual(state.row, { enabled, ciphertext: "existing_secret" });
    assert.equal(state.requests.length, 0);
    assert.equal(state.writes.length, 0);
  }
});

test("dry run reports a missing paid-team key without credentials or writes", async () => {
  const { state, ensure } = fixture();
  mockFetch(state);
  delete process.env.MANAGED_GATEWAY_VERCEL_TOKEN;
  assert.equal(await ensure({ dryRun: true }), "missing");
  assert.equal(state.requests.length, 0);
  assert.equal(state.writes.length, 0);
});

test("missing configuration fails before creating a Vercel key", async () => {
  for (const env of ["MANAGED_GATEWAY_VERCEL_TOKEN", "MANAGED_GATEWAY_VERCEL_TEAM_ID", "BYOK_CIPHER_SECRET"]) {
    const { state, ensure } = fixture();
    mockFetch(state);
    const value = process.env[env];
    delete process.env[env];
    await assert.rejects(ensure(), /managed gateway provisioning configuration/i);
    assert.equal(state.requests.length, 0);
    assert.equal(state.writes.length, 0);
    process.env[env] = value;
  }
});

test("upstream errors and invalid responses never store a key or leak response secrets", async () => {
  for (const response of [
    { ok: false, status: 403, json: async () => ({ error: "secret_from_upstream" }) },
    { ok: true, status: 200, json: async () => ({ apiKeyString: "sk_wrong_provider" }) },
    { ok: true, status: 200, json: async () => ({}) },
  ]) {
    const { state, ensure } = fixture();
    state.response = response;
    mockFetch(state);
    await assert.rejects(ensure(), (error) => {
      assert.match(error.message, /managed gateway/i);
      assert.doesNotMatch(error.message, /secret_from_upstream|sk_wrong_provider|vercel_test_token/);
      return true;
    });
    assert.equal(state.writes.length, 0);
  }
});

test("losing the billing lease prevents provisioning and persistence", async () => {
  const { state, ensure } = fixture();
  mockFetch(state);
  state.held = false;
  await assert.rejects(ensure(), /lock lost/);
  assert.equal(state.requests.length, 0);
  state.held = true;
  mockFetch(state, () => { state.held = false; });
  await assert.rejects(ensure(), /lock lost/);
  assert.equal(state.writes.length, 0);
});

test("a concurrent admin key is preserved", async () => {
  const { state, ensure } = fixture();
  mockFetch(state, () => { state.row = { enabled: true, ciphertext: "admin_secret" }; });
  assert.equal(await ensure(), "existing");
  assert.equal(state.row.ciphertext, "admin_secret");
  assert.deepEqual(state.writes[0].update, {});
});


test("backfill defaults to dry run, paginates, and applies only when requested", async () => {
  for (const apply of [undefined, true]) {
    const pages = [];
    const calls = [];
    let disconnected = false;
    const prisma = {
      team: { findMany: async (args) => {
        pages.push(args);
        return pages.length === 1 ? [{ id: "team_paid" }, { id: "team_free" }] : [];
      } },
      $disconnect: async () => { disconnected = true; },
    };
    const { backfillManagedTeamGatewayKeys } = load("scripts/backfill-managed-team-gateway-keys.cjs", {
      dotenv: { config: () => {} },
      jiti: () => (filename) => {
        if (filename.endsWith("/prisma.ts")) return { default: prisma };
        if (filename.endsWith("/seatBillingLock.ts")) return {
          withTeamSeatBillingLock: async (teamId, run) => run(() => { calls.push([teamId, "held"]); }),
        };
        if (filename.endsWith("/provisionManagedTeamGatewayKey.ts")) return {
          ensureManagedTeamGatewayKeyWithTeamLockHeld: async (teamId, assertHeld, options) => {
            assertHeld();
            calls.push([teamId, options]);
            return teamId === "team_free" ? "ineligible" : options.dryRun ? "missing" : "created";
          },
        };
        throw new Error(`Unexpected import ${filename}`);
      },
    });
    const counts = await backfillManagedTeamGatewayKeys(apply === undefined ? undefined : { apply });
    assert.deepEqual(counts, { created: apply ? 1 : 0, missing: apply ? 0 : 1, existing: 0, ineligible: 1 });
    assert.deepEqual(calls, [
      ["team_paid", "held"], ["team_paid", { dryRun: !apply }],
      ["team_free", "held"], ["team_free", { dryRun: !apply }],
    ]);
    assert.deepEqual(pages[0].where, { subscriptionPlan: { some: {} } });
    assert.deepEqual(pages[1].cursor, { id: "team_free" });
    assert.equal(pages[1].skip, 1);
    assert.equal(disconnected, true);
  }
});


test("a failed persistence attempt remains retryable without storing a partial key", async () => {
  const { state, ensure } = fixture();
  mockFetch(state);
  state.failWrite = true;
  await assert.rejects(ensure(), /database unavailable/);
  assert.equal(state.row, null);
  state.failWrite = false;
  assert.equal(await ensure(), "created");
  assert.equal(await ensure(), "existing");
  assert.equal(state.requests.length, 2);
});
