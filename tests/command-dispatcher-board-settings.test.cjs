const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { QueryClient } = require("@tanstack/react-query");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") } });
const { CommandMode } = jiti(path.join(root, "src/models/enums.ts"));
const { getAllCommands } = jiti(path.join(root, "src/components/Modals/commands/HTC/AllCommands.ts"));
const { boardContextFromPath } = jiti(path.join(root, "src/lib/searchArchive.ts"));
const { getSettingsProjectForTeam } = jiti(path.join(root, "src/lib/settingsTeamSelection.ts"));

function loadModule(file, mocks) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", js)((name) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}

const boards = [
  { id: 7, teamId: "inne", title: "Previously selected board" },
  { id: 15, teamId: "hypertask", title: "Hypertask" },
  { id: 16, teamId: "hypertask", title: "Another board in the same team" },
];

function fixture(t, { pathname = "/project", query = "id=15", currentProject = boards[1], cached = true, guest = false, failFetch = false } = {}) {
  const atoms = { currentProjectAtom: {}, selectedSettingsTeamIdAtom: {}, showGuestLoginAtom: {} };
  const state = new Map([
    [atoms.currentProjectAtom, currentProject],
    [atoms.selectedSettingsTeamIdAtom, "inne"],
  ]);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (cached) queryClient.setQueryData(["projectsAllMinimal"], boards);
  t.after(() => queryClient.clear());
  const pushes = [];
  const errors = [];
  const storage = new Map();
  const previousWindow = global.window;
  global.window = {
    location: { hash: "#comment-12" },
    sessionStorage: { setItem: (key, value) => storage.set(key, value) },
  };
  t.after(() => { global.window = previousWindow; });
  let fetches = 0;
  const navigation = loadModule("src/components/Modals/Settings/settingsNavigation.ts", {
    "next/navigation": {
      usePathname: () => pathname,
      useSearchParams: () => new URLSearchParams(query),
      useRouter: () => ({ push: (href) => pushes.push(href) }),
    },
    nookies: { parseCookies: () => ({}) },
    react: { useCallback: (callback) => callback },
    "@/lib/state": {
      useRecoilValue: (atom) => state.get(atom),
      useRecoilState: (atom) => [state.get(atom), (value) => state.set(atom, value)],
      useSetRecoilState: (atom) => (value) => state.set(atom, value),
    },
    "@/store": atoms,
    "@/lib/demo/isGuestClient": { isGuestCookieUser: () => guest },
    "@tanstack/react-query": { useQueryClient: () => queryClient },
    "@/lib/searchArchive": { boardContextFromPath },
    "@/utils/api/global/apiHelpers/getAllProjectsMinimal": {
      getAllProjectsMinimal: async () => {
        fetches++;
        if (failFetch) throw new Error("Network unavailable");
        return boards;
      },
    },
    "react-hot-toast": { error: (message) => errors.push(message) },
  });
  const { openSettings } = navigation.useSettingsNavigation();
  let pending;
  let closed = 0;
  const dispatcher = loadModule("src/components/commandDispatcher.ts", {
    "@/models/enums": { CommandMode },
    "@/lib/agents/chatPaletteCommands": {},
    "@/hooks/Kanban/mobileBoardGestures": {},
    "react-hot-toast": {},
    "@/lib/constants": {},
    "@/lib/constants/aiEvents": {},
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": {},
    "@/lib/tours/types": {},
    "./Modals/Settings/settingsNavigation": navigation,
    "@/lib/snippets": {},
    "@/lib/timeQuickLog": {},
    "@/lib/aiChatDisplayMode": {},
  }).createCommandDispatcher({
    openSettings: (section) => { pending = openSettings(section); },
    setShowCommands: () => {},
    setCommandMode: () => {},
    setShowShortcuts: () => {},
    boardCloseHandler: () => { closed++; },
  });
  return {
    run: async (mode, payload) => {
      dispatcher.handleAction(mode, payload);
      await pending;
    },
    selectedBoard: () => getSettingsProjectForTeam(
      state.get(atoms.selectedSettingsTeamIdAtom), state.get(atoms.currentProjectAtom), boards,
    ),
    teamId: () => state.get(atoms.selectedSettingsTeamIdAtom),
    guestPrompt: () => state.get(atoms.showGuestLoginAtom),
    fetches: () => fetches,
    closed: () => closed,
    pushes, errors, storage,
  };
}

const boardCommands = [
  ...getAllCommands({ context: "Kanban" })
    .flatMap((group) => group.commandLists)
    .filter((command) => typeof command.payload === "string" && command.payload.startsWith("board-")),
  ...["board-memory", "board-planning", "board-staleness"].map((payload) => ({
    commandMode: CommandMode.Setting,
    payload,
  })),
];

for (const command of boardCommands) {
  for (const entry of [
    { name: "board", pathname: "/project", query: "id=15", currentProject: boards[1] },
    { name: "cross-team ticket", pathname: "/detail/project-15/6863", query: "", currentProject: boards[0] },
  ]) {
    test(`${command.payload} preselects the originating ${entry.name} instead of the persisted settings team`, async (t) => {
      const page = fixture(t, entry);
      await page.run(command.commandMode, command.payload);
      assert.equal(page.selectedBoard()?.id, 15);
      assert.equal(page.teamId(), "hypertask");
      assert.deepEqual(page.pushes, [`/settings/${command.payload}`]);
      assert.equal(page.closed(), 1);
      assert.equal(page.fetches(), 0, "reuse already loaded projects");
    });
  }
}

for (const [mode, section] of [
  [CommandMode.BoardSettings, "board-general"],
  [CommandMode.ManageTeams, "board-general"],
  [CommandMode.ManageBoards, "board-general"],
  [CommandMode.AICustomInstruction, "board-ai"],
]) {
  test(`legacy command ${mode} uses the same board selection contract`, async (t) => {
    const page = fixture(t);
    await page.run(mode);
    assert.equal(page.selectedBoard()?.id, 15);
    assert.deepEqual(page.pushes, [`/settings/${section}`]);
  });
}

test("a direct ticket load resolves its board when no current board or project cache is available", async (t) => {
  const page = fixture(t, { pathname: "/detail/project-15/6863", query: "", currentProject: null, cached: false });
  await page.run(CommandMode.Setting, "board-members");
  assert.equal(page.selectedBoard()?.id, 15);
  assert.equal(page.fetches(), 1);
  assert.equal(page.storage.get("hypertasks-settings-return-to"), "/detail/project-15/6863#comment-12");
});

test("the board route id overrides a stale board in the same team", async (t) => {
  const page = fixture(t, { currentProject: boards[2] });
  await page.run(CommandMode.Setting, "board-general");
  assert.equal(page.selectedBoard()?.id, 15);
});

for (const [pathname, section] of [["/project", "appearance"], ["/inbox", "board-general"], ["/settings/board-general", "board-members"], ["/settings/profile", "board-members"]]) {
  test(`${pathname} opening ${section} preserves deliberate settings selection without board context`, async (t) => {
    const page = fixture(t, { pathname, query: "" });
    await page.run(CommandMode.Setting, section);
    assert.equal(page.teamId(), "inne");
    assert.deepEqual(page.pushes, [`/settings/${section}`]);
  });
}

test("guests cannot change settings context or fetch projects", async (t) => {
  const page = fixture(t, { guest: true, cached: false, currentProject: null });
  await page.run(CommandMode.Setting, "board-general");
  assert.equal(page.guestPrompt(), true);
  assert.equal(page.teamId(), "inne");
  assert.equal(page.fetches(), 0);
  assert.deepEqual(page.pushes, []);
});

test("a board page without a query id uses its loaded board", async (t) => {
  const page = fixture(t, { query: "", cached: false });
  await page.run(CommandMode.Setting, "board-general");
  assert.equal(page.selectedBoard()?.id, 15);
  assert.equal(page.fetches(), 0);
});

test("an inaccessible ticket board never opens a different board's settings", async (t) => {
  const page = fixture(t, { pathname: "/detail/project-999/1", query: "", currentProject: boards[0] });
  await page.run(CommandMode.Setting, "board-general");
  assert.equal(page.errors.length, 1);
  assert.equal(page.fetches(), 1);
  assert.equal(page.teamId(), "inne");
  assert.deepEqual(page.pushes, []);
});

test("a failed board lookup reports the failure rather than opening the wrong board", async (t) => {
  const page = fixture(t, { pathname: "/detail/project-15/6863", query: "", currentProject: boards[0], cached: false, failFetch: true });
  await page.run(CommandMode.Setting, "board-general");
  assert.equal(page.errors.length, 1);
  assert.deepEqual(page.pushes, []);
});
