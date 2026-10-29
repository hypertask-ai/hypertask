const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { loadModule, root } = require("./helpers/loadModule.cjs");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const flag = "htpr-8088-manual-chat";
const { buildTicketSidebarBootScript } = loadModule("src/lib/ticketSidebarBoot.ts");

function boot(options = {}) {
  return buildTicketSidebarBootScript({ keepClosed: false, overlayTicket: false, ...options });
}

function firstPaint(script, { session = {}, storage = {} }) {
  const document = { documentElement: { style: { setProperty() {} }, setAttribute(name, value) { this[name] = value; } } };
  new Function("window", "document", "localStorage", "sessionStorage", "location", script)(
    { innerWidth: 1440 },
    document,
    { getItem: (key) => (key === "recoil-persist" ? JSON.stringify(storage) : null) },
    { getItem: (key) => (Object.hasOwn(session, key) ? session[key] : null) },
    { pathname: "/detail/project-15/2", search: "" },
  );
  return document.documentElement["data-ticket-sidebar"];
}

test("manual chat: the first paint of a ticket stays closed when this tab has the chat closed", () => {
  const state = firstPaint(boot({ manualChat: true }), { storage: { openAiChatByDefault: true, aiChatPinned: true } });
  assert.equal(state, "closed");
});

test("manual chat: a reload of a tab where the chat was open keeps it open", () => {
  const state = firstPaint(boot({ manualChat: true }), { session: { "ht:aiChatOpen": "1" }, storage: { aiChatAutoOpenSuppressed: true } });
  assert.notEqual(state, "closed");
});

test("manual chat off keeps the old first paint", () => {
  const state = firstPaint(boot({ autoOpenSwitches: true, userId: 7 }), { storage: { openAiChatByDefault: true } });
  assert.notEqual(state, "closed");
});

test("phone page changes no longer reset the chat", () => {
  const source = read("src/hooks/General/useUIStateManager.ts");
  assert.match(source, /if \(isMbl && !manualChat\) resetAIChat\(\);/);
});

test("navigation never starts a chat session", () => {
  const source = read("src/hooks/MultiPages/AIChat/useAiChatSessions.ts");
  assert.match(source, /if \(!shouldLoadChatHistory \|\| manualChat\) return;/);
});

test("one conversation follows the user instead of the ticket", () => {
  const history = read("src/hooks/MultiPages/AIChat/useSessionAndChatHistory.ts");
  assert.match(history, /const selectionScope = manualChat \? `manual:\$\{teamKey \?\? "none"\}`/);
  assert.match(history, /const taskScopedHistory = isTaskScoped && !manualChat;/);
  const state = read("src/hooks/MultiPages/AIChat/useAiChatState.ts");
  assert.match(state, /if \(manualChat\) historyTaskId = undefined;/);
  assert.match(state, /useSessionAndChatHistory\(historyTaskId, shouldLoadChatHistory, isDetailPage, manualDockedChat \|\| parallelChatsEnabled, manualDockedChat, modelTeamId\)/);
});

test("the new-ticket greeting lands in the conversation that is open, not a new thread", () => {
  const history = read("src/hooks/MultiPages/AIChat/useSessionAndChatHistory.ts");
  assert.match(history, /composeIntro && currentSession &&\s*\(manualChat \|\| \(isTaskScoped && taskId === composeIntro\.taskId/);
});

test("the settings keep the new-ticket switch and hide the automatic ones", () => {
  const source = read("src/components/Modals/Settings/TaskPageSection.tsx");
  assert.match(source, /label="Open AI chat on newly created tickets"/);
  assert.match(source, /!manualChat && \(\s*<SettingsToggle\s+label="Open AI chat when I open a ticket"/);
  assert.match(source, /!manualChat && \(\s*<SettingsToggle\s+label="Open AI chat on boards"/);
});

test("the flag is an improvement that defaults to everyone", () => {
  const definition = read(`src/lib/flags/definitions/${flag}.ts`);
  assert.match(definition, /kind: "improvement"/);
  assert.match(definition, /defaultMode: "EVERYONE"/);
  assert.match(definition, /key: HTPR_8088_MANUAL_CHAT_FLAG/);
});
