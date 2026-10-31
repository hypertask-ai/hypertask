const assert = require("node:assert/strict");
const test = require("node:test");
let state;
const { loadModule } = require("./helpers/loadModule.cjs");
const stubs = {};
function stub(file, exports) {
  stubs["@/" + file.slice(4).replace(/\.ts$/, "")] = exports;
}
stub("src/lib/prisma.ts", { default: { user: { findUnique: async () => ({ id: 7 }) } } });
stub("src/lib/auth/getSessionUser.ts", { getSessionUser: async () => ({ userId: 7 }) });
stub("src/utils/controllers/teams/getTeamAiSettingsForViewer.ts", { getTeamAiSettingsForViewer: async () => ({
  ok: true, aiKeyOnly: state.keyOnly, ownerUserId: 42, settings: {}, savedByokProviders: ["claude"],
}) });
stub("src/app/api/ai/_lib/byokKeys.ts", { getOpenAiOnlyDefaultContext: async () => ({}) });
stub("src/lib/flags.ts", { isFeatureEnabled: async (key, userId) => {
  state.calls.push([key, userId]);
  if (state.error) throw new Error("flag unavailable");
  return state.enabled;
} });
const handler = loadModule("src/pages/api/teams/aiProviderSettings.ts", stubs).default;
async function get() {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method: "GET", headers: {}, query: { teamId: "team" } }, res);
  return res;
}
test("picker uses owning user and pauses marked teams when off", async () => {
  state = { keyOnly: true, enabled: true, calls: [] };
  const on = await get();
  assert.equal(on.statusCode, 200);
  assert.deepEqual(state.calls, [["htpr-7844-team-ai-key-only", 42]]);
  assert.deepEqual(on.body.providers.filter((provider) => provider.enabled).map((provider) => provider.key), ["anthropic"]);
  state = { keyOnly: true, enabled: false, calls: [] };
  assert.equal((await get()).statusCode, 503);
  state = { keyOnly: false, enabled: false, calls: [] };
  assert.equal((await get()).statusCode, 200);
  assert.deepEqual(state.calls, []);
  state = { keyOnly: true, error: true, calls: [] };
  await assert.rejects(get, /flag unavailable/);
});
