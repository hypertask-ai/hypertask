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
    management: undefined,
    ...options.ctx,
  };
  const viewerCalls = [];
  const ownedTeams = options.ownedTeams ?? [{ id: TEAM_ID }];
  const settings = options.settings ?? { providers: { openai: true, anthropic: false } };

  const db = {
    user: {
      findUnique: async ({ where }) => (where.id === 7 ? { accountId: null } : null),
    },
    team: {
      findMany: async () => ownedTeams,
    },
  };

  const mocks = {
    "@/lib/mcp/auth": {
      checkMcpRateLimit: async () =>
        options.limited
          ? NextResponse.json({ success: false, error: "Rate limited" }, { status: 429 })
          : null,
      validateMcpAuth: async () => (options.noAuth ? null : ctx),
      mcpUnauthorizedResponse: async () =>
        NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }),
    },
    "@/lib/auth/agentScope": {
      withAgentScopeRequest: (_request, run) => run(),
      prepareAgentScope: async () => {},
    },
    "@/lib/prisma": { default: db },
    "@/utils/controllers/teams/getTeamAiSettingsForViewer": {
      getTeamAiSettingsForViewer: async (userId, accountId, teamId) => {
        viewerCalls.push({ userId, accountId, teamId });
        if (options.viewerRefusal) return options.viewerRefusal;
        return { ok: true, settings };
      },
    },
    "@/app/api/ai/_lib/byokKeys": {
      getTeamGatewayFunding: async () =>
        options.funding === undefined ? { apiKey: "vck_fixture_never_printed", source: "shared" } : options.funding,
    },
    "@/lib/ai/jevDuplicateHint": { DUPLICATE_DECISION_MODEL_SLUG: JEV_MODEL },
    "@/lib/flags": { isFeatureEnabled: async () => options.jevEnabled ?? true },
    "@/lib/aiFeedback/automatic": { queueRestFailure: () => {} },
    "@/lib/mcp/routeWrapper": null,
    "@/lib/errors/reportError": { reportError: async (payload) => { reports.push(payload); } },
  };
  const reports = [];
  mocks["@/lib/mcp/routeWrapper"] = loadRouteWrapper(mocks);

  const { GET } = load("src/app/api/mcp/ai/settings/route.ts", mocks);
  const request = (query = "") =>
    new NextRequest(`http://mcp.test/api/mcp/ai/settings${query}`, {
      headers: { Authorization: "Bearer fixture-token" },
    });

  return {
    ctx,
    reports,
    viewerCalls,
    get: (query) => GET(request(query)),
  };
}

function collectKeys(value, keys = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys));
    return keys;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, nested]) => {
      keys.push(key);
      collectKeys(nested, keys);
    });
  }
  return keys;
}

test("an unauthenticated call is refused", async () => {
  const f = fixture({ noAuth: true });
  const response = await f.get("");
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.deepEqual(f.viewerCalls, []);
});

test("a runner token reads live setting names for its team", async () => {
  const f = fixture();
  const response = await f.get("");
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.success, true);
  assert.equal(body.teamId, TEAM_ID);
  assert.deepEqual(f.viewerCalls, [{ userId: 7, accountId: undefined, teamId: TEAM_ID }]);
  assert.equal(body.gdprSafeMode, false);
  assert.equal(body.ownKeyOnly, false);

  const openai = body.providers.find((provider) => provider.key === "openai");
  const anthropic = body.providers.find((provider) => provider.key === "anthropic");
  assert.equal(openai.label.length > 0, true);
  assert.equal(openai.enabled, true);
  assert.equal(anthropic.enabled, false);

  assert.deepEqual(body.gateway, { configured: true, source: "shared" });
  assert.deepEqual(body.jev, {
    flag: "htpr-9046-jev-duplicate-hint",
    model: JEV_MODEL,
    enabled: true,
  });
  assert.equal(typeof body.checkedAt, "string");
});

test("no key material reaches the response", async () => {
  const f = fixture();
  const raw = await (await f.get("")).text();
  const body = JSON.parse(raw);

  assert.equal(/vck_|sk-|ciphertext|apiKey/i.test(raw), false);
  const forbidden = collectKeys(body).filter((key) =>
    /apikey|ciphertext|secret|token/i.test(key),
  );
  assert.deepEqual(forbidden, []);
});

test("a team-scoped token cannot read another team", async () => {
  const f = fixture({
    ctx: { teamScope: { teamId: TEAM_ID, accessBinding: "member:one" } },
  });
  const response = await f.get(`?team_id=${OTHER_TEAM_ID}`);
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.deepEqual(f.viewerCalls, []);
});

test("a team-scoped token reads its own team with a matching team_id", async () => {
  const f = fixture({
    ctx: { teamScope: { teamId: TEAM_ID, accessBinding: "member:one" } },
  });
  const response = await f.get(`?team_id=${TEAM_ID}`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.teamId, TEAM_ID);
});

test("the viewer refusal keeps its status", async () => {
  const f = fixture({
    viewerRefusal: { ok: false, status: 403, message: "Forbidden" },
  });
  const response = await f.get(`?team_id=${TEAM_ID}`);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { success: false, error: "Forbidden" });
});
