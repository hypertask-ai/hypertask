process.env.FEATURE_FLAG_TYPESCRIPT_PATH = require.resolve("typescript");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { load } = require("./task-route-loader.cjs");

const root = path.resolve(__dirname, "..");
const WAITS = "htpr-9245-chat-waits-for-saved-switches";
const allOff = { aiChatOpenNewTickets: false, aiChatOpenTickets: false, aiChatOpenBoards: false };
const defaults = { aiChatOpenNewTickets: true, aiChatOpenTickets: false, aiChatOpenBoards: false };
const atoms = Object.fromEntries([
  "aiChatAutoOpenPreferencesAtom", "aiChatAutoOpenPageAtom", "aiChatAutoOpenSuppressedAtom",
  "aiChatExplicitOpenAtAtom", "aiChatEmbeddedTicketPathAtom", "aiChatNewTicketPathAtom",
  "aiChatPinnedAtom", "currentProjectAtom", "currentUserAtom", "keepAiChatClosedAtom",
  "showAIChatInterfaceAtom",
].map((key) => [key, key]));

function hooks() {
  const slots = [];
  const effects = [];
  let cursor = 0;
  const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const react = {
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useMemo(fn, deps) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { deps, value: fn() };
      return slots[index].value;
    },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].deps, deps)) {
        slots[index] = { deps };
        effects.push(fn);
      }
    },
  };
  return { react, render(fn) { cursor = 0; const value = fn(); effects.splice(0).forEach((effect) => effect()); return value; } };
}

function stateHarness(initial, opens) {
  const values = { ...initial };
  const setters = new Map();
  let dirty = false;
  const set = (key) => {
    if (!setters.has(key)) setters.set(key, (update) => {
      const next = typeof update === "function" ? update(values[key]) : update;
      if (Object.is(next, values[key])) return;
      if (key === "showAIChatInterfaceAtom" && next === true) opens.push(true);
      values[key] = next;
      dirty = true;
    });
    return setters.get(key);
  };
  return {
    values,
    state: { useRecoilValue: (key) => values[key], useSetRecoilState: set, useRecoilState: (key) => [values[key], set(key)] },
    settle(fn) {
      let result;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        dirty = false;
        result = fn();
        if (!dirty) return result;
      }
      assert.fail("hook did not settle");
    },
  };
}

function harness({ switches = {}, saved = {}, waits = true, user = { id: 7 }, path: initialPath = "/detail/project-15/1", fetchFailed = false } = {}) {
  const opens = [];
  const h = hooks();
  const s = stateHarness({
    currentUserAtom: user,
    currentProjectAtom: { id: 15 },
    aiChatNewTicketPathAtom: "/detail/project-15/1",
    aiChatAutoOpenPreferencesAtom: saved,
    aiChatAutoOpenPageAtom: null,
    aiChatAutoOpenSuppressedAtom: false,
    aiChatExplicitOpenAtAtom: null,
    aiChatEmbeddedTicketPathAtom: null,
    aiChatPinnedAtom: false,
    keepAiChatClosedAtom: false,
    showAIChatInterfaceAtom: false,
  }, opens);
  const route = { path: initialPath };
  const flags = {
    "htpr-7650-ai-chat-open-switches": true,
    "htpr-8038-chat-opener-ready": true,
    "htpr-8052-fullscreen-chat-return": true,
    "htpr-7530-keep-ai-chat-closed": true,
    "htpr-7983-free-mode-signup": true,
    [WAITS]: waits,
  };
  const server = { data: undefined, dataUpdatedAt: 0, isError: fetchFailed };
  const api = load("src/hooks/General/useAiChatAutoOpen.ts", {
    react: h.react,
    "next/navigation": {
      usePathname: () => route.path.split("?")[0],
      useSearchParams: () => new URLSearchParams(route.path.split("?")[1] ?? ""),
    },
    "@/lib/state": s.state,
    "@/store": atoms,
    "@/hooks/useFlag": { useFlag: (key) => flags[key] === true, useFlagReady: () => true },
    "@/lib/flags/keys": {
      HTPR_7530_KEEP_AI_CHAT_CLOSED_FLAG: "htpr-7530-keep-ai-chat-closed",
      HTPR_7783_REMEMBER_CHAT_FLAG: "htpr-7783-remember-chat",
    },
    "@/lib/aiChat/chatNavigationState": {
      chatNavigationKey: () => null,
      readChatNavigationState: () => ({}),
      writeChatNavigationState: () => {},
    },
    "@tanstack/react-query": { useQueryClient: () => ({ setQueryData() {}, invalidateQueries() {} }) },
    axios: { __esModule: true, default: { post: () => Promise.resolve() } },
    "./useHydrated": { useHydrated: () => true },
    "./useGetUserPreferences": {
      useGetUserPreferences: () => ({
        data: server.data,
        dataUpdatedAt: server.dataUpdatedAt,
        isSuccess: server.dataUpdatedAt > 0 && !server.isError,
        isError: server.isError,
      }),
    },
  });
  const render = () => s.settle(() => h.render(() => api.useAiChatAutoOpen(false)));
  return {
    opens,
    render,
    reserve: () => render().reserve,
    open: () => s.values.showAIChatInterfaceAtom,
    savedCopy: () => s.values.aiChatAutoOpenPreferencesAtom,
    handOpen() { s.state.useSetRecoilState("showAIChatInterfaceAtom")(true); render(); },
    navigate(next) { route.path = next; render(); },
    receive(data) { server.data = data; server.isError = false; server.dataUpdatedAt += 1; render(); },
  };
}

const providerRestore = (() => {
  const filename = path.join(root, "src/components/ProviderGlobal/GloablProviders.tsx");
  const source = fs.readFileSync(filename, "utf8");
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const effects = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.getText(ast).includes("readChatOpenForSession")) {
      effects.push(node.getText(ast));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(effects.length, 1);
  return new Function("scope", `const { useEffect, aiChatOpenSwitchesEnabled, manualChat, chatAutoOpenReady, hasAttemptedChatRestoreRef,
      currentUser, pathname, NO_CHAT_RESTORE_ROUTES, keepChatClosed, aiChatAutoOpenSuppressed,
      readChatOpenForSession, setChatRuntimeMounted, setShowAiChatInterface, setAiChatExplicitOpenAt } = scope;
    ${effects[0]};`);
})();

function sessionRestoreHarness({ saved = {}, waits = true } = {}) {
  const opens = [];
  const h = hooks();
  const s = stateHarness({
    currentUserAtom: { id: 7 },
    currentProjectAtom: { id: 15 },
    aiChatAutoOpenPreferencesAtom: saved,
    keepAiChatClosedAtom: false,
    showAIChatInterfaceAtom: false,
  }, opens);
  const flags = { "htpr-7650-ai-chat-open-switches": true, "htpr-7530-keep-ai-chat-closed": true, [WAITS]: waits };
  const server = { data: undefined, dataUpdatedAt: 0, isError: false };
  const mocks = {
    react: h.react,
    "@/lib/state": s.state,
    "@/store": atoms,
    "@/hooks/useFlag": { useFlag: (key) => flags[key] === true, useFlagReady: () => true },
    "@/lib/flags/keys": { HTPR_7530_KEEP_AI_CHAT_CLOSED_FLAG: "htpr-7530-keep-ai-chat-closed" },
    "@tanstack/react-query": { useQueryClient: () => ({ setQueryData() {}, invalidateQueries() {} }) },
    axios: { __esModule: true, default: { post: () => Promise.resolve() } },
    "./useHydrated": { useHydrated: () => true },
    "./useGetUserPreferences": {
      useGetUserPreferences: () => ({
        data: server.data,
        dataUpdatedAt: server.dataUpdatedAt,
        isSuccess: server.dataUpdatedAt > 0,
        isError: server.isError,
      }),
    },
  };
  const preferences = load("src/hooks/General/useAiChatOpenPreferences.ts", mocks);
  const closed = load("src/hooks/General/useKeepChatClosed.ts", mocks);
  const attempted = { current: false };
  const previousWindow = global.window;
  global.window = { innerWidth: 1200, localStorage: { getItem: () => "{}", setItem() {} } };
  const render = () => s.settle(() => h.render(() => {
    preferences.useSyncAiChatOpenPreferences();
    const decision = closed.useKeepChatClosed();
    providerRestore({
      useEffect: h.react.useEffect,
      aiChatOpenSwitchesEnabled: true,
      manualChat: true,
      chatAutoOpenReady: decision.ready,
      keepChatClosed: decision.keepChatClosed,
      hasAttemptedChatRestoreRef: attempted,
      currentUser: s.values.currentUserAtom,
      pathname: "/detail/project-15/2",
      NO_CHAT_RESTORE_ROUTES: ["/login", "/signup", "/onboarding"],
      aiChatAutoOpenSuppressed: false,
      readChatOpenForSession: () => true,
      setChatRuntimeMounted() {},
      setShowAiChatInterface: (open) => { if (open) opens.push(true); s.values.showAIChatInterfaceAtom = open; },
      setAiChatExplicitOpenAt() {},
    });
    return decision;
  }));
  return {
    opens,
    render,
    attempted: () => attempted.current,
    restore() { if (previousWindow === undefined) delete global.window; else global.window = previousWindow; },
    receive(data) { server.data = data; server.dataUpdatedAt += 1; render(); },
  };
}

test("a fresh browser stays closed when the account switches every auto-open off", () => {
  const h = harness();
  h.render();
  assert.deepEqual(h.opens, []);
  assert.equal(h.reserve(), false);
  h.receive(allOff);
  h.navigate("/detail/project-15/2");
  h.navigate("/project?id=15");
  h.navigate("/detail/project-15/1");
  assert.deepEqual(h.opens, []);
  assert.equal(h.open(), false);
  const reloaded = harness({ saved: { 7: allOff } });
  reloaded.render();
  reloaded.navigate("/detail/project-15/3");
  reloaded.navigate("/project?id=16");
  assert.deepEqual(reloaded.opens, []);
  assert.equal(reloaded.open(), false);
});

test("the chat opens once the account switches say open on a new ticket", () => {
  const h = harness();
  h.render();
  assert.deepEqual(h.opens, []);
  h.receive({ ...defaults, aiChatOpenNewTickets: true });
  assert.deepEqual(h.opens, [true]);
  assert.equal(h.open(), true);
});

test("a browser that already holds the account switches is not made to wait", () => {
  const open = harness({ saved: { 7: { ...defaults, aiChatOpenNewTickets: true } } });
  open.render();
  assert.deepEqual(open.opens, [true]);
  const closed = harness({ saved: { 7: allOff } });
  closed.render();
  assert.deepEqual(closed.opens, []);
});

test("with the switch off the chat opens immediately, as it does today", () => {
  const h = harness({ waits: false });
  h.render();
  assert.deepEqual(h.opens, [true]);
});

test("an account whose saved switches are still unset opens the chat as today", () => {
  const h = harness();
  h.render();
  assert.deepEqual(h.opens, []);
  h.receive({ aiChatOpenNewTickets: null, aiChatOpenTickets: null, aiChatOpenBoards: null });
  assert.deepEqual(h.opens, [true]);
  assert.equal(h.open(), true);
});

test("a failed preferences fetch opens the chat as today and records no saved copy", () => {
  const h = harness({ fetchFailed: true });
  h.render();
  assert.deepEqual(h.opens, [true]);
  assert.equal(h.open(), true);
  assert.deepEqual(h.savedCopy(), {});
});

test("a chat opened by hand stays open when the account answer is closed", () => {
  const h = harness();
  h.render();
  assert.deepEqual(h.opens, []);
  h.handOpen();
  assert.equal(h.open(), true);
  h.receive(allOff);
  assert.equal(h.open(), true);
  assert.deepEqual(h.opens, [true]);
});

test("a guest on a shared board still opens the chat once the account answer arrives", () => {
  const h = harness({ user: { id: 9, uid: "guest_abc" }, path: "/project?id=15" });
  h.render();
  assert.deepEqual(h.opens, []);
  h.receive({ aiChatOpenNewTickets: null, aiChatOpenTickets: null, aiChatOpenBoards: null });
  assert.deepEqual(h.opens, [true]);
  assert.equal(h.open(), true);
});

test("a signed-out visitor keeps the chat space reserved as today", () => {
  const h = harness({ user: null });
  assert.equal(h.reserve(), true);
});

test("manual chat does not restore an open session before the saved switches arrive", () => {
  const h = sessionRestoreHarness();
  try {
    h.render();
    assert.equal(h.attempted(), false);
    assert.deepEqual(h.opens, []);
    h.receive(allOff);
    assert.equal(h.attempted(), true);
    assert.deepEqual(h.opens, []);
  } finally {
    h.restore();
  }
});

test("the flag is a client-safe bugfix that ships to everyone", async () => {
  const filename = "src/lib/flags/definitions/htpr-9245-chat-waits-for-saved-switches.ts";
  const { parseFlagFile } = await import("../.github/scripts/feature-flag-registry.mjs");
  const file = path.join(root, filename);
  assert.ok(fs.existsSync(file), `${filename} exists`);
  const { definition } = parseFlagFile(fs.readFileSync(file, "utf8"), filename);
  assert.equal(definition.key, WAITS);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason.length > 0);
});
