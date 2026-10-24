const test = require("node:test");
const assert = require("node:assert/strict");
const { NextRequest } = require("next/server");
const { load } = require("./task-route-loader.cjs");

function harness() {
  const state = {
    enabled: true, rounded: true,
    session: { userId: 6, source: "better-auth", teamScope: null },
    ownerId: 6,
    members: [
      { id: 101, userId: 42, role: "Member", status: "Accepted", agentId: null, user: { displayName: "Anna", email: "anna@example.com" } },
      { id: 102, userId: 17, role: "Admin", status: "Accepted", agentId: null, user: { displayName: "Ada", email: "ada@example.com" } },
    ],
    settings: new Map([[6, { notificationPreference: "all", notification: true, notificationMatrix: { comments: { email: true, push: true }, moves: { email: false, push: true }, splitsNoImportant: ["project:15"], showImportantSplit: true } }], [42, { notificationPreference: "direct", notification: true, notificationMatrix: {} }]]),
    records: new Map(), writes: 0, beforeRoleWrite: null,
  };
  const db = {
    chatSession: { findFirst: async ({ where }) => where.id === ({ 6: sessionId, 42: memberSessionId, 17: adminSessionId })[where.userId] ? { id: where.id } : null },
    project: {
      findUnique: async ({ where }) => where.id === 15 ? { id: 15, ownerId: state.ownerId } : null,
      findFirst: async ({ where }) => {
        const actor = where.OR[0].ownerId;
        if (where.id !== 15 || (actor !== state.ownerId && !state.members.some((member) => member.userId === actor && member.agentId === null && member.status === "Accepted"))) return null;
        return { title: "Work", ownerId: state.ownerId, members: state.members.filter((member) => member.agentId === null && member.status === "Accepted").map((member) => ({ ...member })) };
      },
    },
    member: {
      findFirst: async ({ where }) => state.members.find((member) => member.userId === where.userId && where.projectId === 15 && member.status === where.status && member.agentId === where.agentId) ?? null,
      updateMany: async ({ where, data }) => {
        state.beforeRoleWrite?.();
        const member = state.members.find((entry) => entry.id === where.id && entry.role === where.role && entry.userId === where.userId && entry.status === where.status && entry.agentId === where.agentId && state.ownerId === where.project.ownerId);
        if (!member) return { count: 0 };
        Object.assign(member, data); state.writes++;
        return { count: 1 };
      },
      update: async ({ where, data }) => { const member = state.members.find((entry) => entry.id === where.id); Object.assign(member, data); state.writes++; return member; },
    },
    userSetting: {
      findUnique: async ({ where }) => state.settings.get(where.userId) ?? null,
      update: async ({ where, data }) => { const setting = state.settings.get(where.userId); Object.assign(setting, data); state.writes++; return setting; },
    },
    $transaction: async (fn) => fn(db),
  };
  const redis = {
    get: async (key) => state.records.get(key) ?? null,
    set: async (key, value, _ex, _ttl, mode) => {
      if (mode === "NX" && state.records.has(key)) return null;
      state.records.set(key, value); return "OK";
    },
    eval: async (_script, _keys, key, token) => { if (state.records.get(key) === token) state.records.delete(key); return 1; },
  };
  const mocks = {
    "@/lib/prisma": { default: db },
    "@/lib/redis": { getRedis: async () => redis },
    "@/lib/flags": { isFeatureEnabled: async (key) => key === "rounded" ? state.rounded : state.enabled },
    "@/lib/flags/keys": { HTPR_7328_ROUNDED_THEME_FLAG: "rounded" },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => state.session },
    "@/lib/agentRuns/service": { browserMutationIsSameOrigin: (request) => request.headers.get("origin") === request.nextUrl.origin },
    "@/utils/controllers/users/fetch_preferences": { invalidateUserPreferenceCache: async () => {} },
    "@/lib/realtime/server": { broadcastBoardChange: async () => {} },
    "@/lib/ai/tools/execution": { withToolErrors: (fn) => fn },
  };
  return {
    state,
    proposals: load("src/lib/ai/settings/proposals.ts", mocks),
    actions: load("src/lib/ai/settings/actions.ts", mocks),
    route: load("src/app/api/ai/settings/route.ts", mocks),
    matrix: load("src/utils/controllers/notifications/updateNotificationMatrix.ts", mocks),
    tool: load("src/lib/ai/tools/settings.ts", mocks),
  };
}
const sessionId = "00000000-0000-4000-8000-000000000001";
const memberSessionId = "00000000-0000-4000-8000-000000000042";
const adminSessionId = "00000000-0000-4000-8000-000000000017";
const boardScope = { section: "board-members", projectId: 15 };
const roleChange = { kind: "board-role", targetUserId: 42, value: "Admin" };
const themeScope = { section: "appearance", theme: "porcelain" };
const themeChange = { kind: "theme", value: "graphite" };
function request(body, { origin = "https://app.hypertask.ai", theme = "porcelain" } = {}) {
  return new NextRequest("https://app.hypertask.ai/api/ai/settings", {
    method: "POST", headers: { origin, cookie: `theme=${theme}`, "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

test("now refused: a member and an admin cannot ask AI to promote another board member", async () => {
  const h = harness();
  await assert.rejects(h.proposals.createSettingProposal(42, memberSessionId, boardScope, { ...roleChange, targetUserId: 17 }), /Only the board owner/);
  await assert.rejects(h.proposals.createSettingProposal(17, adminSessionId, boardScope, roleChange), /Only the board owner/);
  assert.equal(h.state.members[0].role, "Member");
  assert.equal(h.state.writes, 0);
  const allowed = await h.proposals.createSettingProposal(6, sessionId, boardScope, roleChange);
  assert.deepEqual([allowed.before, allowed.after, allowed.status, allowed.accessChange], ["Member", "Admin", "pending", true]);
});

test("still allowed: the owner previews without mutation, applies once and undoes through the same role action", async () => {
  const h = harness();
  const card = await h.proposals.createSettingProposal(6, sessionId, boardScope, roleChange);
  assert.equal(h.state.members[0].role, "Member");
  const applied = await h.proposals.actOnSettingProposal(6, card.id, "apply", boardScope);
  assert.deepEqual([applied.proposal.status, h.state.members[0].role], ["applied", "Admin"]);
  await assert.rejects(h.proposals.actOnSettingProposal(6, card.id, "apply", boardScope), /already been handled/);
  const undone = await h.proposals.actOnSettingProposal(6, card.id, "undo", boardScope);
  assert.deepEqual([undone.proposal.status, h.state.members[0].role, h.state.writes], ["undone", "Member", 2]);
});

test("now refused: revoked owner rights are rechecked on Apply and on Undo", async () => {
  const h = harness();
  const card = await h.proposals.createSettingProposal(6, sessionId, boardScope, roleChange);
  h.state.ownerId = 17;
  await assert.rejects(h.proposals.actOnSettingProposal(6, card.id, "apply", boardScope), /access denied/);
  h.state.ownerId = 6;
  await h.proposals.actOnSettingProposal(6, card.id, "apply", boardScope);
  h.state.ownerId = 17;
  await assert.rejects(h.proposals.actOnSettingProposal(6, card.id, "undo", boardScope), /access denied/);
  assert.equal(h.state.members[0].role, "Admin");
});

test("now refused: ownership changing during the role write cannot grant access; still allowed after ownership is restored", async () => {
  const h = harness();
  const card = await h.proposals.createSettingProposal(6, sessionId, boardScope, roleChange);
  h.state.beforeRoleWrite = () => { h.state.ownerId = 17; };
  await assert.rejects(h.proposals.actOnSettingProposal(6, card.id, "apply", boardScope), /Role or board access changed/);
  assert.equal(h.state.members[0].role, "Member");
  assert.equal(h.state.writes, 0);
  h.state.beforeRoleWrite = null;
  h.state.ownerId = 6;
  const applied = await h.proposals.actOnSettingProposal(6, card.id, "apply", boardScope);
  assert.deepEqual([applied.proposal.status, h.state.members[0].role], ["applied", "Admin"]);
});

test("now refused: another person's proposal, a different page/board and expired cards cannot be applied", async () => {
  const h = harness();
  const card = await h.proposals.createSettingProposal(6, sessionId, boardScope, roleChange);
  await assert.rejects(h.proposals.actOnSettingProposal(42, card.id, "apply", boardScope), /not yours/);
  await assert.rejects(h.proposals.actOnSettingProposal(6, card.id, "apply", { ...boardScope, projectId: 16 }), /original settings page/);
  await assert.rejects(h.proposals.actOnSettingProposal(6, card.id, "apply", { section: "members", projectId: 15 }), /original settings page/);
  h.state.records.delete(`ai-setting:6:${card.id}`);
  await assert.rejects(h.proposals.actOnSettingProposal(6, card.id, "apply", boardScope), /expired/);
  assert.equal(h.state.members[0].role, "Member");
  const next = await h.proposals.createSettingProposal(6, sessionId, boardScope, roleChange);
  assert.equal(next.status, "pending");
});

test("now refused: stale Apply, stale Undo and role races never overwrite a newer choice", async () => {
  const h = harness();
  const card = await h.proposals.createSettingProposal(6, sessionId, boardScope, roleChange);
  h.state.members[0].role = "Admin";
  await assert.rejects(h.proposals.actOnSettingProposal(6, card.id, "apply", boardScope), /changed since the preview/);
  h.state.members[0].role = "Member";
  h.state.beforeRoleWrite = () => { h.state.members[0].role = "Admin"; };
  await assert.rejects(h.proposals.actOnSettingProposal(6, card.id, "apply", boardScope), /Role or board access changed/);
  h.state.beforeRoleWrite = null;
  h.state.members[0].role = "Member";
  await h.proposals.actOnSettingProposal(6, card.id, "apply", boardScope);
  h.state.members[0].role = "Member";
  await assert.rejects(h.proposals.actOnSettingProposal(6, card.id, "undo", boardScope), /changed since the preview/);
  assert.equal(h.state.writes, 1);
});

test("still allowed: members change only their own notification cell, preserving other channels and inbox splits", async () => {
  const h = harness();
  const scope = { section: "notifications" };
  const own = await h.proposals.createSettingProposal(42, memberSessionId, scope, { kind: "notification", category: "comments", channel: "email", value: true });
  await h.proposals.actOnSettingProposal(42, own.id, "apply", scope);
  assert.deepEqual(h.state.settings.get(42).notificationMatrix.comments, { email: true, push: false });
  assert.deepEqual(h.state.settings.get(6).notificationMatrix.comments, { email: true, push: true });
  const card = await h.proposals.createSettingProposal(6, sessionId, scope, { kind: "notification", category: "comments", channel: "email", value: false });
  await h.proposals.actOnSettingProposal(6, card.id, "apply", scope);
  assert.deepEqual(h.state.settings.get(6).notificationMatrix, { comments: { email: false, push: true }, moves: { email: false, push: true }, splitsNoImportant: ["project:15"], showImportantSplit: true });
  await h.proposals.actOnSettingProposal(6, card.id, "undo", scope);
  assert.deepEqual(h.state.settings.get(6).notificationMatrix.comments, { email: true, push: true });
});

test("notification legacy defaults and manual matrix writes still work; stale cell writes are refused", async () => {
  const h = harness();
  assert.equal(h.matrix.notificationCellValue({}, "all", "comments", "email"), true);
  assert.equal(h.matrix.notificationCellValue({}, "direct", "comments", "email"), false);
  assert.equal(h.matrix.notificationCellValue({}, "direct", "mentions", "push"), true);
  assert.equal(h.matrix.notificationCellValue({}, "nothing", "assignments", "email"), false);
  assert.equal(h.matrix.notificationCellValue({ comments: { email: false } }, "all", "comments", "email"), false);
  await assert.rejects(h.matrix.updateNotificationMatrix(6, { category: "comments", channel: "email", value: true, expected: false }), /changed since the preview/);
  const updated = await h.matrix.updateNotificationMatrix(6, { matrix: { mentions: { email: true, push: false } } });
  assert.deepEqual(updated, { mentions: { email: true, push: false }, splitsNoImportant: ["project:15"], showImportantSplit: true });
});

test("still allowed: theme requires a real Apply request, supports Cancel and Undo, and checks the actual cookie", async () => {
  const h = harness();
  const card = await h.proposals.createSettingProposal(6, sessionId, themeScope, themeChange);
  assert.deepEqual([card.before, card.after, card.status], ["porcelain", "graphite", "pending"]);
  const apply = await h.route.POST(request({ id: card.id, action: "apply", scope: themeScope }));
  assert.equal(apply.status, 200);
  assert.equal(apply.cookies.get("theme").value, "graphite");
  const undo = await h.route.POST(request({ id: card.id, action: "undo", scope: themeScope }, { theme: "graphite" }));
  assert.equal(undo.status, 200);
  assert.equal(undo.cookies.get("theme").value, "porcelain");
  const cancelled = await h.proposals.createSettingProposal(6, sessionId, themeScope, themeChange);
  const cancel = await h.route.POST(request({ id: cancelled.id, action: "cancel", scope: themeScope }));
  assert.equal((await cancel.json()).proposal.status, "cancelled");
  await assert.rejects(h.proposals.actOnSettingProposal(6, cancelled.id, "apply", themeScope), /already been handled/);
  const stale = await h.proposals.createSettingProposal(6, sessionId, themeScope, themeChange);
  const refused = await h.route.POST(request({ id: stale.id, action: "apply", scope: themeScope }, { theme: "dia" }));
  assert.equal(refused.status, 409);
  assert.match((await refused.json()).error, /changed since the preview/);
});

test("now refused: cross-origin, unsigned, agent, disabled-flag and forged Apply requests", async () => {
  const h = harness();
  const card = await h.proposals.createSettingProposal(6, sessionId, themeScope, themeChange);
  const body = { id: card.id, action: "apply", scope: themeScope };
  const crossOrigin = await h.route.POST(request(body, { origin: "https://evil.example" }));
  assert.equal(crossOrigin.status, 403);
  h.state.session = null;
  assert.match((await (await h.route.POST(request(body))).json()).error, /Sign in as yourself/);
  h.state.session = { userId: 6, agentId: "agent", source: "legacy", teamScope: null };
  assert.match((await (await h.route.POST(request(body))).json()).error, /Sign in as yourself/);
  h.state.session = { userId: 6, source: "better-auth", teamScope: null };
  h.state.enabled = false;
  assert.match((await (await h.route.POST(request(body))).json()).error, /not available/);
  h.state.enabled = true;
  assert.equal((await h.route.POST(request({ ...body, userId: 42 }))).status, 400);
  const forged = await h.route.POST(request({ ...body, id: "00000000-0000-4000-8000-000000000099" }));
  assert.match((await forged.json()).error, /not yours/);
  assert.equal((await h.route.POST(request(body))).status, 200);
});

test("now refused: billing, deletion, keys and off-page mutation are not settings tool actions", async () => {
  const h = harness();
  await assert.rejects(h.proposals.createSettingProposal(6, sessionId, { section: "billing" }, themeChange), /Open the setting's page/);
  await assert.rejects(h.proposals.createSettingProposal(6, sessionId, themeScope, roleChange), /Open the setting's page/);
  const catalog = load("src/lib/ai/settings/catalog.ts", {});
  for (const kind of ["billing", "delete", "key", "apply", "undo"]) assert.equal(catalog.settingChangeSchema.safeParse({ kind, value: true }).success, false);
  const valid = await h.proposals.createSettingProposal(6, sessionId, themeScope, themeChange);
  assert.equal(valid.label, "Theme");
});

test("one card per reply even with parallel proposals; manual-only settings open their exact page", async () => {
  const h = harness();
  const events = [];
  const tools = h.tool.createSettingsTool({ user: { id: 6 }, actingAgentId: null, body: { session_id: sessionId, settings_context: themeScope }, sendStatus() {}, send: (...args) => events.push(args) });
  const [first, second] = await Promise.all([
    tools.hypertask_settings.execute({ action: "propose", change: themeChange }),
    tools.hypertask_settings.execute({ action: "propose", change: { kind: "theme", value: "dia" } }),
  ]);
  assert.equal(first.proposal.status, "pending");
  assert.deepEqual(second, { success: false, error: "Review the existing card first. Only one proposal is shown per reply." });
  const opened = await tools.hypertask_settings.execute({ action: "open", section: "billing" });
  assert.equal(opened.path, "/settings/billing");
  assert.deepEqual(events, [["settings", { path: "/settings/billing" }]]);
  assert.equal(h.state.writes, 0);
});

test("now refused: foreign chat sessions, owner/self roles and pending or agent members; still allowed: accepted human", async () => {
  const h = harness();
  await assert.rejects(h.proposals.createSettingProposal(6, memberSessionId, themeScope, themeChange), /personal AI chat/);
  await assert.rejects(h.proposals.createSettingProposal(6, sessionId, boardScope, { ...roleChange, targetUserId: 6 }), /own role/);
  h.state.members[0].status = "Pending";
  await assert.rejects(h.proposals.createSettingProposal(6, sessionId, boardScope, roleChange), /Accepted human/);
  h.state.members[0].status = "Accepted";
  h.state.members[0].agentId = "agent-id";
  await assert.rejects(h.proposals.createSettingProposal(6, sessionId, boardScope, roleChange), /Accepted human/);
  h.state.members[0].agentId = null;
  const allowed = await h.proposals.createSettingProposal(6, sessionId, boardScope, roleChange);
  assert.equal(allowed.label, "Anna — role on Work");
});

test("parallel Apply clicks mutate once and the saved card reloads as applied; Cancel works away from Settings", async () => {
  const h = harness();
  const card = await h.proposals.createSettingProposal(6, sessionId, boardScope, roleChange);
  const results = await Promise.allSettled([
    h.proposals.actOnSettingProposal(6, card.id, "apply", boardScope),
    h.proposals.actOnSettingProposal(6, card.id, "apply", boardScope),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(h.state.members[0].role, "Admin");
  assert.equal(h.state.writes, 1);
  const reloaded = await h.route.GET(new NextRequest(`https://app.hypertask.ai/api/ai/settings?id=${card.id}`));
  assert.equal(reloaded.status, 200);
  assert.equal((await reloaded.json()).proposal.status, "applied");
  const pending = await h.proposals.createSettingProposal(6, sessionId, themeScope, themeChange);
  const cancelled = await h.route.POST(request({ id: pending.id, action: "cancel" }));
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).proposal.status, "cancelled");
});

test("Material theme's own availability flag is respected on proposal and Undo", async () => {
  const h = harness();
  h.state.rounded = false;
  await assert.rejects(h.proposals.createSettingProposal(6, sessionId, themeScope, { kind: "theme", value: "rounded" }), /not available/);
  h.state.rounded = true;
  const card = await h.proposals.createSettingProposal(6, sessionId, { ...themeScope, theme: "rounded" }, themeChange);
  const applied = await h.proposals.actOnSettingProposal(6, card.id, "apply", { ...themeScope, theme: "rounded" });
  assert.equal(applied.theme, "graphite");
  h.state.rounded = false;
  await assert.rejects(h.proposals.actOnSettingProposal(6, card.id, "undo", { ...themeScope, theme: "graphite" }), /not available/);
});

test("Settings chat cannot bypass Apply with legacy mutation tools; ordinary chat keeps those tools", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../src/lib/ai/tools/index.ts"), "utf8");
  const mocks = {};
  for (const match of source.matchAll(/import \{ (create\w+) \} from "(\.\/[^\"]+)";/g)) {
    mocks[match[2]] = { [match[1]]: () => new Proxy({}, { get: (_target, key) => ({ name: key }) }) };
  }
  mocks["./context"] = { createToolContext: (user, body) => ({ user, body }) };
  mocks["./settings"] = { createSettingsTool: () => ({ hypertask_settings: { name: "preview-only" } }) };
  mocks["@/lib/ai/tools/execution"] = { trackToolSetExecutions: (tools) => tools };
  const { buildTools } = load("src/lib/ai/tools/index.ts", mocks);
  const args = [{ id: 6 }, { settings_context: themeScope }, () => {}, () => {}, null, undefined, undefined, false, undefined, false, null];
  const settingsTools = buildTools(...args, true);
  assert.deepEqual(Object.keys(settingsTools), ["hypertask_settings"]);
  assert.equal(settingsTools.hypertask_settings.name, "preview-only");
  const ordinaryTools = buildTools(...args, false);
  assert.equal(ordinaryTools.hypertask_update_profile.name, "hypertask_update_profile");
  assert.equal(ordinaryTools.hypertask_project_admin.name, "hypertask_project_admin");
});

test("the streamed and persisted reply contains the server's review-card marker, without relying on model HTML", async () => {
  const events = [], saved = [];
  const cardId = "00000000-0000-4000-8000-000000000002";
  const mocks = {
    "@/lib/ai/prompts/registry": { renderPrompt: () => "" },
    "@/lib/flags": { isFeatureEnabled: async () => true },
    "@/lib/flags/keys": {},
    "@/lib/prisma": { default: {} },
    "@/app/api/ai/_lib/currentTaskContext": { loadCurrentTaskContext: async () => "" },
    "@/app/api/ai/chat/stream/streamLease": {
      acquireAiChatCompletionFence: async () => "fence",
      keepAiChatCompletionFenceAlive: () => async () => {},
      finishAiChatCompletionFence: async () => {},
    },
    "@/app/api/ai/_lib/heartbeatExecution": {},
    "@/app/api/ai/chat/stream/persistAssistantMessage": { persistAssistantMessage: async (input) => { saved.push(input.content); return true; } },
    "@/utils/controllers/comments/linkifyTicketRefs": { linkifyTicketRefs: async (html) => html },
    "@/lib/ai/chatStream/prompt": { AGENT_SYSTEM_PROMPT: "" },
    "@/app/api/ai/_lib/modelProvider": { configureAiModelUsage() {}, aiPromptCachingEnabled: async () => false },
    "@/lib/ai/chatStream/content": { createUserContent: () => "request" },
    "@/lib/ai/chatStream/title": {},
    "@/lib/ai/tools": { buildTools: (_user, _body, _send, record) => ({ propose: () => record({ name: "hypertask_settings", result: { proposal: { id: cardId } } }) }) },
    "./modelReply": { generateModelReply: async (_state, { tools }) => { tools.propose(); return { chunks: ["<p>Review it</p>"] }; } },
    "./chatNames": { nameChatFromFirstMessage: async () => undefined },
  };
  const { runModelTurn } = load("src/lib/ai/chatStream/modelTurn.ts", mocks);
  const body = { message: "Go dark", session_id: sessionId, assistant_message_id: cardId, settings_context: themeScope };
  const state = {
    body, dbUser: { id: 6 }, firstTurn: false, requestMessage: body.message,
    selected: { model: {} }, streamId: "stream", streamLease: { redis: {} },
    providerAbort: new AbortController(), send: (...event) => events.push(event), finish: (...event) => events.push(["finish", ...event]),
  };
  await runModelTurn(state, body, { systemPromptAddition: "", cleanedText: body.message });
  const marker = `<p><a href="/settings/ai-change/${cardId}">Review setting change</a></p>`;
  assert.deepEqual(saved, [`<p>Review it</p>${marker}`]);
  assert.deepEqual(events[0], ["content", { content: marker }]);
  assert.deepEqual(events.at(-1), ["finish", "complete", { user_message_persisted: undefined, assistant_persisted: true }]);
});

test("page scope and saved chat markers survive reload without treating arbitrary links as setting cards", () => {
  const catalog = load("src/lib/ai/settings/catalog.ts", {});
  assert.deepEqual(catalog.settingsScopeFromPath("/settings/appearance", 15, "porcelain"), themeScope);
  assert.deepEqual(catalog.settingsScopeFromPath("/settings/board-members", 15), boardScope);
  assert.equal(catalog.settingsScopeFromPath("/project"), undefined);
  const id = "00000000-0000-4000-8000-000000000002";
  assert.deepEqual(catalog.extractSettingCards(`<p>Review this</p><a href="/settings/ai-change/${id}">Review setting change</a><a href="/settings/ai-change/${id}">Review setting change</a>`), { html: "<p>Review this</p>", ids: [id] });
  assert.deepEqual(catalog.extractSettingCards('<a href="https://evil.example/settings/ai-change/00000000-0000-4000-8000-000000000002">wrong</a>'), { html: '<a href="https://evil.example/settings/ai-change/00000000-0000-4000-8000-000000000002">wrong</a>', ids: [] });
});

test("the real confirmation card applies and undoes through the authenticated API, refreshes Settings and hides when disabled", async () => {
  const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");
  const h = harness();
  let proposal = await h.proposals.createSettingProposal(6, sessionId, boardScope, roleChange);
  let enabled = true;
  let refreshes = 0;
  let changed = 0;
  const requests = [];
  const invalidations = [];
  const projectAtom = {}, userAtom = {};
  const queryClient = {
    setQueryData: (_key, card) => { proposal = card; },
    invalidateQueries: async ({ queryKey }) => { invalidations.push(queryKey); },
  };
  const loadUi = loader({
    "next/navigation": { usePathname: () => "/settings/board-members", useRouter: () => ({ refresh: () => { refreshes++; }, push() {} }) },
    "@tanstack/react-query": { useQuery: () => ({ data: proposal }), useQueryClient: () => queryClient },
    "@/store": { currentProjectAtom: projectAtom, currentUserAtom: userAtom },
    "@/lib/state": { useRecoilValue: (atom) => atom === projectAtom ? { id: 15 } : { id: 6 } },
    "@/hooks/useFlag": { useFlag: () => enabled },
    "@/lib/configs/general.config": { MOBILE_TARGET: "min-h-[44px] min-w-[44px]" },
    "@/hooks/General/useGetUserPreferences": { USER_PREFERENCES_QUERY_KEY: ["user-preferences"] },
    "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
  });
  const { AiSettingChangeCard } = loadUi("src/components/AI_CHAT/AiSettingChangeCard.tsx");
  const ui = mount();
  const originalFetch = global.fetch;
  const originalEvent = global.Event;
  global.Event = window.Event;
  window.addEventListener("hypertask:settings-changed", () => { changed++; });
  global.fetch = async (url, options) => {
    assert.equal(url, "/api/ai/settings");
    const body = JSON.parse(options.body);
    requests.push(body);
    return h.route.POST(request(body));
  };
  const button = (label) => [...ui.container.querySelectorAll("button")].find((entry) => entry.textContent === label);
  try {
    ui.render(React.createElement(AiSettingChangeCard, { id: proposal.id }));
    assert.match(ui.container.textContent, /From Member to Admin/);
    assert.match(ui.container.textContent, /Access change/);
    assert.deepEqual([...ui.container.querySelectorAll("button")].map((entry) => entry.textContent), ["Open setting", "Cancel", "Apply"]);
    assert.equal(h.state.members[0].role, "Member");
    await React.act(async () => { button("Apply").click(); });
    assert.equal(h.state.members[0].role, "Admin");
    assert.deepEqual(requests[0], { id: proposal.id, action: "apply", scope: boardScope });
    assert.equal(ui.container.querySelector('[role="status"]').textContent, "Done");
    assert.equal(button("Apply"), undefined);
    await React.act(async () => { button("Undo").click(); });
    assert.equal(h.state.members[0].role, "Member");
    assert.equal(ui.container.querySelector('[role="status"]').textContent, "Undone");
    assert.deepEqual([changed, refreshes], [2, 2]);
    assert.deepEqual(invalidations, [["assign", 15], ["projectsAll"], ["user-preferences"], ["assign", 15], ["projectsAll"], ["user-preferences"]]);
    proposal = await h.proposals.createSettingProposal(6, sessionId, boardScope, roleChange);
    ui.render(React.createElement(AiSettingChangeCard, { id: proposal.id }));
    await React.act(async () => { button("Cancel").click(); });
    assert.equal(ui.container.querySelector('[role="status"]').textContent, "Cancelled — nothing changed");
    assert.deepEqual([h.state.members[0].role, h.state.writes, changed], ["Member", 2, 2]);
    enabled = false;
    ui.render(React.createElement(AiSettingChangeCard, { id: proposal.id }));
    assert.equal(ui.container.textContent, "");
  } finally {
    global.fetch = originalFetch;
    global.Event = originalEvent;
    ui.close();
  }
});

test("Settings sends its current page, theme and selected board instead of an unrelated chat board scope", async () => {
  const originalFetch = global.fetch;
  const originalLog = console.log;
  const payloads = [];
  const { createAiChatSend } = load("src/hooks/MultiPages/AIChat/aiChatSend.ts", {
    "nookies": { parseCookies: () => ({ theme: "dark" }) },
    "react-hot-toast": { default: { error: (message) => assert.fail(message) } },
    "@/lib/agents/chatViewerState": { sidebarChatHeaders: () => ({}) },
    "@/lib/mcp/bearerAuth": { mcpAuthorizationHeaders: () => ({}) },
    "@/lib/demo/guestBoardBuild": { isGuestBoardBuild: () => false },
    "@/lib/aiModelOptions": { chatModelRequestFields: () => ({}) },
    "./aiChatStream": { consumeAiChatStream: async () => {} },
  });
  global.fetch = async (_url, options) => { payloads.push(JSON.parse(options.body)); return new Response("reply"); };
  console.log = () => {};
  try {
    for (const [surface, pathname, agentId] of [
      ["settings", "/settings/appearance", null],
      ["settings", "/settings/board-members", null],
      ["board", "/project-15", null],
      ["settings", "/settings/appearance", "agent-id"],
    ]) {
      const sender = createAiChatSend({
        surface, pathname, currentProject: { id: 15 }, scopedProjectId: 99, boardScopeIsExplicit: true,
        currentUser: { id: 6 }, contextList: [], fileUpload: { fileItems: [], clearFiles() {} },
        editor: { getText: () => "", commands: { clearContent() {} } },
        sendInFlightRef: { current: false }, waitForChatSession: async () => ({ id: sessionId, agentId, messages: [] }),
        processAttachments: async () => [], setIsTyping() {}, addMessageToSessionQuery() {},
        streamingSessionRef: { current: null }, streamingAssistantMessageRef: { current: null }, streamingRequestRef: { current: null },
        setCurrentStreamingSession() {}, chatRoute: "/api/ai/chat/stream", setAgentStatus() {},
        drainQueuedMessage() {}, handleSendMessageRef: { current: null },
        updateLastMessageInSessionCache: () => assert.fail("The Settings chat request failed"),
        appendMessageToSessionCache: () => assert.fail("The Settings chat request failed"),
      });
      assert.equal(await sender.handleSendMessage("Change a setting"), true);
    }
    assert.deepEqual(payloads.map((payload) => payload.settings_context), [
      { section: "appearance", theme: "graphite" },
      { section: "board-members", projectId: 15, theme: "graphite" },
      undefined,
      undefined,
    ]);
    assert.deepEqual(payloads.map((payload) => payload.default_context.project_id), [15, 15, 99, 15]);
  } finally {
    global.fetch = originalFetch;
    console.log = originalLog;
  }
});
