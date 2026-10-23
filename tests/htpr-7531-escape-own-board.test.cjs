const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const hookFile = "src/hooks/Task Detail/useTaskDetailGlobalStates.ts";
const source = ts.createSourceFile(hookFile, read(hookFile), ts.ScriptTarget.Latest, true);
let backHandler;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "onGoback") backHandler = node.initializer.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(backHandler, "exercise the real shared back-arrow handler");
const compile = (text) => ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;

function fixture(previous, { enabled = true, length = 4, navigation = true, projectId = 15, throws = false } = {}) {
  const calls = [];
  const task = { id: 66596, projectId, uniqueIndex: 7539, section: "Done" };
  const window = {
    location: { origin: "https://app.hypertask.ai" },
    history: { length },
    navigation: navigation ? {
      entries: () => {
        if (throws) throw new Error("Navigation API unavailable");
        return [{ url: previous }, { url: `https://app.hypertask.ai/detail/project-${projectId}/7539` }];
      },
      currentEntry: { index: 1 },
    } : undefined,
  };
  const bindings = {
    window,
    console: { log: () => {} },
    currentTask: task,
    currentItemInTasksPlaylist: task,
    tasksPlayList: [{ projectId, uniqueIndex: 1 }, task],
    setInboxTaskIndexAtom: (index) => calls.push(["inboxIndex", index]),
    setSearchTaskIndexAtom: (index) => calls.push(["searchIndex", index]),
    setArchivedTaskIndexAtom: (index) => calls.push(["archiveIndex", index]),
    updateActiveItemAndItemInView: (id) => calls.push(["active", id]),
    navigate: (...args) => calls.push(args),
    escapeOwnBoard: enabled,
  };
  const exports = {};
  new Function("exports", ...Object.keys(bindings), compile(`exports.onGoback = ${backHandler};`))(exports, ...Object.values(bindings));
  return { back: exports.onGoback, calls, navigations: () => calls.filter(([kind]) => kind === "Back" || kind === "Push") };
}

for (const previous of ["/project", "/project?view=done", "/project?id=", "/project?id=null", "/project?id=undefined", "/project?id=0", "/project?id=-1", "/project?id=339", "/project-339", "/project-339?id=15"]) {
  test(`Done ticket returns to its own board rather than cookie-dependent/different board ${previous}`, () => {
    const f = fixture("https://app.hypertask.ai" + previous);
    f.back();
    assert.deepEqual(f.navigations(), [["Push", "/project?id=15"]]);
    for (const name of ["inboxIndex", "searchIndex", "archiveIndex"]) assert.ok(f.calls.some(([kind, index]) => kind === name && index === 1));
    assert.ok(f.calls.some(([kind, id]) => kind === "active" && id === 66596));
  });
}

for (const previous of ["/project?id=15&view=done#task-66596", "/project-15?view=done", "/search?q=escape&board=339", "/inbox?split=0&project=339", "/archived?inbox=true", "/my-tasks", "/detail/project-15/7391"]) {
  test(`preserves the actual history destination ${previous}`, () => {
    const f = fixture("https://app.hypertask.ai" + previous);
    f.back();
    assert.deepEqual(f.navigations(), [["Back"]]);
  });
}

test("the destination comes from the ticket, not a fixed board number", () => {
  const f = fixture("https://app.hypertask.ai/project?id=15", { projectId: 912 });
  f.back();
  assert.deepEqual(f.navigations(), [["Push", "/project?id=912"]]);
});

test("flag off keeps the original bare-board and legacy-board behavior", () => {
  for (const previous of ["/project", "/project-339"]) {
    const f = fixture("https://app.hypertask.ai" + previous, { enabled: false });
    f.back();
    assert.deepEqual(f.navigations(), [["Back"]]);
  }
  const f = fixture("https://app.hypertask.ai/project?id=339", { enabled: false });
  f.back();
  assert.deepEqual(f.navigations(), [["Push", "/project?id=15"]]);
});

test("short history still opens the ticket's own board", () => {
  const f = fixture("https://app.hypertask.ai/search?q=escape", { length: 2 });
  f.back();
  assert.deepEqual(f.navigations(), [["Push", "/project?id=15"]]);
});

test("unavailable history inspection and cross-origin entries retain existing behavior", () => {
  for (const options of [{ navigation: false }, { throws: true }, {}]) {
    const f = fixture("https://example.test/project?id=339", options);
    f.back();
    assert.deepEqual(f.navigations(), [["Back"]]);
  }
});

test("Escape dispatches the same corrected back-arrow handler", (t) => {
  const f = fixture("https://app.hypertask.ai/project");
  const previousDocument = global.document;
  const config = require("jiti").createJiti(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true })(path.join(root, "src/lib/configs/taskDetail.config.ts"));
  const document = {
    activeElement: { tagName: "BODY", className: "", closest: () => null },
    querySelector: () => null,
    getElementById: (id) => id === config.default.elementIds.taskDetailPageBackButton ? { click: f.back } : null,
  };
  global.document = document;
  t.after(() => { if (previousDocument === undefined) delete global.document; else global.document = previousDocument; });
  const mocks = {
    "@/lib/configs/taskDetail.config": { __esModule: true, default: config.default },
    "@/lib/snippets": { requestCommentSnippetPicker: () => {} },
    "@/lib/constants/keyboard-handler": { KeyCodes: { ESCAPE: 27, O: 79 } },
    "./taskDetailEditingKeymap": { taskDetailEditingKeymap: () => [] },
    "./taskDetailNavigationKeymap": { taskDetailNavigationKeymap: () => [] },
  };
  const exports = {};
  new Function("require", "exports", compile(read("src/app/detail/[...slug]/taskDetailKeyboard.ts")))(name => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, exports);
  const keyboard = exports.createTaskDetailKeyboard({
    currentTask: { id: 66596, projectId: 15 }, activeModals: [], showCommands: { show: false },
    controller: {}, resetShowCommands: () => {}, setShowDropdown: () => {},
  });
  keyboard.handleKeyDown({ key: "Escape", keyCode: 27 });
  assert.deepEqual(f.navigations(), [["Push", "/project?id=15"]]);
});

test("the ticket-specific flag is a low-risk bugfix on for Everyone", () => {
  const { default: definition, HTPR_7531_ESCAPE_OWN_BOARD_FLAG: key } = require("./helpers/flag-files.cjs").load("src/lib/flags/definitions/htpr-7531-escape-own-board.ts");
  assert.equal(key, "htpr-7531-escape-own-board");
  assert.equal(definition.key, key);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.match(read(hookFile), /useFlag\(HTPR_7531_ESCAPE_OWN_BOARD_FLAG\)/);
});
