const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const FLAG = "htpr-7515-connect-github-per-board";
const file = "src/components/Modals/Settings/GitHubSection.tsx";

function fixture(t, { enabled = true, query = "projectId=15", data, error = null, loading = false } = {}) {
  const states = [];
  let cursor = 0;
  let queryOptions;
  let refetches = 0;
  const messages = [];
  const requests = [];
  const cacheWrites = [];
  const settings = data ?? {
    projectId: 15, version: "v1", canConnect: true,
    installations: [{ id: "123", accountLogin: "acme", accountType: "Organization", installedByMe: true }],
    connected: [
      { repositoryId: "456", fullName: "acme/private", provenance: "installed", installationId: "123", isPrivate: true },
      { repositoryId: null, fullName: "acme/legacy", provenance: "legacy", installationId: null, isPrivate: null },
    ],
    available: [
      { repositoryId: "789", fullName: "acme/web", installationId: "123", isPrivate: false, onOtherBoard: false },
      { repositoryId: "999", fullName: "acme/other", installationId: "123", isPrivate: true, onOtherBoard: true },
    ],
    githubUnavailable: false,
  };
  const queryResult = {
    data: loading || error ? undefined : settings, isLoading: loading, isError: Boolean(error), error,
    isFetching: false, refetch: async () => { refetches++; },
  };
  let reply = { status: 200, body: settings };
  const fetcher = async (url, options = {}) => {
    requests.push({ url, ...options });
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.body };
  };
  const mocks = {
    "react/jsx-runtime": require("react/jsx-runtime"),
    react: {
      useState: (initial) => {
        const index = cursor++;
        if (!(index in states)) states[index] = initial;
        return [states[index], (value) => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
      },
    },
    "next/navigation": { useSearchParams: () => new URLSearchParams(query) },
    "react-hot-toast": { success: (message) => messages.push(message), error: (message) => messages.push(message) },
    "@/hooks/useFlag": { useFlag: (key) => { assert.equal(key, FLAG); return enabled; } },
    "@/lib/flags/definitions/htpr-7515-connect-github-per-board": { HTPR_7515_CONNECT_GITHUB_PER_BOARD_FLAG: FLAG },
    "@/lib/state": { useRecoilValue: () => ({ id: 10 }) },
    "@/store": { currentUserAtom: {} },
    "@tanstack/react-query": {
      useQuery: (options) => { queryOptions = options; return queryResult; },
      useQueryClient: () => ({ setQueryData: (key, value) => { cacheWrites.push({ key, value }); queryResult.data = value; } }),
    },
    "@/components/Modals/OptionPicker": "OptionPickerModal",
    "./SettingsCard": "SettingsCard",
    "./SettingsSectionShell": "SettingsSectionShell",
    "./SettingsBillingRow": { BillingActionRow: "BillingActionRow", settingsActionButtonClass: "shared-action" },
  };
  const javascript = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "fetch", javascript)((name) => {
    assert.ok(name in mocks, `Unexpected import: ${name}`);
    return mocks[name];
  }, loaded, loaded.exports, fetcher);
  const render = () => { cursor = 0; return loaded.exports.default(); };
  const find = (predicate) => {
    let found;
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(visit);
      if (predicate(node)) found = node;
      if (node.props) Object.values(node.props).forEach(visit);
    };
    visit(render());
    assert.ok(found, "Expected rendered control missing");
    return found;
  };
  const button = (label) => find((node) => node.type === "button" && node.props.children === label);
  const picker = () => find((node) => node.type === "OptionPickerModal").props;
  const text = () => {
    const values = [];
    const visit = (node) => {
      if (typeof node === "string") values.push(node);
      else if (Array.isArray(node)) node.forEach(visit);
      else if (node?.props) Object.values(node.props).forEach(visit);
    };
    visit(render());
    return values.join(" ");
  };
  render();
  return {
    render, find, button, picker, text, settings, queryResult, requests, cacheWrites, messages,
    query: () => queryOptions,
    refetches: () => refetches,
    reply: (status, body) => { reply = { status, body }; },
    choose: (id) => picker().onSelect(picker().options.find((option) => option.id === id)),
    save: async () => { button("Save").props.onClick(); await new Promise(setImmediate); },
  };
}

test("flag Off and a missing or invalid explicit projectId never enable a board request", (t) => {
  const off = fixture(t, { enabled: false });
  assert.equal(off.render(), null);
  assert.equal(off.query().enabled, false);
  for (const query of ["", "projectId=wrong", "projectId=0", "projectId=9007199254740992"]) {
    const page = fixture(t, { query, loading: true });
    assert.equal(page.query().enabled, false);
    assert.match(page.text(), /Open Connect GitHub from the board/);
  }
});

test("GET and installation use only the URL board; query cache includes user and board", async (t) => {
  const page = fixture(t);
  assert.deepEqual(page.query().queryKey, ["boardGithubSettings", 10, 15]);
  await page.query().queryFn({ signal: undefined });
  assert.equal(page.requests[0].url, "/api/projects/15/github");
  assert.equal(page.requests[0].cache, "no-store");
  const form = page.find((node) => node.type === "form");
  assert.equal(form.props.action, "/api/github/install");
  assert.equal(form.props.method, "post");
  assert.equal(page.find((node) => node.type === "input").props.value, 15);
  page.reply(200, { ...page.settings, projectId: 16 });
  await assert.rejects(page.query().queryFn({}), /different board/);
});

test("private and legacy connections are visible; picker drafts keep installed IDs only and Cancel writes nothing", (t) => {
  const page = fixture(t);
  assert.match(page.text(), /acme\/private.*Private/);
  assert.match(page.text(), /acme\/legacy.*Legacy connection/);
  page.button("Choose repos").props.onClick();
  assert.deepEqual(page.picker().options.map((option) => option.id), ["456", "789", "999"]);
  assert.equal(page.picker().options[0].checked, true);
  page.choose("789");
  assert.equal(page.picker().options[1].checked, true);
  page.picker().onClose();
  page.button("Cancel").props.onClick();
  assert.equal(page.requests.length, 0);
  page.button("Choose repos").props.onClick();
  assert.equal(page.picker().options[1].checked, false);
});

test("Save replaces selected installed IDs with the original version; private repos stay allowed", async (t) => {
  const page = fixture(t);
  page.settings.available[0].isPrivate = true;
  page.button("Choose repos").props.onClick();
  page.choose("789");
  page.picker().onClose();
  await page.save();
  assert.equal(page.requests.length, 1);
  assert.equal(page.requests[0].url, "/api/projects/15/github");
  assert.equal(page.requests[0].method, "PUT");
  assert.deepEqual(JSON.parse(page.requests[0].body), { repositoryIds: ["456", "789"], version: "v1" });
  assert.deepEqual(page.cacheWrites[0].key, ["boardGithubSettings", 10, 15]);
  assert.match(page.messages.join(), /saved/);
});

test("another board’s repo cannot enter a draft", (t) => {
  const page = fixture(t);
  page.button("Choose repos").props.onClick();
  page.choose("999");
  assert.equal(page.picker().options.find((option) => option.id === "999").checked, false);
  assert.match(page.messages.join(), /another board/);
});

test("a non-installer admin can remove all repos without uninstalling the App", async (t) => {
  const page = fixture(t);
  page.settings.canConnect = false;
  page.settings.available = [];
  page.button("Choose repos").props.onClick();
  page.choose("456");
  page.picker().onClose();
  assert.equal(page.button("Choose repos").props.disabled, false);
  await page.save();
  assert.deepEqual(JSON.parse(page.requests[0].body), { repositoryIds: [], version: "v1" });
  assert.equal(page.requests[0].method, "PUT");
});

test("GitHub outage preserves connected repos and removal but blocks additions", async (t) => {
  const page = fixture(t);
  page.settings.githubUnavailable = true;
  page.button("Choose repos").props.onClick();
  page.choose("789");
  assert.equal(page.picker().options.find((option) => option.id === "789").checked, false);
  page.choose("456");
  page.picker().onClose();
  await page.save();
  assert.deepEqual(JSON.parse(page.requests[0].body).repositoryIds, []);
});

for (const [error, message] of [
  ["stale", /changed/], ["repo_on_other_board", /another board/],
  ["not_installer", /Only the person/], ["repo_not_installed", /no longer covers/],
  ["github_unavailable", /Nothing changed/], ["board_access_denied", /board GitHub admin/],
]) {
  test(`save error ${error} remains recoverable and never mutates the saved cache`, async (t) => {
    const page = fixture(t);
    page.button("Choose repos").props.onClick();
    page.choose("789");
    page.picker().onClose();
    page.reply(error === "github_unavailable" ? 503 : 409, { error });
    await page.save();
    assert.match(page.text(), message);
    assert.equal(page.cacheWrites.length, 0);
    page.button("Reload repositories").props.onClick();
    assert.equal(page.refetches(), 1);
    page.button("Choose repos").props.onClick();
    assert.equal(page.picker().options.find((option) => option.id === "789").checked, false);
  });
}

test("load errors and pending installation callbacks render a useful recovery state", (t) => {
  const failed = fixture(t, { error: new Error("Only a board GitHub admin can manage this connection.") });
  assert.match(failed.text(), /board GitHub admin/);
  failed.button("Reload repositories").props.onClick();
  assert.equal(failed.refetches(), 1);
  const pending = fixture(t, { query: "projectId=15&github_status=pending" });
  assert.match(pending.text(), /awaiting approval/);
  const denied = fixture(t, { query: "projectId=15&github_error=org_owner_required" });
  assert.match(denied.text(), /Check your GitHub permissions/);
});

test("flag Off excludes GitHub from the canonical search registry and remembered frequent/recent suggestions", () => {
  const { createJiti } = require("jiti");
  const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") } });
  const registry = jiti(path.join(root, "src/components/Modals/commands/HTC/AllCommands.ts"));
  const { CommandMode } = jiti(path.join(root, "src/models/enums.ts"));
  const source = ts.createSourceFile("commands.tsx", fs.readFileSync(path.join(root, "src/components/Modals/commands/HTC/commands.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let memo;
  const flags = {};
  const visit = (node) => {
    if (ts.isVariableDeclaration(node)) {
      if (node.name.getText() === "allCommands_") memo = node.initializer;
      if (node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText() === "useFlag") flags[node.name.getText()] = false;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(memo);
  const javascript = ts.transpileModule(`const result = ${memo.getText()};`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  for (const githubConnectEnabled of [false, true]) {
    const bindings = {
      ...registry, ...flags, CommandMode, githubConnectEnabled,
      hiddenGithubCommandKey: githubConnectEnabled ? null : "settingsGithub",
      hiddenBasetenCommandKey: "settingsApiKeysBasetenApiKey", hiddenXaiCommandKeys: "settingsApiKeysXaiApiKey settingsAiModelsXai",
      standalonePages: false, pathname: "/projects/project-15",
      useMemo: (callback) => callback(), getCommands: registry.getAllCommands,
      appShellRailOn: false, selectedTasksFirst: false, boardLayout: "board",
      calendarSettings: { showWeekends: true }, contextOptions: {},
      currentProject: { id: 15 }, projects: [], isMobile: false,
      pinCommentActions: false, pageActions: null, onAgentChat: false,
      onCalendar: false, onMyTasks: false, showByokApiKeys: false,
      isTicketPrefixCommandVisible: () => true,
      getActiveEmptySectionSettingFromProject: () => "Hidden",
      getActiveStalenessFromProject: () => false,
      getHTCFrecencyScore: (frequency) => frequency ?? 0,
      frequentlyUsed: { settingsGithub: { frequency: 100, lastUsedAt: Date.now() }, createTask: { frequency: 1, lastUsedAt: Date.now() } },
      DESTRUCTIVE_COMMAND_MODES: [CommandMode.DeleteBoard, CommandMode.DeleteColumn],
    };
    const groups = new Function(...Object.keys(bindings), `${javascript}; return result;`)(...Object.values(bindings));
    const all = groups.flatMap((group) => group.commandLists);
    assert.equal(all.some((command) => command.key === "settingsGithub"), githubConnectEnabled);
    assert.equal(groups.find((group) => group.group === "Frequently used").commandLists.some((command) => command.key === "settingsGithub"), githubConnectEnabled);
    assert.ok(all.some((command) => command.key === "createTask"), "Unrelated commands remain available");
  }
});
