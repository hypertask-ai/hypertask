const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const flag = "htpr-7650-ai-chat-open-switches";
const flagFile = "@/lib/flags/definitions/htpr-7650-ai-chat-open-switches";
const policyFile = "@/lib/aiChat/autoOpenPreferences";
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function load(file, mocks = {}) {
  const mod = { exports: {} };
  const js = ts.transpileModule(read(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function("require", "module", "exports", "window", js)((name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name === flagFile) return { HTPR_7650_AI_CHAT_OPEN_SWITCHES_FLAG: flag };
    if (name === policyFile) return policy;
    assert.ok(name.startsWith("react"), `Unexpected dependency ${name} in ${file}`);
    return require(name);
  }, mod, mod.exports, mocks.window);
  return mod.exports;
}
const policy = load("src/lib/aiChat/autoOpenPreferences.ts");
const defaults = policy.AI_CHAT_AUTO_OPEN_DEFAULTS;
const allOff = Object.fromEntries(policy.AI_CHAT_AUTO_OPEN_KEYS.map((key) => [key, false]));

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
function pageHarness(values = defaults, options = {}) {
  const h = hooks();
  const s = stateHarness({ currentUserAtom: { id: 7 }, aiChatNewTicketPathAtom: "/detail/project-15/1", aiChatAutoOpenSuppressedAtom: false, showAIChatInterfaceAtom: false, aiChatAutoOpenPageAtom: null, ...options.state });
  let pathname = "/detail/project-15/1", query = "", mobile = false, enabled = options.enabled ?? true;
  const { useAiChatAutoOpen } = load("src/hooks/General/useAiChatAutoOpen.ts", {
    react: h.react, "@/lib/state": s.state, "@/store": atoms,
    "next/navigation": { usePathname: () => pathname, useSearchParams: () => new URLSearchParams(query) },
    "./useAiChatOpenPreferences": { useAiChatOpenPreferences: () => ({ enabled, ready: true, flagReady: true, values }), useSyncAiChatOpenPreferences() {} },
  });
  const render = () => s.settle(() => h.render(() => useAiChatAutoOpen(mobile)));
  return { ...s, render, navigate(url, phone = false) { [pathname, query = ""] = url.split("?"); mobile = phone; render(); },
    close() { s.set("aiChatAutoOpenSuppressedAtom")(true); s.set("showAIChatInterfaceAtom")(false); render(); },
    manualOpen() { s.set("aiChatAutoOpenSuppressedAtom")(false); s.set("showAIChatInterfaceAtom")(true); render(); } };
}

for (const [url, key] of [["/detail/project-15/1", "aiChatOpenNewTickets"], ["/detail/project-15/2", "aiChatOpenTickets"], ["/project?id=15", "aiChatOpenBoards"]]) {
  for (const on of [false, true]) test(`${key} alone controls ${url}: ${on}`, () => {
    const h = pageHarness({ ...allOff, [key]: on });
    h.navigate(url);
    assert.equal(h.values.showAIChatInterfaceAtom, on);
  });
}
test("chat space is reserved from the switch on first render, so the page does not jump when the chat opens", () => {
  for (const on of [false, true]) {
    const h = pageHarness({ ...allOff, aiChatOpenTickets: on });
    h.navigate("/detail/project-15/2");
    assert.equal(h.render().reserve, on);
  }
  const phone = pageHarness({ ...allOff, aiChatOpenTickets: true });
  phone.navigate("/detail/project-15/2", true);
  assert.equal(phone.render().reserve, false);
  const closed = pageHarness({ ...allOff, aiChatOpenTickets: true });
  closed.navigate("/detail/project-15/2"); closed.close();
  assert.equal(closed.render().reserve, false);
  closed.navigate("/detail/project-15/3");
  assert.equal(closed.render().reserve, true);
});
test("a chat closed before the switches existed stays closed on the first ticket after the update, then follows the switch", () => {
  const h = pageHarness({ ...allOff, aiChatOpenTickets: true }, { state: { aiChatAutoOpenSuppressedAtom: true } });
  h.navigate("/detail/project-15/2");
  assert.equal(h.values.showAIChatInterfaceAtom, false);
  assert.equal(h.render().reserve, false);
  h.navigate("/detail/project-15/3");
  assert.equal(h.values.showAIChatInterfaceAtom, true);
});
test("a pinned chat stays open on pages whose switch is off, but not on phone", () => {
  const h = pageHarness(allOff, { state: { aiChatPinnedAtom: true } });
  h.navigate("/project?id=15");
  assert.equal(h.values.showAIChatInterfaceAtom, true);
  h.navigate("/detail/project-15/2");
  assert.equal(h.values.showAIChatInterfaceAtom, true);
  const phone = pageHarness(allOff, { state: { aiChatPinnedAtom: true, showAIChatInterfaceAtom: true } });
  phone.navigate("/detail/project-15/2", true);
  assert.equal(phone.values.showAIChatInterfaceAtom, false);
});
test("an account choice of off that arrives after the chat opened closes it on the same page", () => {
  let values = { ...allOff, aiChatOpenTickets: true };
  const h = pageHarness(new Proxy({}, { get: (_target, key) => values[key] }));
  h.navigate("/detail/project-15/2");
  assert.equal(h.values.showAIChatInterfaceAtom, true);
  values = allOff; h.render();
  assert.equal(h.values.showAIChatInterfaceAtom, false);
});
test("an opened chat the user opened by hand is not closed by an account choice of off", () => {
  let values = allOff;
  const h = pageHarness(new Proxy({}, { get: (_target, key) => values[key] }));
  h.navigate("/detail/project-15/2");
  h.manualOpen();
  values = { ...allOff }; h.render();
  assert.equal(h.values.showAIChatInterfaceAtom, true);
});
test("board switch also covers demo, My Tasks, inbox and calendar; unrelated pages do not auto-open", () => {
  for (const url of ["/demo", "/my-tasks", "/inbox", "/calendar", "/settings"]) {
    const h = pageHarness({ ...allOff, aiChatOpenBoards: true });
    h.navigate(url);
    assert.equal(h.values.showAIChatInterfaceAtom, url !== "/settings");
  }
});
test("manual opening works with all switches off, and closing is page-local", () => {
  const off = pageHarness(allOff);
  off.navigate("/detail/project-15/2"); off.manualOpen();
  assert.equal(off.values.showAIChatInterfaceAtom, true);
  off.close(); off.render();
  assert.equal(off.values.showAIChatInterfaceAtom, false);
  const h = pageHarness({ ...allOff, aiChatOpenTickets: true, aiChatOpenBoards: true });
  h.navigate("/detail/project-15/2"); h.close(); h.render();
  assert.equal(h.values.showAIChatInterfaceAtom, false);
  h.navigate("/detail/project-15/3");
  assert.equal(h.values.showAIChatInterfaceAtom, true);
  h.close(); h.navigate("/project?id=15");
  assert.equal(h.values.showAIChatInterfaceAtom, true);
  h.close(); h.navigate("/project?id=16");
  assert.equal(h.values.showAIChatInterfaceAtom, true);
});
test("reload preserves a close on the same page; pins and session-open storage cannot bypass an off switch", () => {
  const h = pageHarness({ ...allOff, aiChatOpenTickets: true }, { state: {
    aiChatAutoOpenSuppressedAtom: true, aiChatAutoOpenPageAtom: "7:/detail/project-15/2::",
  } });
  h.navigate("/detail/project-15/2"); assert.equal(h.values.showAIChatInterfaceAtom, false);
  h.navigate("/detail/project-15/3"); assert.equal(h.values.showAIChatInterfaceAtom, true);
});
test("new ticket marker expires after leaving, and mobile retains new-ticket opening without desktop board auto-open", () => {
  const h = pageHarness({ ...defaults, aiChatOpenBoards: true });
  h.navigate("/detail/project-15/1", true); assert.equal(h.values.showAIChatInterfaceAtom, true);
  h.navigate("/project?id=15", true); assert.equal(h.values.showAIChatInterfaceAtom, false);
  h.navigate("/detail/project-15/1"); assert.equal(h.values.showAIChatInterfaceAtom, false);
  assert.equal(h.values.aiChatNewTicketPathAtom, null);
});
test("flag-off page policy is inert; explicit welcome and Ctrl+J handoffs are not closed by the new policy", () => {
  const h = pageHarness(defaults, { enabled: false });
  h.navigate("/detail/project-15/1"); assert.equal(h.values.showAIChatInterfaceAtom, false);
  for (const url of ["/detail/project-15/1?newTaskAi=1", "/project?id=15&welcome_ai=1", "/project?id=15&agentSidebar=1"]) {
    const manual = pageHarness(allOff, { state: { showAIChatInterfaceAtom: true } });
    manual.navigate(url); assert.equal(manual.values.showAIChatInterfaceAtom, true);
  }
});

test("migration reads only explicitly saved old values and keep-closed takes precedence", () => {
  for (const old of [{}, { keepAiChatClosed: false }, { openAiChatByDefault: false }, { openAiChatByDefault: "true" }]) {
    assert.deepEqual(policy.migrateAiChatAutoOpenPreferences(old), defaults);
  }
  assert.deepEqual(policy.migrateAiChatAutoOpenPreferences({ openAiChatByDefault: true }), { aiChatOpenNewTickets: true, aiChatOpenTickets: true, aiChatOpenBoards: true });
  for (const open of [undefined, false, true]) assert.deepEqual(policy.migrateAiChatAutoOpenPreferences({ keepAiChatClosed: true, openAiChatByDefault: open }), allOff);
  assert.deepEqual(policy.migrateAiChatAutoOpenPreferences(Object.create({ openAiChatByDefault: true })), defaults);
});

function preferenceHarness({ legacy = {}, local = {}, server, fail = false } = {}) {
  const h = hooks(), posts = [], invalidated = [];
  const s = stateHarness({ currentUserAtom: { id: 7 }, aiChatAutoOpenPreferencesAtom: local });
  let queryData = server, updated = server ? 1 : 0;
  const client = { setQueryData: (_key, update) => { queryData = update(queryData); updated++; }, invalidateQueries: ({ queryKey }) => invalidated.push(queryKey) };
  const api = load("src/hooks/General/useAiChatOpenPreferences.ts", {
    react: h.react, window: { localStorage: { getItem: () => JSON.stringify(legacy) } },
    "@/lib/state": s.state, "@/store": atoms,
    "@/hooks/useFlag": { useFlag: () => true, useFlagReady: () => true },
    "./useHydrated": { useHydrated: () => true },
    "@tanstack/react-query": { useQueryClient: () => client },
    axios: { __esModule: true, default: { post: (_url, body) => { posts.push(body); return fail ? Promise.reject(Error("offline")) : Promise.resolve(); } } },
    "./useGetUserPreferences": { useGetUserPreferences: (queryKey) => {
      assert.deepEqual(queryKey, ["user-preferences", "ai-chat-auto-open", String(s.values.currentUserAtom.id)]);
      return { data: queryData, dataUpdatedAt: updated, isSuccess: !!queryData };
    } },
    [policyFile]: { ...policy, readLocalAiChatAutoOpenPreferences: () => policy.migrateAiChatAutoOpenPreferences(legacy) },
  });
  const render = () => s.settle(() => h.render(() => {
    api.useSyncAiChatOpenPreferences();
    return api.useAiChatOpenPreferences();
  }));
  return { ...s, posts, invalidated, render,
    values: () => render().values,
    receive(data) { queryData = data; updated++; this.render(); },
    edit(key, value) { render().setPreference(key, value); this.render(); } };
}
test("local is immediate, server booleans win, and switching accounts cannot leak cached choices", () => {
  const h = preferenceHarness({ legacy: { openAiChatByDefault: true }, local: { 8: defaults } });
  assert.deepEqual(h.values(), { aiChatOpenNewTickets: true, aiChatOpenTickets: true, aiChatOpenBoards: true });
  h.receive(allOff);
  assert.deepEqual(h.values(), allOff);
  assert.deepEqual(h.posts, []);
  h.set("currentUserAtom")({ id: 8 });
  h.receive(undefined);
  assert.deepEqual(h.values(), defaults);
});
test("null server switches preserve migrated local values and save once even after failure", async () => {
  const h = preferenceHarness({ legacy: { keepAiChatClosed: true }, server: { aiChatOpenNewTickets: null, aiChatOpenTickets: true, aiChatOpenBoards: null }, fail: true });
  h.render(); h.render();
  h.receive({ aiChatOpenNewTickets: null, aiChatOpenTickets: true, aiChatOpenBoards: null });
  await Promise.resolve();
  assert.deepEqual(h.values(), { aiChatOpenNewTickets: false, aiChatOpenTickets: true, aiChatOpenBoards: false });
  assert.deepEqual(h.posts, [{ aiChatOpenIfUnset: { aiChatOpenNewTickets: false, aiChatOpenBoards: false } }]);
  assert.deepEqual(h.invalidated, []);
});
const flushWrites = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
test("untouched user saves the ticket defaults once and a switch edit writes only its boolean", async () => {
  const h = preferenceHarness({ server: { aiChatOpenNewTickets: null, aiChatOpenTickets: null, aiChatOpenBoards: null } });
  h.render(); h.render();
  assert.deepEqual(h.posts, [{ aiChatOpenIfUnset: defaults }]);
  h.edit("aiChatOpenBoards", true);
  await flushWrites();
  assert.deepEqual(h.posts[1], { aiChatOpenBoards: true });
  assert.equal(h.values().aiChatOpenBoards, true);
});
test("quick toggles are saved one after another so the last choice is the one kept", async () => {
  const h = preferenceHarness({ server: allOff });
  h.render();
  h.edit("aiChatOpenBoards", true); h.edit("aiChatOpenBoards", false); h.edit("aiChatOpenBoards", true);
  assert.deepEqual(h.posts, []);
  await flushWrites();
  assert.deepEqual(h.posts, [{ aiChatOpenBoards: true }, { aiChatOpenBoards: false }, { aiChatOpenBoards: true }]);
});

function preferencesApi(enabled, body, stored = { aiChatOpenNewTickets: null, aiChatOpenTickets: null, aiChatOpenBoards: null }) {
  const writes = [], flagReads = [], fills = [];
  const empty = {};
  const api = load("src/app/api/users/preferences/route.ts", {
    "@/lib/ai/htpr7038ModelReset": { ensureHtpr7038ModelReset: async () => "done" },
    "@/lib/auth/currentUser": { loadCurrentUser: async () => ({ userId: 7 }) },
    "@/lib/flags": { HTPR_6924_REST_COMPAT_FLAG: "rest", isFeatureEnabled: async (key, id) => { assert.equal(id, 7); flagReads.push(key); return key === "rest" || enabled; } },
    "@/lib/mcp/readJsonBody": { readJsonBody: async () => ({ ok: true, body }) },
    "next/server": { NextResponse: { json: (data, options) => ({ data, status: options?.status ?? 200 }) } },
    "next/headers": empty,
    "@/lib/prisma": { __esModule: true, default: { userSetting: {
      update: async ({ data }) => { writes.push(data); return data; },
      updateMany: async ({ where, data }) => { fills.push({ where, data }); const key = Object.keys(data)[0]; if (stored[key] !== null) return { count: 0 }; stored[key] = data[key]; return { count: 1 }; },
    } } },
    "@prisma/client": empty,
    "@/utils/controllers/users/fetch_preferences": { invalidateUserPreferenceCache: async () => {} },
    "@/lib/aiModelPreferences": empty, "@/lib/aiModelOptions": empty,
    "@/utils/helperFunctions/sanitizeRichHtml": empty, "@/lib/dictationProvider": empty,
    "@/lib/configs/allTasks.config": empty, "@/models/Calendar/model": empty,
    "@/lib/configs/boardSortMode.config": empty, "@/lib/flags/definitions/htpr-7649-sidebar-view-saved": empty,
  });
  return { post: () => api.POST({ headers: {} }), writes, flagReads, fills, stored };
}
for (const key of policy.AI_CHAT_AUTO_OPEN_KEYS) {
  test(`API validates ${key} as boolean even with flag off and gates valid writes by user`, async () => {
    for (const enabled of [false, true]) {
      for (const bad of [null, 0, 1, "true", [], {}, undefined]) {
        const h = preferencesApi(enabled, { [key]: bad });
        assert.equal((await h.post()).status, 400);
        assert.deepEqual(h.writes, []);
      }
      for (const value of [false, true]) {
        const h = preferencesApi(enabled, { [key]: value });
        assert.equal((await h.post()).status, 200);
        assert.deepEqual(h.writes, [enabled ? { [key]: value } : {}]);
        assert.ok(h.flagReads.includes(flag));
      }
    }
  });
}
test("API rejects a mixed valid/invalid patch atomically and accepts all three booleans together", async () => {
  const bad = preferencesApi(true, { ...defaults, aiChatOpenBoards: "yes" });
  assert.equal((await bad.post()).status, 400); assert.deepEqual(bad.writes, []);
  const good = preferencesApi(true, defaults);
  assert.equal((await good.post()).status, 200); assert.deepEqual(good.writes, [defaults]);
});
test("one-time copy fills only empty switches and never overwrites a choice saved elsewhere", async () => {
  const h = preferencesApi(true, { aiChatOpenIfUnset: { aiChatOpenNewTickets: false, aiChatOpenBoards: false } },
    { aiChatOpenNewTickets: true, aiChatOpenTickets: true, aiChatOpenBoards: null });
  assert.equal((await h.post()).status, 200);
  assert.deepEqual(h.stored, { aiChatOpenNewTickets: true, aiChatOpenTickets: true, aiChatOpenBoards: false });
  assert.deepEqual(h.fills.map((fill) => fill.where), [{ userId: 7, aiChatOpenNewTickets: null }, { userId: 7, aiChatOpenBoards: null }]);
  assert.deepEqual(h.writes, [{}]);
});
test("one-time copy rejects bad shapes with 400 and writes nothing when the flag is off", async () => {
  for (const bad of [null, true, [], "x", { aiChatOpenBoards: "no" }, { boardSortMode: true }]) {
    const h = preferencesApi(true, { aiChatOpenIfUnset: bad });
    assert.equal((await h.post()).status, 400); assert.deepEqual(h.fills, []); assert.deepEqual(h.writes, []);
  }
  const off = preferencesApi(false, { aiChatOpenIfUnset: defaults });
  assert.equal((await off.post()).status, 200); assert.deepEqual(off.fills, []);
  assert.deepEqual(off.stored, { aiChatOpenNewTickets: null, aiChatOpenTickets: null, aiChatOpenBoards: null });
});
test("a successful copy refetches the saved switches instead of guessing them", async () => {
  const h = preferenceHarness({ server: { aiChatOpenNewTickets: null, aiChatOpenTickets: true, aiChatOpenBoards: true } });
  h.render();
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(h.posts, [{ aiChatOpenIfUnset: { aiChatOpenNewTickets: true } }]);
  assert.deepEqual(h.invalidated, [["user-preferences", "ai-chat-auto-open", "7"]]);
});

function toggles(enabled, keepClosedFlag = true) {
  const Toggle = () => null, inert = { default: () => null };
  const changes = [];
  const { default: Section } = load("src/components/Modals/Settings/TaskPageSection.tsx", {
    "@/hooks/General/useAiChatOpenPreferences": { useAiChatOpenPreferences: () => ({ enabled, values: defaults, setPreference: (key, value) => changes.push([key, value]) }) },
    "@/components/sidebars/RightSidebar/UserPreference": inert,
    "@/lib/state": { useRecoilState: () => [false, () => {}] }, "@/store": {},
    "@/hooks/useFlag": { useFlag: (key) => key === flag ? enabled : keepClosedFlag },
    "@/lib/flags/keys": { HTPR_7650_AI_CHAT_OPEN_SWITCHES_FLAG: flag, HTPR_7530_KEEP_AI_CHAT_CLOSED_FLAG: "htpr-7530-keep-ai-chat-closed" },
    "./SettingsCard": inert, "./SettingsScrollPicker": inert, "./SettingsSectionShell": inert, "./SettingsToggle": { default: Toggle },
  });
  const rows = [];
  function visit(node) { React.Children.forEach(node, (child) => { if (!React.isValidElement(child)) return; if (child.type === Toggle) rows.push(child.props); else visit(child.props.children); }); }
  visit(Section()); return { rows, changes };
}
test("settings replaces old controls only with flag on, reuses SettingsToggle, and writes independent choices", () => {
  const { rows, changes } = toggles(true);
  assert.deepEqual(rows.map((row) => row.label), ["Open AI chat on newly created tickets", "Open AI chat when I open a ticket", "Open AI chat on boards"]);
  rows.forEach((row) => row.onChange());
  assert.deepEqual(changes, [["aiChatOpenNewTickets", false], ["aiChatOpenTickets", true], ["aiChatOpenBoards", true]]);
  assert.deepEqual(toggles(false).rows.map((row) => row.label), ["Open AI chat by default", "Keep AI chat closed always"]);
  assert.deepEqual(toggles(false, false).rows.map((row) => row.label), ["Open AI chat by default"]);
});
test("flag is an Everyone feature with release risk and production smoke mode", () => {
  const definition = load(`src/lib/flags/definitions/${flag}.ts`).default;
  assert.equal(definition.key, flag); assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "EVERYONE"); assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason);
  assert.match(read("e2e/smoke/production-flag-modes.json"), /"htpr-7650-ai-chat-open-switches": "EVERYONE"/);
});

test("palette uses the new settings command only with the new flag and preserves old flag-off wording", () => {
  const { createJiti } = require("jiti");
  const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") } });
  const { getAllCommands } = jiti(path.join(root, "src/components/Modals/commands/HTC/AllCommands.ts"));
  for (const enabled of [false, true, false]) {
    const command = getAllCommands(undefined, undefined, false, "keep ai chat closed always", enabled ? "Settings: AI chat auto-open" : "")
      .flatMap((group) => group.commandLists).find((item) => item.key === "settingsTaskPageOpenAiChatByDefault");
    assert.equal(command.name, enabled ? "Settings: AI chat auto-open" : "Settings: Open AI chat by default");
    assert.equal(command.payload, "task-page");
    assert.equal(command.keywords.includes("newly created tickets"), enabled);
    assert.equal(command.keywords.includes("keep ai chat closed always"), !enabled);
  }
});
test("pre-hydration ticket reservation honors user-scoped preferences and explicit legacy migration", () => {
  const { JSDOM } = require("jsdom");
  const { buildTicketSidebarBootScript } = load("src/lib/ticketSidebarBoot.ts", {
    "@/lib/configs/style.config": { AI_CHAT_SIDEBAR_DEFAULT_PX: 420, AI_CHAT_SIDEBAR_MIN_PX: 340 },
  });
  for (const [saved, expected] of [
    [{}, "closed"],
    [{ aiChatPinned: true }, "closed"],
    [{ openAiChatByDefault: true }, "reserved"],
    [{ openAiChatByDefault: true, keepAiChatClosed: true }, "closed"],
    [{ aiChatAutoOpenPreferences: { 7: { ...defaults, aiChatOpenTickets: true } } }, "reserved"],
    [{ openAiChatByDefault: true, aiChatAutoOpenPreferences: { 7: allOff } }, "closed"],
    [{ aiChatAutoOpenPreferences: { 8: { ...defaults, aiChatOpenTickets: true } } }, "closed"],
    [{ openAiChatByDefault: true, aiChatAutoOpenPage: "7:/detail/project-15/2::", aiChatAutoOpenSuppressed: true }, "closed"],
    [{ openAiChatByDefault: true, aiChatAutoOpenSuppressed: true }, "closed"],
    [{ openAiChatByDefault: true, aiChatAutoOpenPage: "7:/detail/project-15/9::", aiChatAutoOpenSuppressed: true }, "reserved"],
  ]) {
    const script = buildTicketSidebarBootScript({ keepClosed: true, overlayTicket: true, autoOpenSwitches: true, userId: 7 });
    const dom = new JSDOM(`<html><head><script>${script}</script></head></html>`, {
      url: "https://app.hypertask.ai/detail/project-15/2", runScripts: "dangerously",
      beforeParse(window) { window.innerWidth = 1440; window.localStorage.setItem("recoil-persist", JSON.stringify(saved)); },
    });
    try { assert.equal(dom.window.document.documentElement.dataset.ticketSidebar, expected); }
    finally { dom.window.close(); }
  }
});

test("opened embedded tickets use the ticket switch rather than the surrounding board switch", () => {
  const h = pageHarness({ ...allOff, aiChatOpenTickets: true });
  h.navigate("/inbox"); assert.equal(h.values.showAIChatInterfaceAtom, false);
  h.set("aiChatEmbeddedTicketPathAtom")("/detail/project-15/9"); h.render();
  assert.equal(h.values.showAIChatInterfaceAtom, true);
  h.close(); h.render(); assert.equal(h.values.showAIChatInterfaceAtom, false);
  h.set("aiChatEmbeddedTicketPathAtom")("/detail/project-15/10"); h.render();
  assert.equal(h.values.showAIChatInterfaceAtom, true);
});

test("preferences reader selects all switches and upgrades pre-release cached preferences to nullable values", async () => {
  for (const cached of [null, JSON.stringify({ playGifs: true })]) {
    const controller = load("src/utils/controllers/users/fetch_preferences.ts", {
      "@/lib/ai/htpr7038ModelReset": { ensureHtpr7038ModelReset: async () => "done" },
      "@/lib/redis": { getRedis: async () => ({ get: async () => cached, setex: async () => {} }) },
      "@/lib/prisma": { __esModule: true, default: { userSetting: { findUnique: async ({ where, select }) => {
        assert.deepEqual(where, { userId: 7 });
        policy.AI_CHAT_AUTO_OPEN_KEYS.forEach((key) => assert.equal(select[key], true));
        return defaults;
      } } } },
    });
    const response = await controller.fetchUserPreferenceController(7);
    assert.equal(response.status, 200);
    for (const key of policy.AI_CHAT_AUTO_OPEN_KEYS) assert.equal(response.res[key], cached ? null : defaults[key]);
  }
});
