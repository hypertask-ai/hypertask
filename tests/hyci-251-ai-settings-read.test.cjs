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
  const reports = [];
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
    "@/lib/prisma": {
      default: {
        user: { findUnique: async ({ where }) => (where.id === 7 ? { accountId: null } : null) },
        team: { findMany: async () => [{ id: TEAM_ID }] },
      },
    },
    "@/utils/controllers/teams/getTeamAiSettingsForViewer": {
      getTeamAiSettingsForViewer: async (userId, accountId, teamId) => {
        viewerCalls.push({ userId, accountId, teamId });
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
    "@/lib/flags": { isFeatureEnabled: async () => true },
    "@/lib/aiFeedback/automatic": { queueRestFailure: () => {} },
    "@/lib/errors/reportError": { reportError: async (payload) => reports.push(payload) },
  };
  mocks["@/lib/mcp/routeWrapper"] = loadRouteWrapper(mocks);
  const { GET } = load("src/app/api/mcp/ai/settings/route.ts", mocks);
  return {
    reports,
    viewerCalls,
    get: (query = "") => GET(new NextRequest(`http://mcp.test/api/mcp/ai/settings${query}`)),
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

test("an unauthenticated call is refused", async () => {
  const f = fixture({ noAuth: true });
  const response = await f.get();
  assert.equal(response.status, 401);
  assert.equal((await response.json()).success, false);
  assert.deepEqual(f.viewerCalls, []);
});

test("a runner token reads live setting names for its team", async () => {
  const f = fixture();
  const response = await f.get();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.teamId, TEAM_ID);
  assert.deepEqual(f.viewerCalls, [{ userId: 7, accountId: undefined, teamId: TEAM_ID }]);
  assert.equal(body.gdprSafeMode, false);
  assert.equal(body.ownKeyOnly, false);
  const openai = body.providers.find((provider) => provider.key === "openai");
  const anthropic = body.providers.find((provider) => provider.key === "anthropic");
  assert.ok(openai.label.length > 0);
  assert.equal(openai.enabled, true);
  assert.equal(anthropic.enabled, false);
  assert.deepEqual(body.gateway, { configured: true, source: "shared" });
  assert.deepEqual(body.jev, { flag: "htpr-9046-jev-duplicate-hint", model: JEV_MODEL, enabled: true });
  assert.equal(typeof body.checkedAt, "string");
});

test("no key material reaches the response", async () => {
  const raw = await (await fixture().get()).text();
  const body = JSON.parse(raw);
  assert.equal(/vck_|sk-|ciphertext|apiKey/i.test(raw), false);
  assert.deepEqual(collectKeys(body).filter((key) => /apikey|ciphertext|secret|token/i.test(key)), []);
});

test("a team-scoped token cannot read another team", async () => {
  const f = fixture({ teamScope: { teamId: TEAM_ID, accessBinding: "member:one" } });
  const response = await f.get(`?team_id=${OTHER_TEAM_ID}`);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).success, false);
  assert.deepEqual(f.viewerCalls, []);
  assert.equal((await f.get(`?team_id=${TEAM_ID}`)).status, 200);
});

test("the viewer refusal keeps its status", async () => {
  const f = fixture({ viewerRefusal: { ok: false, status: 403, message: "Forbidden" } });
  const response = await f.get(`?team_id=${TEAM_ID}`);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { success: false, error: "Forbidden" });
});
