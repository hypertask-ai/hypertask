const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function load(file, mocks = {}, source = read(file)) {
  const loaded = { exports: {} };
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    fileName: file,
  }).outputText;
  new Function("require", "module", "exports", "window", js)((name) => {
    assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency ${name}`);
    return mocks[name];
  }, loaded, loaded.exports, { setTimeout: () => 1, clearTimeout: () => {} });
  return loaded.exports;
}

const flagFile = "src/lib/flags/definitions/htpr-5906-no-phone-nudges.ts";
const flag = load(flagFile);
const nudges = load("src/lib/notifications/archiveShortcutNudge.ts");
const mobileContext = {};
const atoms = { archiveShortcutNudgeAtom: "nudge", currentUserAtom: "user" };
const originalFlag = "htpr-5906-shortcut-nudges";
const useFlag = (enabled) => (key) => {
  assert.ok([originalFlag, flag.HTPR_5906_NO_PHONE_NUDGES_FLAG].includes(key));
  return key === originalFlag || enabled;
};
const useContext = (phone) => (context) => {
  assert.equal(context, mobileContext);
  return phone;
};

function view(initial, { phone = false, enabled = true, pathname = "/detail/project-15/5906" } = {}) {
  let state = initial;
  const effects = [];
  const jsx = (type, props) => ({ type, props });
  const Component = load("src/components/Global/ShortcutArchiveNudge.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: { useContext: useContext(phone), useEffect: (effect) => effects.push(effect) },
    "lucide-react": { X: "close" },
    "next/navigation": { usePathname: () => pathname },
    "@/lib/state": {
      useRecoilValue: () => ({ id: 6 }),
      useRecoilState: (atom) => {
        assert.equal(atom, atoms.archiveShortcutNudgeAtom);
        return [state, (next) => { state = next(state); }];
      },
    },
    "@/store": atoms,
    "@/hooks/useFlag": { useFlag: useFlag(enabled) },
    "@/lib/flags/keys": { SHORTCUT_NUDGES_FLAG: originalFlag },
    "@/lib/flags/definitions/htpr-5906-no-phone-nudges": flag,
    "@/hooks/useShortcutTipsSetting": { useShortcutTipsSetting: () => ({ tipsEnabled: true, turnOffAllTips: () => {} }) },
    "@/lib/contexts/mobileContext": { MobileViewContext: mobileContext },
    "@/lib/configs/general.config": { MOBILE_TARGET: "phone-target" },
    "@/lib/notifications/archiveShortcutNudge": nudges,
  }).default;
  return {
    state: () => state,
    render: () => {
      const result = Component();
      effects.splice(0).forEach((effect) => effect());
      return result;
    },
  };
}

const inboxFile = "src/components/notifications/inboxSplit/index.tsx";
const inboxSource = ts.createSourceFile(inboxFile, read(inboxFile), ts.ScriptTarget.Latest, true);
function initializer(name) {
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(inboxSource) === name) found = node.initializer.getText(inboxSource);
    ts.forEachChild(node, visit);
  }
  visit(inboxSource);
  assert.ok(found, `Exercise the real inbox ${name}`);
  return found;
}
const archiveFactory = ["isMbl", "shortcutNudgesEnabled", "noPhoneNudges"].map((name) => `const ${name} = ${initializer(name)};`).join("\n");
const archiveSource = `module.exports = (bindings) => {
  const { useContext, MobileViewContext, useFlag, SHORTCUT_NUDGES_FLAG, HTPR_5906_NO_PHONE_NUDGES_FLAG,
    selectedIdsArray, lastgClick, _notifications, selectedKeyboardRow, currentUser, tipsEnabled,
    setArchiveNudge, clearArchiveShortcutNudge, markAsDone, index, toast, recordArchiveShortcutAction } = bindings;
  ${archiveFactory}
  return ${initializer("eHandler")};
};`;
const createArchiveHandler = load(inboxFile, {}, archiveSource);

function inbox({ phone = false, enabled = true, initial = nudges.EMPTY_ARCHIVE_SHORTCUT_NUDGE, succeeded = true } = {}) {
  let state = initial;
  let archives = 0;
  let isPhone = phone;
  return {
    state: () => state,
    archives: () => archives,
    desktop: () => { isPhone = false; },
    archive: (source = "mouse") => createArchiveHandler({
      useContext: useContext(isPhone), MobileViewContext: mobileContext,
      useFlag: useFlag(enabled), SHORTCUT_NUDGES_FLAG: originalFlag,
      HTPR_5906_NO_PHONE_NUDGES_FLAG: flag.HTPR_5906_NO_PHONE_NUDGES_FLAG,
      selectedIdsArray: [], lastgClick: { current: null }, _notifications: [{ id: 1 }],
      selectedKeyboardRow: null, currentUser: { id: 6 }, tipsEnabled: true, index: 0,
      setArchiveNudge: (next) => { state = next(state); },
      clearArchiveShortcutNudge: nudges.clearArchiveShortcutNudge,
      recordArchiveShortcutAction: nudges.recordArchiveShortcutAction,
      markAsDone: async () => { archives += 1; return succeeded; },
      toast: { error: (message) => assert.fail(message) },
    })(false, 0, source),
  };
}

const cleared = { accountId: 6, mouseArchives: 0, stage: "counting", hideAt: null };

test("phones hide and discard counting, queued, and already showing tips; desktop still renders", () => {
  for (const initial of [
    { ...cleared, mouseArchives: 2 },
    { ...cleared, stage: "pending" },
    { ...cleared, stage: "showing", hideAt: Date.now() + 8_000 },
  ]) {
    const phone = view(initial, { phone: true });
    assert.equal(phone.render(), null);
    assert.deepEqual(phone.state(), cleared);
    assert.equal(phone.render(), null);
    const desktop = view(initial);
    desktop.render();
    if (initial.stage !== "counting") assert.equal(desktop.render().type, "div");
  }
});

test("phone archives still work but cannot earn or queue a tip when moving to desktop", async () => {
  const phone = inbox({ phone: true, initial: { ...cleared, mouseArchives: 2 } });
  for (let i = 0; i < 3; i += 1) {
    await phone.archive();
    assert.deepEqual(phone.state(), cleared);
  }
  assert.equal(phone.archives(), 3);
  phone.desktop();
  assert.equal(view(phone.state()).render(), null);
  await phone.archive();
  assert.deepEqual(phone.state(), { ...cleared, mouseArchives: 1 });
  await phone.archive();
  assert.deepEqual(phone.state(), { ...cleared, mouseArchives: 2 });
  await phone.archive();
  assert.deepEqual(phone.state(), { ...cleared, stage: "pending" });
  const desktop = view(phone.state());
  assert.equal(desktop.render(), null);
  assert.equal(desktop.render().type, "div");
  assert.equal(desktop.state().stage, "showing");
});

test("desktop still earns the tip after exactly three successful mouse archives", async () => {
  const desktop = inbox();
  await desktop.archive();
  assert.deepEqual(desktop.state(), { ...cleared, mouseArchives: 1 });
  await desktop.archive();
  assert.deepEqual(desktop.state(), { ...cleared, mouseArchives: 2 });
  await desktop.archive();
  assert.deepEqual(desktop.state(), { ...cleared, stage: "pending" });
  const tip = view(desktop.state());
  tip.render();
  assert.equal(tip.render().type, "div");
  assert.equal(tip.state().stage, "showing");
});

test("failed, swipe, and keyboard archives still do not earn tips", async () => {
  for (const options of [{ succeeded: false }, {}]) {
    const desktop = inbox(options);
    for (const source of options.succeeded === false ? ["mouse", "mouse", "mouse"] : ["swipe", "keyboard", "swipe"]) await desktop.archive(source);
    assert.deepEqual(desktop.state(), cleared);
    assert.equal(desktop.archives(), 3);
  }
});

test("flag off restores phone counting and display", async () => {
  const phone = inbox({ phone: true, enabled: false });
  await phone.archive();
  assert.deepEqual(phone.state(), { ...cleared, mouseArchives: 1 });
  await phone.archive();
  await phone.archive();
  assert.deepEqual(phone.state(), { ...cleared, stage: "pending" });
  const tip = view(phone.state(), { phone: true, enabled: false });
  tip.render();
  assert.equal(tip.render().type, "div");
  assert.equal(tip.state().stage, "showing");
});

test("phone visits to the inbox clear a queued tip before returning to desktop", () => {
  const phone = view({ ...cleared, stage: "pending" }, { phone: true, pathname: "/inbox" });
  assert.equal(phone.render(), null);
  assert.deepEqual(phone.state(), cleared);
  const desktop = view(phone.state());
  assert.equal(desktop.render(), null);
  assert.deepEqual(desktop.state(), cleared);
});

test("bugfix flag defaults to Everyone with a release-risk reason and matching smoke mode", () => {
  assert.equal(flag.default.key, "htpr-5906-no-phone-nudges");
  assert.equal(flag.default.kind, "bugfix");
  assert.equal(flag.default.defaultMode, "EVERYONE");
  assert.equal(flag.default.releaseRisk.risk, "small");
  assert.ok(flag.default.releaseRisk.reason);
  assert.equal(JSON.parse(read("e2e/smoke/production-flag-modes.json")).modes[flag.default.key], "EVERYONE");
});
