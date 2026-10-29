const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModule: load, root } = require("./helpers/loadModule.cjs");
const jiti = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true });
const usage = jiti(path.join(root, "src/app/api/settings/ai-usage/gatewayUsage.ts"));
let enabled, source, statuses, user, allowed;
const { GET } = load("src/app/api/settings/ai-usage/route.ts", {
  "@/app/api/ai/_lib/planAllowancePolicy": { resolveTeamAllowancePolicy: async () => ({ mode: "legacy" }) },
  "@/app/api/ai/_lib/sharedAllowance": { billedCostEnabled: async () => false },
  "next/server": { NextResponse: { json: Response.json } },
  "@/app/api/ai/_lib/byokKeys": { getTeamGatewayFunding: async () => ({ source, apiKey: "never-show-this-key" }) },
  "@/lib/auth/serverUser": { getServerCookieUser: async () => user },
  "@/lib/prisma": { __esModule: true, default: {
    team: { findUnique: async () => ({ googleAccount: { userId: 3412 }, googleAccountId: 1 }) },
    aiUsage: { groupBy: async () => [] },
    project: { findMany: async () => [] }, task: { findMany: async () => [] }, agent: { findMany: async () => [] },
  } },
  "@/utils/controllers/teams/hasTeamOwnerOrProjectAdminAccess": { __esModule: true, default: async () => allowed },
  "./gatewayUsage": usage,
  "@/app/api/ai/_lib/planGate": { storePlanIdForProject: async () => "Pro" },
  "@/lib/aiAllowancePolicy": { teamAiAllowanceUsd: () => 5 },
  "@/lib/flags": { isFeatureEnabled: async key => key === "htpr-8008-gateway-key-errors" && enabled },
  "@/lib/flags/definitions/htpr-7743-ai-usage-auth": { HTPR_7743_AI_USAGE_AUTH_FLAG: "htpr-7743-ai-usage-auth" },
  "@/lib/flags/definitions/htpr-8008-gateway-key-errors": { HTPR_8008_GATEWAY_KEY_ERRORS_FLAG: "htpr-8008-gateway-key-errors" },
});
const originalFetch = global.fetch;
const originalError = console.error;
test.beforeEach(() => {
  enabled = true; source = "customer"; statuses = [401, 401, 401];
  user = { id: 3412, accountId: 1 }; allowed = true;
  global.fetch = async () => Response.json({ results: [], secret: "never-show-this-key" }, { status: statuses.shift() });
  console.error = () => {};
});
test.afterEach(() => { global.fetch = originalFetch; console.error = originalError; });
const request = () => GET(new Request("https://app.hypertask.ai/api/settings/ai-usage?teamId=byok-team"));

for (const [status, message] of [
  [401, "Your team's AI Gateway key was rejected. Check it in Settings > Bring your own key."],
  [403, "Your team's AI Gateway key cannot read usage reports. Check its permissions with your provider."],
]) {
  test(`customer report ${status} has an actionable message without leaking the key`, async () => {
    statuses = [200, status, 200];
    const response = await request();
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { message: "Could not load AI Gateway usage", usageMessage: message });
  });
}
for (const funding of ["managed", "shared"]) {
  test(`${funding} report refusal never blames a customer key`, async () => {
    source = funding;
    assert.deepEqual(await (await request()).json(), { message: "Could not load AI Gateway usage" });
  });
}
test("flag off preserves the generic failure", async () => {
  enabled = false;
  assert.deepEqual(await (await request()).json(), { message: "Could not load AI Gateway usage" });
});
test("an upstream outage is not labeled as a key rejection", async () => {
  statuses = [503, 503, 503];
  assert.deepEqual(await (await request()).json(), { message: "Could not load AI Gateway usage" });
});
test("successful customer reports still show their own-key usage", async () => {
  statuses = [200, 200, 200];
  const response = await request();
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.configured, true);
  assert.equal(data.fundingSource, "customer");
  assert.equal(data.allowance, null);
  assert.deepEqual(data.models, []);
  assert.match(data.usageMessage, /does not consume Hypertask's included allowance/);
});
test("non-members remain refused before fetching reports", async () => {
  allowed = false;
  const response = await request();
  assert.equal(response.status, 403);
  assert.equal(statuses.length, 3);
});
test("signed-out callers remain unauthorized", async () => {
  user = null;
  assert.equal((await request()).status, 401);
  assert.equal(statuses.length, 3);
});

test("the rollback switch is a small Everyone bugfix", () => {
  const definition = load("src/lib/flags/definitions/htpr-8008-gateway-key-errors.ts").default;
  assert.equal(definition.key, "htpr-8008-gateway-key-errors");
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
});

for (const [status, data, expected] of [
  [502, { usageMessage: "Your team's AI Gateway key was rejected." }, "Your team's AI Gateway key was rejected."],
  [502, { message: "Could not load AI Gateway usage" }, "AI usage is currently unavailable."],
  [403, {}, "Only the team owner or a board admin can view AI usage."],
  [502, { usageMessage: { unexpected: true } }, "AI usage is currently unavailable."],
]) {
  test(`usage screen renders safe error copy: ${expected}`, async () => {
    const React = require("react");
    const { renderToStaticMarkup } = require("react-dom/server");
    let state = [], index = 0, effect;
    const container = ({ children }) => React.createElement("div", null, children);
    const { default: Screen } = load("src/components/Modals/Settings/AiUsageSection.tsx", {
      react: {
        useState: initial => {
          const position = index++;
          if (!(position in state)) state[position] = initial;
          return [state[position], value => { state[position] = value; }];
        },
        useEffect: fn => { effect = fn; },
      },
      "@/hooks/useFlag": { useFlag: () => false },
      "@/lib/flags/definitions/htpr-7919-allowance-percent": { HTPR_7919_ALLOWANCE_PERCENT_FLAG: "htpr-7919-allowance-percent" },
      axios: { __esModule: true, default: {
        get: async () => { throw { response: { status, data } }; },
        isAxiosError: () => true,
      } },
      "./SettingsCard": { __esModule: true, default: container },
      "./SettingsSectionShell": { __esModule: true, default: container },
      "./settingsNavigation": { useSettingsNavigation: () => ({ setSettingsSection: () => {} }) },
      "./useSettingsTeam": { useSettingsTeam: () => ({ teamId: "byok-team", project: null }) },
    });
    Screen();
    effect();
    await new Promise(resolve => setImmediate(resolve));
    index = 0;
    const html = renderToStaticMarkup(Screen());
    assert.ok(html.includes(expected.replaceAll("'", "&#x27;")), html);
  });
}
