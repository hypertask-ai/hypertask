const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function load(file, mocks = {}) {
  const loaded = { exports: {} };
  const js = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", js)((name) => {
    assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency ${name}`);
    return mocks[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}

const config = load("src/lib/configs/boardSortMode.config.ts");
const flagFile = "src/lib/flags/definitions/htpr-7649-sidebar-view-saved.ts";
const flag = load(flagFile);
const preferenceKey = ["user-preferences"];
const tick = () => new Promise((resolve) => setImmediate(resolve));

function sidebar(options = {}) {
  const { local, loaded = true, enabled = true, post } = options;
  const server = Object.hasOwn(options, "server") ? options.server : "lastUsed";
  const storage = new Map();
  if (local) storage.set("recoil-persist", JSON.stringify({ boardSortModeAtom: local }));
  let mode = JSON.parse(storage.get("recoil-persist") ?? "{}").boardSortModeAtom ?? "teams";
  let preferences = { boardSortMode: server, playGifs: false };
  let updatedAt = loaded ? 1 : 0;
  const effects = [], refs = [], dependencies = [];
  const posts = [], reads = [], paints = [], cancels = [];
  let index = 0;
  const atom = {};
  const setMode = (next) => {
    mode = typeof next === "function" ? next(mode) : next;
    storage.set("recoil-persist", JSON.stringify({ boardSortModeAtom: mode }));
  };
  const queryClient = {
    cancelQueries: async (filters) => { cancels.push(filters.queryKey); },
    setQueryData: (key, update) => {
      assert.deepEqual(key, preferenceKey);
      preferences = update(preferences);
      updatedAt += 1;
    },
    invalidateQueries: async () => {},
  };
  const { useBoardSortMode } = load("src/hooks/General/useBoardSortMode.ts", {
    react: {
      useRef: (initial) => {
        const slot = index++;
        refs[slot] ??= { current: initial };
        return refs[slot];
      },
      useEffect: (callback, deps) => {
        const slot = index++;
        if (!dependencies[slot] || deps.some((value, i) => !Object.is(value, dependencies[slot][i]))) {
          effects.push(callback);
          dependencies[slot] = deps;
        }
      },
    },
    axios: { __esModule: true, default: { post: async (url, body) => {
      assert.equal(url, "/api/users/preferences");
      posts.push(body);
      return post ? post(body) : { status: 200, data: { settings: body } };
    } } },
    "@tanstack/react-query": { useQueryClient: () => queryClient },
    "@/lib/state": { useRecoilState: (actual) => { assert.equal(actual, atom); return [mode, setMode]; } },
    "@/store": { boardSortModeAtom: atom },
    "@/hooks/useFlag": { useFlag: (key) => { assert.equal(key, flag.HTPR_7649_SIDEBAR_VIEW_SAVED_FLAG); return enabled; } },
    "@/lib/flags/definitions/htpr-7649-sidebar-view-saved": flag,
    "@/lib/configs/boardSortMode.config": config,
    "./useGetUserPreferences": {
      USER_PREFERENCES_QUERY_KEY: preferenceKey,
      useGetUserPreferences: (_key, _initial, options) => {
        if (options.enabled) reads.push("preferences");
        return { data: preferences, dataUpdatedAt: updatedAt };
      },
    },
  });
  return {
    posts, reads, paints, cancels, storage,
    render() {
      index = 0;
      const value = useBoardSortMode();
      paints.push(value[0]);
      effects.splice(0).forEach((effect) => effect());
      return value;
    },
    arrive(value) { preferences = { ...preferences, boardSortMode: value }; updatedAt += 1; },
    get mode() { return mode; },
    get preferences() { return preferences; },
  };
}

test("a new browser loads saved Recent from account preferences", () => {
  const view = sidebar();
  assert.equal(view.storage.size, 0);
  view.render();
  assert.equal(view.mode, "lastUsed");
  assert.equal(view.render()[0], "lastUsed");
  assert.equal(JSON.parse(view.storage.get("recoil-persist")).boardSortModeAtom, "lastUsed");
  assert.deepEqual(view.posts, []);
});

test("same-browser Recent remains the first value before and after preferences arrive", () => {
  const view = sidebar({ local: "lastUsed", loaded: false });
  assert.equal(view.render()[0], "lastUsed");
  assert.equal(view.mode, "lastUsed", "placeholder preferences must not reset local storage");
  view.arrive("lastUsed");
  view.render();
  assert.deepEqual(view.paints, ["lastUsed", "lastUsed"]);
  assert.equal(view.mode, "lastUsed");
});

test("a saved account choice wins over this browser's choice", () => {
  const view = sidebar({ local: "lastUsed", server: "teams" });
  view.render();
  assert.equal(view.mode, "teams");
  assert.deepEqual(view.posts, []);
});

test("an account with no saved choice keeps this browser's Recent and saves it once", async () => {
  for (const server of [null, undefined, "invalid"]) {
    const view = sidebar({ local: "lastUsed", server });
    view.render();
    await tick();
    view.render();
    await tick();
    view.render();
    assert.equal(view.mode, "lastUsed");
    assert.deepEqual(view.posts, [{ boardSortModeIfUnset: "lastUsed" }]);
    assert.deepEqual(view.cancels, [], "copying this browser's choice must not overwrite the account cache");
  }
});

test("choosing before account preferences load sends the choice without touching the shared preferences fetch", async () => {
  const view = sidebar({ server: null, loaded: false });
  const [, change] = view.render();
  change("lastUsed");
  await tick();
  assert.equal(view.mode, "lastUsed");
  assert.deepEqual(view.posts, [{ boardSortMode: "lastUsed" }]);
  assert.deepEqual(view.cancels, []);
  assert.equal(view.preferences.boardSortMode, null);
  assert.equal(view.preferences.playGifs, false);
});

test("users with no saved choice anywhere default to Teams without a write", async () => {
  const empty = sidebar({ server: null });
  assert.equal(empty.render()[0], "teams");
  await tick();
  assert.equal(empty.mode, "teams");
  assert.deepEqual(empty.posts, []);
});

test("choosing Recent updates the persisted atom immediately and sends the preference", async () => {
  const view = sidebar({ server: "teams" });
  const [, change] = view.render();
  change("lastUsed");
  assert.equal(view.mode, "lastUsed");
  assert.equal(view.preferences.boardSortMode, "lastUsed");
  assert.equal(view.preferences.playGifs, false);
  await tick();
  assert.deepEqual(view.posts, [{ boardSortMode: "lastUsed" }]);
});

test("late preference reads cannot undo a pending choice and rapid changes save in order", async () => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const view = sidebar({ server: "teams", post: async () => { await waiting; return { status: 200 }; } });
  const [, change] = view.render();
  change("lastUsed");
  view.arrive("teams");
  view.render();
  assert.equal(view.mode, "lastUsed");
  change("teams");
  await tick();
  assert.deepEqual(view.posts, [{ boardSortMode: "lastUsed" }]);
  release();
  await tick();
  assert.deepEqual(view.posts, [{ boardSortMode: "lastUsed" }, { boardSortMode: "teams" }]);
  assert.equal(view.mode, "teams");
});

test("flag off leaves local Recent untouched, disables preference reads and makes no writes", async () => {
  const view = sidebar({ local: "lastUsed", server: "teams", enabled: false });
  const [value, change] = view.render();
  assert.equal(value, "lastUsed");
  assert.equal(view.mode, "lastUsed");
  change("teams");
  await tick();
  assert.equal(view.mode, "teams");
  assert.deepEqual(view.reads, []);
  assert.deepEqual(view.posts, []);
  assert.equal(view.preferences.boardSortMode, "teams");
});

function preferencesApi(enabled = true, stored = null) {
  const writes = [], invalidations = [], conditionalWrites = [];
  const saved = { boardSortMode: stored };
  const route = load("src/app/api/users/preferences/route.ts", {
    "@/lib/ai/htpr7038ModelReset": { ensureHtpr7038ModelReset: async () => "disabled" },
    "@/lib/mcp/readJsonBody": {},
    "@/lib/auth/currentUser": { loadCurrentUser: async () => null },
    "@/lib/flags": { isFeatureEnabled: async (key, id) => {
      assert.equal(key, flag.HTPR_7649_SIDEBAR_VIEW_SAVED_FLAG);
      assert.equal(id, 7);
      return enabled;
    } },
    "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    "next/headers": { cookies: async () => ({ get: () => ({ value: '{"id":7}' }) }) },
    "@/lib/prisma": { __esModule: true, default: { userSetting: {
      update: async (args) => { writes.push(args); Object.assign(saved, args.data); return args.data; },
      updateMany: async (args) => {
        conditionalWrites.push(args);
        const matches = Object.entries(args.where).every(([key, value]) => key === "userId" ? value === 7 : saved[key] === value);
        if (matches) Object.assign(saved, args.data);
        return { count: matches ? 1 : 0 };
      },
    } } },
    "@prisma/client": {},
    "@/utils/controllers/users/fetch_preferences": {
      invalidateUserPreferenceCache: async (id) => invalidations.push(id),
    },
    "@/lib/aiModelPreferences": {},
    "@/lib/aiModelOptions": {},
    "@/utils/helperFunctions/sanitizeRichHtml": {},
    "@/lib/dictationProvider": {},
    "@/lib/configs/allTasks.config": load("src/lib/configs/allTasks.config.ts"),
    "@/lib/configs/boardSortMode.config": config,
    "@/lib/flags/definitions/htpr-7649-sidebar-view-saved": flag,
    "@/lib/flags/definitions/htpr-7650-ai-chat-open-switches": {},
    "@/lib/aiChat/autoOpenPreferences": { AI_CHAT_AUTO_OPEN_KEYS: ["aiChatOpenNewTickets", "aiChatOpenTickets", "aiChatOpenBoards"] },
    "@/models/Calendar/model": {},
  });
  return { writes, invalidations, conditionalWrites, saved, post: (body) => route.POST({ json: async () => body }) };
}

test("preferences API accepts both choices and existing preferences and invalidates the account cache", async () => {
  for (const boardSortMode of ["teams", "lastUsed"]) {
    const api = preferencesApi();
    const response = await api.post({ boardSortMode, allTasksDateRange: "30", playGifs: false, shareReadReceipts: true });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.settings, { boardSortMode, allTasksDateRange: "30", playGifs: false, shareReadReceipts: true });
    assert.deepEqual(api.writes[0].where, { userId: 7 });
    assert.equal(api.writes[0].select.boardSortMode, true);
    assert.deepEqual(api.invalidations, [7]);
  }
});

test("preferences API rejects invalid sidebar choices before any write", async () => {
  for (const boardSortMode of ["recent", "", null, 1, true, [], {}]) {
    const api = preferencesApi();
    const response = await api.post({ boardSortMode });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, "Invalid board sort mode");
    assert.deepEqual(api.writes, []);
    assert.deepEqual(api.invalidations, []);
  }
});

test("server flag off does not save boardSortMode but still saves existing preferences", async () => {
  const api = preferencesApi(false);
  const response = await api.post({ boardSortMode: "lastUsed", playGifs: false });
  assert.equal(response.status, 200);
  assert.deepEqual(api.writes[0].data, { playGifs: false });
});

test("copying a browser's choice never overwrites a choice already saved on the account", async () => {
  const api = preferencesApi(true, "teams");
  const response = await api.post({ boardSortModeIfUnset: "lastUsed" });
  assert.equal(response.status, 200);
  assert.deepEqual(api.conditionalWrites[0].where, { userId: 7, boardSortMode: null });
  assert.equal(api.saved.boardSortMode, "teams");
  assert.equal(Object.hasOwn(api.writes[0].data, "boardSortMode"), false);
  assert.deepEqual(api.invalidations, [7]);
});

test("copying a browser's choice fills an empty account and explicit choices still overwrite", async () => {
  const empty = preferencesApi(true, null);
  await empty.post({ boardSortModeIfUnset: "lastUsed" });
  assert.equal(empty.saved.boardSortMode, "lastUsed");
  const chosen = preferencesApi(true, "lastUsed");
  await chosen.post({ boardSortMode: "teams" });
  assert.equal(chosen.saved.boardSortMode, "teams");
  assert.deepEqual(chosen.conditionalWrites, []);
});

test("copy requests are validated and skipped with the flag off", async () => {
  for (const boardSortModeIfUnset of ["recent", null, 1]) {
    const api = preferencesApi();
    const response = await api.post({ boardSortModeIfUnset });
    assert.equal(response.status, 400);
    assert.deepEqual(api.conditionalWrites, []);
    assert.deepEqual(api.writes, []);
  }
  const off = preferencesApi(false, null);
  assert.equal((await off.post({ boardSortModeIfUnset: "lastUsed" })).status, 200);
  assert.deepEqual(off.conditionalWrites, []);
  assert.equal(off.saved.boardSortMode, null);
});

test("shared preferences controller exposes the choice to bootstrap and GET", async () => {
  const controller = load("src/utils/controllers/users/fetch_preferences.ts", {
    "@/lib/ai/htpr7038ModelReset": { ensureHtpr7038ModelReset: async () => "disabled" },
    "@/lib/prisma": { __esModule: true, default: { userSetting: { findUnique: async ({ where, select }) => {
      assert.equal(where.userId, 7);
      assert.equal(select.boardSortMode, true);
      return { boardSortMode: "lastUsed" };
    } } } },
    "@/lib/redis": { getRedis: async () => ({ get: async () => null, setex: async () => {} }) },
  });
  const result = await controller.fetchUserPreferenceController(7);
  assert.equal(result.status, 200);
  assert.equal(result.res.boardSortMode, "lastUsed");
});

test("preferences query carries the saved choice from bootstrap or its API fallback", async () => {
  for (const bootstrapped of [true, false]) {
    let apiReads = 0;
    const preferences = { boardSortMode: "lastUsed" };
    const query = load("src/hooks/General/useGetUserPreferences.tsx", {
      "@tanstack/react-query": { useQuery: (options) => options },
      axios: { __esModule: true, default: { get: async (url) => {
        assert.equal(url, "/api/users/preferences");
        apiReads += 1;
        return { status: 200, data: { settings: preferences } };
      } } },
      "@/lib/appShellBootstrap/client": { consumeEarlyAppShellBootstrapSlice: async (slice) => {
        assert.equal(slice, "preferences");
        return bootstrapped ? preferences : undefined;
      } },
      "@/hooks/General/useHydrated": { useHydrated: () => true },
    });
    const result = await query.useGetUserPreferences().queryFn();
    assert.equal(result.boardSortMode, "lastUsed");
    assert.equal(apiReads, bootstrapped ? 0 : 1);
  }
});

test("sidebar wiring preserves the existing persisted atom and first-screen seeds; flag is an Everyone bugfix", () => {
  assert.match(read("src/components/sidebars/leftSidebar.tsx"), /\[boardSortMode, setBoardSortMode\] = useBoardSortMode\(\)/);
  assert.match(read("src/components/sidebars/leftSidebar.tsx"), /onSortChange=\{setBoardSortMode\}/);
  assert.match(read("src/store/index.ts"), /boardSortModeAtom = atom<[\s\S]*?default: "teams",\s*effects_UNSTABLE: \[persistAtom\]/);
  assert.doesNotMatch(read("src/utils/Providers.tsx"), /boardSortModeAtom/);
  assert.equal(flag.default.kind, "bugfix");
  assert.equal(flag.default.defaultMode, "EVERYONE");
  const modes = JSON.parse(read("e2e/smoke/production-flag-modes.json")).modes;
  assert.equal(modes[flag.default.key], "EVERYONE");
  assert.match(read("src/prisma/schema.prisma"), /boardSortMode\s+String\?/);
  assert.equal(read("src/prisma/migrations/20261023090000_sidebar_board_sort_mode/migration.sql").trim(), 'ALTER TABLE "UserSetting" ADD COLUMN "boardSortMode" TEXT;');
});
