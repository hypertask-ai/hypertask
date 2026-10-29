const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const flag = "htpr-8088-manual-chat";
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const policy = (() => {
  const file = "src/lib/aiChat/autoOpenPreferences.ts";
  const mod = { exports: {} };
  const js = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", js)(require, mod, mod.exports);
  return mod.exports;
})();
const defaults = policy.AI_CHAT_AUTO_OPEN_DEFAULTS;
const off = Object.fromEntries(policy.AI_CHAT_AUTO_OPEN_KEYS.map((key) => [key, false]));
const settings = (extra = {}) => ({ ...defaults, ...extra });

function load(file, mocks) {
  const mod = { exports: {} };
  const js = ts.transpileModule(read(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function("require", "module", "exports", "window", js)((name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    assert.ok(name.startsWith("react"), `Unexpected dependency ${name} in ${file}`);
    return require(name);
  }, mod, mod.exports, mocks.window);
  return mod.exports;
}

function hooks() {
  const slots = [], effects = [];
  let cursor = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useMemo(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: fn() };
      return slots[i].value;
    },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, deps)) {
        slots[i] = { deps };
        effects.push(fn);
      }
    },
  };
  return { react, render(fn) { cursor = 0; const value = fn(); effects.splice(0).forEach((effect) => effect()); return value; } };
}

function stateHarness(initial) {
  const values = { ...initial }, setters = new Map();
  let dirty = false;
  const set = (key) => {
    if (!setters.has(key)) setters.set(key, (update) => {
      const next = typeof update === "function" ? update(values[key]) : update;
      if (!Object.is(next, values[key])) { values[key] = next; dirty = true; }
    });
    return setters.get(key);
  };
  const state = { useRecoilValue: (key) => values[key], useSetRecoilState: set, useRecoilState: (key) => [values[key], set(key)] };
  return { values, state, set, settle(fn) {
    let result;
    for (let i = 0; i < 12; i++) { dirty = false; result = fn(); if (!dirty) return result; }
    assert.fail("hook did not settle");
  } };
}

const atomNames = ["currentUserAtom", "aiChatAutoOpenPreferencesAtom", "aiChatAutoOpenPageAtom", "aiChatNewTicketPathAtom", "aiChatAutoOpenSuppressedAtom", "aiChatExplicitOpenAtAtom", "aiChatEmbeddedTicketPathAtom", "showAIChatInterfaceAtom", "aiChatPinnedAtom"];
const atoms = Object.fromEntries(atomNames.map((key) => [key, key]));

function chat(values, options = {}) {
  const h = hooks();
  const s = stateHarness({
    currentUserAtom: { id: 7 },
    aiChatNewTicketPathAtom: "/detail/project-15/1",
    aiChatAutoOpenSuppressedAtom: false,
    showAIChatInterfaceAtom: false,
    aiChatAutoOpenPageAtom: null,
    ...options.state,
  });
  let pathname = "/detail/project-15/1", query = "", mobile = false;
  const { useAiChatAutoOpen } = load("src/hooks/General/useAiChatAutoOpen.ts", {
    react: h.react, "@/lib/state": s.state, "@/store": atoms,
    "@/hooks/useFlag": { useFlag: (key) => key === flag ? options.manual !== false : true },
    "@/lib/flags/definitions/htpr-8052-fullscreen-chat-return": { HTPR_8052_FULLSCREEN_CHAT_RETURN_FLAG: "htpr-8052-fullscreen-chat-return" },
    "@/lib/flags/definitions/htpr-8038-chat-opener-ready": { HTPR_8038_CHAT_OPENER_READY_FLAG: "htpr-8038-chat-opener-ready" },
    "@/lib/flags/definitions/htpr-8088-manual-chat": { HTPR_8088_MANUAL_CHAT_FLAG: flag },
    "@/lib/aiChat/autoOpenPreferences": policy,
    "next/navigation": { usePathname: () => pathname, useSearchParams: () => new URLSearchParams(query) },
    "./useAiChatOpenPreferences": {
      useAiChatOpenPreferences: () => ({ enabled: true, ready: true, flagReady: true, values }),
      useSyncAiChatOpenPreferences() {},
    },
  });
  const render = () => s.settle(() => h.render(() => useAiChatAutoOpen(mobile)));
  return { ...s, render, go(url, phone = false) { [pathname, query = ""] = url.split("?"); mobile = phone; render(); },
    openByHand() { s.set("aiChatAutoOpenSuppressedAtom")(true); s.set("showAIChatInterfaceAtom")(true); render(); } };
}

test("manual chat: opening a ticket never opens the chat, even with every automatic switch on", () => {
  const h = chat(settings({ aiChatOpenTickets: true, aiChatOpenBoards: true, aiChatOpenNewTickets: true }));
  for (const url of ["/detail/project-15/2", "/detail/project-15/3", "/project?id=15", "/my-tasks", "/inbox"]) {
    h.go(url);
    assert.equal(h.values.showAIChatInterfaceAtom, false, `${url} must not open the chat`);
  }
});

test("manual chat: a pinned chat no longer opens itself on a ticket or board", () => {
  const h = chat(settings({ aiChatOpenTickets: true }), { state: { aiChatPinnedAtom: true } });
  h.go("/detail/project-15/2");
  assert.equal(h.values.showAIChatInterfaceAtom, false);
  h.go("/project?id=15");
  assert.equal(h.values.showAIChatInterfaceAtom, false);
});

test("manual chat: the new-ticket exception opens the chat while its switch is on", () => {
  const h = chat(settings({ aiChatOpenNewTickets: true }));
  h.go("/detail/project-15/1");
  assert.equal(h.values.showAIChatInterfaceAtom, true);
});

test("manual chat: switching the new-ticket exception off keeps the chat closed after a ticket is created", () => {
  const h = chat(settings({ aiChatOpenNewTickets: false }));
  h.go("/detail/project-15/1");
  assert.equal(h.values.showAIChatInterfaceAtom, false);
});

test("manual chat: moving between tickets and boards leaves an open chat open", () => {
  const h = chat(off);
  h.go("/detail/project-15/2");
  h.openByHand();
  for (const url of ["/detail/project-15/3", "/project?id=15", "/my-tasks", "/detail/project-15/4"]) {
    h.go(url);
    assert.equal(h.values.showAIChatInterfaceAtom, true, `${url} must not close the chat`);
  }
});

test("manual chat: a phone keeps an open chat too", () => {
  const h = chat(off);
  h.go("/detail/project-15/2", true);
  h.openByHand();
  h.go("/detail/project-15/3", true);
  assert.equal(h.values.showAIChatInterfaceAtom, true);
  h.go("/project?id=15", true);
  assert.equal(h.values.showAIChatInterfaceAtom, true);
});

test("manual chat: no space is reserved for a chat the user did not open", () => {
  const h = chat(settings({ aiChatOpenTickets: true }));
  h.go("/detail/project-15/2");
  assert.equal(h.render().reserve, false);
});

test("manual flag off keeps the previous automatic opening", () => {
  const h = chat(settings({ aiChatOpenTickets: true }), { manual: false });
  h.go("/detail/project-15/2");
  assert.equal(h.values.showAIChatInterfaceAtom, true);
  assert.equal(h.render().reserve, true);
});

const styleConfig = { AI_CHAT_SIDEBAR_MIN_PX: 320, AI_CHAT_SIDEBAR_DEFAULT_PX: 380 };
function boot(options) {
  const { buildTicketSidebarBootScript } = load("src/lib/ticketSidebarBoot.ts", {
    "@/lib/configs/style.config": styleConfig,
  });
  return buildTicketSidebarBootScript({ keepClosed: false, overlayTicket: false, ...options });
}
function runBoot(script, { session, storage }) {
  const saved = { ...storage };
  const document = { documentElement: { style: { setProperty() {} }, setAttribute(name, value) { this[name] = value; } } };
  const window = { innerWidth: 1440 };
  new Function("window", "document", "localStorage", "sessionStorage", "location", script)(
    window, document,
    { getItem: (key) => (key === "recoil-persist" ? JSON.stringify(saved) : null) },
    { getItem: (key) => (session[key] ?? null) },
    { pathname: "/detail/project-15/2", search: "" },
  );
  return document.documentElement["data-ticket-sidebar"];
}

test("manual chat: the first paint stays closed when the tab has the chat closed", () => {
  const state = runBoot(boot({ manualChat: true }), { session: {}, storage: { openAiChatByDefault: true, aiChatPinned: true } });
  assert.equal(state, "closed");
});

test("manual chat: a reload of a tab where the chat was open keeps it open", () => {
  const state = runBoot(boot({ manualChat: true }), { session: { "ht:aiChatOpen": "1" }, storage: { aiChatAutoOpenSuppressed: true } });
  assert.notEqual(state, "closed");
});

test("manual chat off keeps the old first-paint behaviour", () => {
  const state = runBoot(boot({ autoOpenSwitches: true, userId: 7 }), { session: {}, storage: { openAiChatByDefault: true } });
  assert.notEqual(state, "closed");
});

test("phone page changes no longer reset the chat in manual mode", () => {
  const source = read("src/hooks/General/useUIStateManager.ts");
  assert.match(source, /if \(isMbl && !manualChat\) resetAIChat\(\);/);
});

test("navigation never starts a chat session in manual mode", () => {
  const source = read("src/hooks/MultiPages/AIChat/useAiChatSessions.ts");
  assert.match(source, /if \(!shouldLoadChatHistory \|\| manualChat\) return;/);
});

test("the manual chat keeps one conversation across tickets", () => {
  const state = read("src/hooks/MultiPages/AIChat/useAiChatState.ts");
  assert.match(state, /useSessionAndChatHistory\(manualChat \? undefined : taskId, shouldLoadChatHistory, isDetailPage, manualChat \|\| parallelChatsEnabled, manualChat\)/);
});

test("the settings keep the new-ticket switch and hide the automatic ones for manual chat", () => {
  const source = read("src/components/Modals/Settings/TaskPageSection.tsx");
  assert.match(source, /Open AI chat on newly created tickets/);
  assert.match(source, /!manualChat && \(\s*<SettingsToggle\s+label="Open AI chat when I open a ticket"/);
  assert.match(source, /!manualChat && \(\s*<SettingsToggle\s+label="Open AI chat on boards"/);
});

test("the flag is a plain improvement that defaults to everyone", () => {
  const definition = read("src/lib/flags/definitions/htpr-8088-manual-chat.ts");
  assert.match(definition, /kind: "improvement"/);
  assert.match(definition, /defaultMode: "EVERYONE"/);
  assert.match(definition, /key: HTPR_8088_MANUAL_CHAT_FLAG/);
});
