const assert = require("node:assert/strict");
const test = require("node:test");
const { NextRequest, NextResponse } = require("next/server");
const { load } = require("./task-route-loader.cjs");
const { loadRouteWrapper } = require("./helpers/mcp-route-wrapper.cjs");

const TEAM_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TEAM_ID = "22222222-2222-4222-8222-222222222222";
const JEV_MODEL = "anthropic/claude-haiku-5.5";

function fixture(options = {}) {
  const ctx = {
    user: { id: 7, email: "owner@example.invalid" },
    agentId: "agent-runner",
    agentRole: "read",
    teamScope: options.teamScope ?? null,
    ...options.ctx,
  };
  const viewerCalls = [];
  const mocks = {
    "@/lib/mcp/auth": {
      checkMcpRateLimit: async () => null,
      validateMcpAuth: async () => (options.noAuth ? null : ctx),
      mcpUnauthorizedResponse: async () => NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    },
    "@/lib/auth/agentScope": {
      withAgentScopeRequest: (_request, run) => run(),
      prepareAgentScope: async () => {},
    },
    "@/lib/ai/modelCanary": {
      readModelCanaryStatus: async () => ({ checkedAt: null, state: "disabled", models: [] }),
    },
    "@/lib/prisma": {
      default: {
        user: { findUnique: async ({ where }) => (where.id === 7 ? { accountId: null } : null) },
        team: { findMany: async () => (options.ownedTeams ?? [{ id: TEAM_ID }]) },
      },
    },
    "@/utils/controllers/teams/getTeamAiSettingsForViewer": {
      getTeamAiSettingsForViewer: async (userId, accountId, teamId) => {
        viewerCalls.push({ userId, accountId, teamId });
        if (options.viewerThrow) throw new Error("settings read failed");
        return options.viewerRefusal ?? {
          ok: true,
          settings: { providers: { openai: true, anthropic: false } },
        };
      },
    },
    "@/app/api/ai/_lib/byokKeys": {
      getTeamGatewayFunding: async () => ({ apiKey: "vck_fixture_never_printed", source: "shared" }),
    },
    "@/lib/ai/jevDuplicateHint": { DUPLICATE_DECISION_MODEL_SLUG: JEV_MODEL },
    "@/lib/flags": {
      MODEL_CANARY_STATE_FLAG: "htpr-7748-model-canary-state",
      isFeatureEnabled: async () => options.stateFlag ?? true,
    },
    "@/lib/aiFeedback/automatic": { queueRestFailure: () => {} },
    "@/lib/errors/reportError": { reportError: async () => {} },
  };
  mocks["@/lib/mcp/routeWrapper"] = loadRouteWrapper(mocks);
  const { GET } = load("src/app/api/mcp/ai/models/status/route.ts", mocks);
  return {
    viewerCalls,
    get: (query = "") =>
      GET(new NextRequest(`http://mcp.test/api/mcp/ai/models/status${query}`)),
  };
}

function collectKeys(value, keys = []) {
  if (Array.isArray(value)) value.forEach((item) => collectKeys(item, keys));
  else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, nested]) => {
      keys.push(key);
      collectKeys(nested, keys);
    });
  }
  return keys;
}

test("an unauthenticated read is refused", async () => {
  const f = fixture({ noAuth: true });
  assert.equal((await f.get()).status, 401);
  assert.deepEqual(f.viewerCalls, []);
});

test("a runner reads live setting names next to the canary rows", async () => {
  const f = fixture();
  const response = await f.get();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.deepEqual(f.viewerCalls, [{ userId: 7, accountId: undefined, teamId: TEAM_ID }]);
  const settings = body.settings;
  assert.equal(settings.teamId, TEAM_ID);
  assert.equal(settings.gdprSafeMode, false);
  assert.equal(settings.ownKeyOnly, false);
  const openai = settings.providers.find((provider) => provider.key === "openai");
  const anthropic = settings.providers.find((provider) => provider.key === "anthropic");
  assert.ok(openai.label.length > 0);
  assert.equal(openai.enabled, true);
  assert.equal(anthropic.enabled, false);
  assert.deepEqual(settings.gateway, { configured: true, source: "shared" });
  assert.deepEqual(settings.jev, {
    flag: "htpr-9046-jev-duplicate-hint",
    model: JEV_MODEL,
    enabled: true,
  });
});

test("no key material reaches the response", async () => {
  const response = await fixture().get();
  const raw = await response.clone().text();
  assert.equal(/vck_|sk-|ciphertext|apiKey/i.test(raw), false);
  assert.deepEqual(
    collectKeys(await response.json()).filter((key) => /apikey|ciphertext|secret|token/i.test(key)),
    [],
  );
});

test("the Jev state is readable without a resolved team", async () => {
  const f = fixture({ ownedTeams: [{ id: TEAM_ID }, { id: OTHER_TEAM_ID }] });
  const body = await (await f.get()).json();
  assert.equal(body.settings.teamId, null);
  assert.equal(body.settings.jev.enabled, true);
  assert.deepEqual(f.viewerCalls, []);
});

test("a team-scoped token cannot read another team", async () => {
  const f = fixture({ teamScope: { teamId: TEAM_ID, accessBinding: "member:one" } });
  const body = await (await f.get(`?team_id=${OTHER_TEAM_ID}`)).json();
  assert.equal(body.settings.teamId, null);
  assert.deepEqual(f.viewerCalls, []);
  const own = await (await f.get(`?team_id=${TEAM_ID}`)).json();
  assert.equal(own.settings.teamId, TEAM_ID);
});

test("the legacy shape stays when the state flag is off", async () => {
  const body = await (await fixture({ stateFlag: false }).get()).json();
  assert.deepEqual(Object.keys(body).sort(), ["checkedAt", "models", "success"]);
});

test("a failed settings read keeps the canary rows and says the settings are unreadable", async () => {
  const f = fixture({ viewerThrow: true });
  const response = await f.get();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.state, "disabled");
  assert.equal(body.settings.unreadable, true);
  assert.equal(body.settings.teamId, null);
  assert.deepEqual(body.settings.providers, []);
  assert.equal(body.settings.jev.flag, "htpr-9046-jev-duplicate-hint");
});
