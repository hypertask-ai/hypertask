const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

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
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
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
  const state = {
    useRecoilValue: (key) => values[key],
    useSetRecoilState: set,
    useRecoilState: (key) => [values[key], set(key)],
  };
  return { values, state, settle(fn) {
    let result;
    for (let attempt = 0; attempt < 12; attempt++) {
      dirty = false;
      result = fn();
      if (!dirty) return result;
    }
    assert.fail("hook did not settle");
  } };
}

function harness({ switches = {}, saved = {}, waits = true, user = { id: 7 }, path = "/detail/project-15/1", fetchFailed = false } = {}) {
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
  const flags = {
    "htpr-7650-ai-chat-open-switches": true,
    "htpr-8038-chat-opener-ready": true,
    "htpr-7530-keep-ai-chat-closed": true,
    "htpr-7983-free-mode-signup": true,
    [WAITS]: waits,
  };
  const server = { data: undefined, dataUpdatedAt: 0, isError: fetchFailed };
  const queryClient = { setQueryData: () => {}, invalidateQueries: () => {} };
  const api = load("src/hooks/General/useAiChatAutoOpen.ts", {
    react: h.react,
    "next/navigation": { usePathname: () => path.split("?")[0], useSearchParams: () => new URLSearchParams(path.split("?")[1] ?? "") },
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
    "@/lib/aiChat/guestAutoOpen": guestAutoOpen,
    "@tanstack/react-query": { useQueryClient: () => queryClient },
    axios: { __esModule: true, default: { post: () => Promise.resolve(), get: () => Promise.resolve() } },
    "./useHydrated": { useHydrated: () => true },
    "./useGetUserPreferences": {
      useGetUserPreferences: () => ({
        data: server.data,
        dataUpdatedAt: server.dataUpdatedAt,
        isSuccess: server.dataUpdatedAt > 0,
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
    receive(data) { server.data = data; server.dataUpdatedAt += 1; render(); },
  };
}

const guestAutoOpen = load("src/lib/aiChat/guestAutoOpen.ts", {
  "@/lib/demo/guest": { isGuestUser: (user) => Boolean(user?.uid?.startsWith("guest_")) },
});

test("a fresh browser stays closed when the account switches every auto-open off", () => {
  const h = harness();
  h.render();
  assert.deepEqual(h.opens, []);
  h.receive(allOff);
  assert.deepEqual(h.opens, []);
  assert.equal(h.open(), false);
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
  const h = harness({ saved: { 7: { ...defaults, aiChatOpenNewTickets: true } } });
  h.render();
  assert.deepEqual(h.opens, [true]);
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

test("a signed-in account with no saved switches row opens the chat as today", () => {
  const h = harness({ fetchFailed: true });
  h.render();
  assert.deepEqual(h.opens, [true]);
  assert.equal(h.open(), true);
  assert.deepEqual(h.savedCopy(), {}, "a missing row must not be recorded as a saved copy");
});

test("a guest on a shared board still opens the chat by itself", () => {
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

test("a failed preferences fetch opens the chat as today", () => {
  const h = harness({ fetchFailed: true });
  h.render();
  assert.deepEqual(h.opens, [true]);
  assert.equal(h.open(), true);
});

test("the flag is a client-safe bugfix that ships to everyone", () => {
  const definition = load("src/lib/flags/definitions/htpr-9245-chat-waits-for-saved-switches.ts", {}).default;
  assert.equal(definition.key, WAITS);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.ok(definition.releaseRisk.reason.length > 0);
});
