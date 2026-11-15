const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

const sessionId = "00000000-0000-4000-8000-000000000001";
const memberSessionId = "00000000-0000-4000-8000-000000000042";
const outsiderSessionId = "00000000-0000-4000-8000-000000000099";
const hookId = "11111111-1111-4111-8111-111111111111";
const secrets = ["cipher-secret", "whsec-secret", "ht_live_secret"];

function harness(flag = true) {
  const state = {
    flag, writes: 0, receipts: 0, records: new Map(),
    team: { id: "team-1", aiProviderSettings: {}, googleAccount: { userId: 6 } },
    members: [{ userId: 42, status: "Accepted", agentId: null }],
    sections: [{ id: 5, projectId: 15, deleted: false, visibility: true, section_title: "Doing" }],
    settings: [{ userId: 6, notification: true }, { userId: 42, notification: true }],
    keys: [{ teamId: "team-1", provider: "openai", enabled: true, ciphertext: "cipher-secret" }],
    skills: [{ id: 8, userId: 6, projectId: null, enabled: true, name: "Ship" }, { id: 9, userId: 42, projectId: null, enabled: true, name: "Notes" }],
    hooks: [{ id: hookId, teamId: "team-1", active: true, secret: "whsec-secret" }],
    tokens: [{ id: 3, teamId: "team-1", enabled: true, name: "Ops", key: "ht_live_secret" }],
  };
  const sessions = { 6: sessionId, 42: memberSessionId, 99: outsiderSessionId };
  const take = (row, select) => select ? Object.fromEntries(Object.entries(select).filter(([, on]) => on).map(([key]) => [key, row[key]])) : { ...row };
  const bag = (rows) => {
    const hit = (where) => rows.filter((row) => Object.entries(where).every(([key, value]) => row[key] === value));
    const one = async ({ where, select }) => { const row = hit(where)[0]; return row ? take(row, select) : null; };
    return {
      findMany: async ({ where, select }) => hit(where).map((row) => take(row, select)),
      findFirst: one,
      findUnique: one,
      updateMany: async ({ where, data }) => { const row = hit(where)[0]; if (!row) return { count: 0 }; Object.assign(row, data); state.writes += 1; return { count: 1 }; },
    };
  };
  const db = {
    chatSession: { findFirst: async ({ where }) => where.id === sessions[where.userId] && where.agentId == null ? { id: where.id } : null },
    project: { findFirst: async ({ where }) => {
      const userId = where.OR[0].ownerId;
      if (where.id !== 15 || (userId !== 6 && !state.members.some((member) => member.userId === userId && member.status === "Accepted" && member.agentId === null))) return null;
      return { id: 15, team: state.team };
    } },
    team: {
      findUnique: async ({ where }) => where.id === state.team.id ? state.team : null,
      update: async ({ where, data }) => { if (where.id !== state.team.id) throw new Error("missing team"); state.team.aiProviderSettings = data.aiProviderSettings; state.writes += 1; return state.team; },
    },
    section: bag(state.sections),
    userSetting: bag(state.settings),
    teamByokApiKey: bag(state.keys),
    aI_Skill: bag(state.skills),
    webhookSubscription: bag(state.hooks),
    betterAuthApiKey: bag(state.tokens),
    aiSettingOperation: { create: async () => { state.receipts += 1; return {}; }, deleteMany: async () => ({ count: 0 }), findFirst: async () => null },
    $transaction: async (fn) => fn(db),
  };
  const mocks = {
    "@/lib/prisma": { default: db },
    "@/lib/redis": { getRedis: async () => ({ get: async (key) => state.records.get(key) ?? null, set: async (key, value) => { state.records.set(key, value); return "OK"; }, eval: async () => 1 }) },
    "@/lib/flags": { isFeatureEnabled: async (key) => key === "htpr-9282-team-settings-chat" ? state.flag : true },
    "@/lib/flags/keys": { HTPR_7328_ROUNDED_THEME_FLAG: "rounded" },
    "@/lib/themeVisibilityServer": { readThemeVisibility: async () => ({ restore: false, loaded: true }) },
    "@/lib/themePreferences": { availableThemeOptions: () => [], normalizeThemePreference: (value) => value ?? "system" },
    "@/utils/controllers/projects/setMemberRole": { default: async () => ({ status: 200, json: {} }) },
    "@/utils/controllers/notifications/updateNotificationMatrix": { notificationCategories: [], notificationCellValue: () => false, updateNotificationMatrix: async () => ({}) },
    "@/lib/realtime/server": { broadcastBoardChange: async () => {} },
  };
  return { state, proposals: load("src/lib/ai/settings/proposals.ts", mocks), actions: load("src/lib/ai/settings/actions.ts", mocks) };
}

const cases = [
  { area: "column", scope: { section: "board-general", projectId: 15 }, target: "5", read: (state) => state.sections[0].visibility, access: false },
  { area: "notification-default", scope: { section: "notifications" }, target: "email", read: (state) => state.settings[0].notification, access: false },
  { area: "ai-model", scope: { section: "ai-models", projectId: 15 }, target: "openai", read: (state) => state.team.aiProviderSettings.openai !== false, access: false },
  { area: "ai-key", scope: { section: "apiKeys", projectId: 15 }, target: "openai", read: (state) => state.keys[0].enabled, access: true },
  { area: "skill", scope: { section: "skills", projectId: 15 }, target: "8", read: (state) => state.skills[0].enabled, access: false },
  { area: "integration", scope: { section: "webhooks", projectId: 15 }, target: hookId, read: (state) => state.hooks[0].active, access: true },
  { area: "agent-token", scope: { section: "management-keys", projectId: 15 }, target: "3", read: (state) => state.tokens[0].enabled, access: true },
];
const changeFor = (entry, value) => ({ kind: "team-area", area: entry.area, target: entry.target, value });

test("still allowed: the owner previews, applies, and undoes one switch in each area", async () => {
  const h = harness();
  for (const entry of cases) {
    const card = await h.proposals.createSettingProposal(6, sessionId, entry.scope, changeFor(entry, false));
    assert.equal(entry.read(h.state), true);
    assert.deepEqual([card.before, card.after, card.status, card.accessChange], [true, false, "pending", entry.access]);
    const stored = [...h.state.records.values()].join("\n");
    for (const secret of secrets) assert.equal(stored.includes(secret), false);
    assert.equal((await h.proposals.actOnSettingProposal(6, card.id, "apply", entry.scope)).proposal.status, "applied");
    assert.equal(entry.read(h.state), false);
    assert.equal((await h.proposals.actOnSettingProposal(6, card.id, "undo", entry.scope)).proposal.status, "undone");
    assert.equal(entry.read(h.state), true);
  }
  assert.equal(h.state.writes, cases.length * 2);
  assert.equal(h.state.receipts, cases.length * 2);
  assert.equal(JSON.stringify(await h.actions.readSettingsPage(6, cases[3].scope)).includes("cipher-secret"), false);
});

test("now refused: a member cannot change owner-only switches; still allowed: their column, email switch, and own skill", async () => {
  const h = harness();
  for (const area of ["ai-model", "ai-key", "integration", "agent-token"]) {
    const entry = cases.find((item) => item.area === area);
    await assert.rejects(h.proposals.createSettingProposal(42, memberSessionId, entry.scope, changeFor(entry, false)), /Only the team owner/);
  }
  await assert.rejects(h.proposals.createSettingProposal(42, memberSessionId, cases[4].scope, changeFor(cases[4], false)), /Skill not found or access denied/);
  await assert.rejects(h.proposals.createSettingProposal(99, outsiderSessionId, cases[0].scope, changeFor(cases[0], false)), /Board not found or access denied/);
  assert.equal(h.state.writes, 0);
  const column = await h.proposals.createSettingProposal(42, memberSessionId, cases[0].scope, changeFor(cases[0], false));
  await h.proposals.actOnSettingProposal(42, column.id, "apply", cases[0].scope);
  assert.equal(h.state.sections[0].visibility, false);
  const email = await h.proposals.createSettingProposal(42, memberSessionId, cases[1].scope, changeFor(cases[1], false));
  await h.proposals.actOnSettingProposal(42, email.id, "apply", cases[1].scope);
  assert.equal(h.state.settings[1].notification, false);
  assert.equal(h.state.settings[0].notification, true);
  const skill = await h.proposals.createSettingProposal(42, memberSessionId, cases[4].scope, { kind: "team-area", area: "skill", target: "9", value: false });
  await h.proposals.actOnSettingProposal(42, skill.id, "apply", cases[4].scope);
  assert.equal(h.state.skills[1].enabled, false);
  assert.equal(h.state.skills[0].enabled, true);
});

test("now refused: the switch stays manual when the flag is off, and a China provider stays off in GDPR safe mode", async () => {
  const off = harness(false);
  await assert.rejects(off.proposals.createSettingProposal(6, sessionId, cases[0].scope, changeFor(cases[0], false)), /not available for your account/);
  assert.equal(off.state.sections[0].visibility, true);
  assert.equal(off.state.writes, 0);
  const safe = harness();
  safe.state.team.aiProviderSettings = { gdprSafeMode: true };
  const card = await safe.proposals.createSettingProposal(6, sessionId, cases[2].scope, { kind: "team-area", area: "ai-model", target: "deepseek", value: true });
  await assert.rejects(safe.proposals.actOnSettingProposal(6, card.id, "apply", cases[2].scope), /GDPR safe mode/);
  assert.equal(safe.state.writes, 0);
});

test("team settings pages keep the open board, and appearance does not", () => {
  const catalog = load("src/lib/ai/settings/catalog.ts", {});
  assert.deepEqual(catalog.settingsScopeFromPath("/settings/ai-models", 15), { section: "ai-models", projectId: 15 });
  assert.deepEqual(catalog.settingsScopeFromPath("/settings/appearance", 15, "porcelain"), { section: "appearance", theme: "porcelain" });
});
