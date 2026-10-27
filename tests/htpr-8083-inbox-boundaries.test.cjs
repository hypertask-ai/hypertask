const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") } });
const navigation = jiti(path.join(root, "src/lib/inboxKeyboardNavigation.ts"));
const source = fs.readFileSync(path.join(root, "src/components/notifications/inboxSplit/index.tsx"), "utf8");
const tree = ts.createSourceFile("index.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name) {
  let found;
  function visit(node) {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(tree) === name)) found = node.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(found, `production ${name} exists`);
  return found;
}

function fixture({ enabled = true, draft = false, empty = false } = {}) {
  const dom = new JSDOM('<main id="active"></main><main id="hidden"></main>');
  const notifications = empty ? [] : [{ id: "-41" }, { id: "12" }, { id: "-42" }];
  const keyboardRows = notifications.map((notification, notificationIndex) => ({
    key: `notification-${notification.id}`, domId: `inbox-${notification.id}`,
    item: { kind: "notification", notification, notificationIndex },
  })).reverse();
  if (draft) keyboardRows.unshift({ key: "draft-9", domId: "inbox-draft-9", item: { kind: "draft" } });
  const scrolls = [], focus = [], indexes = [];
  const active = dom.window.document.getElementById("active");
  for (const split of [active, dom.window.document.getElementById("hidden")]) {
    for (const row of keyboardRows) {
      const element = dom.window.document.createElement("div");
      element.id = row.domId;
      element.scrollIntoView = options => scrolls.push({ split: split.id, id: row.domId, ...options });
      split.append(element);
    }
  }
  const context = {
    Element: dom.window.Element, document: dom.window.document, Date,
    setTimeout: () => 0, inboxBoundaryOrder: enabled,
    _notifications: notifications, keyboardRows,
    value: 0, index: 0, isApple: false, controller: { 71: { pressed: false } },
    selectedKeyboardNotificationIndex: null, bulkHandleKeyDown: () => {},
    returnIfModalOrInputActive: () => false, showCommands: { show: false },
    classNamesToReturnFrom: [], lastgClick: { current: null },
    inboxConfig: { interactions: { keyboard: { gKeyDelayMs: 500 } } },
    KeyCodes: { G: 71, T: 84, D: 68, U: 85 },
    activeSplitRef: { current: active }, jumpToInboxBoundary: navigation.jumpToInboxBoundary,
    setActiveKeyboardRowKey: key => focus.push(key),
    setGlobalFocus: update => indexes.push(update({ currIdx: 1 }).currIdx),
  };
  const script = `${declaration("focusKeyboardRow")}\n${declaration("handleKeyDown")}\nglobalThis.handle = handleKeyDown;`;
  vm.runInNewContext(ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const gg = async shiftKey => {
    for (let i = 0; i < 2; i++) await context.handle({ keyCode: 71, shiftKey, target: active, preventDefault() {} });
  };
  return { gg, focus, indexes, scrolls, keyboardRows, dom };
}

for (const toEnd of [false, true]) {
  test(`${toEnd ? "Shift+gg" : "gg"} follows rendered blocked-row order and scrolls only the active split`, async () => {
    const f = fixture();
    try {
      await f.gg(toEnd);
      const expected = toEnd ? "notification--41" : "notification--42";
      assert.deepEqual(f.focus, [expected]);
      assert.deepEqual(f.indexes, [toEnd ? 0 : 2]);
      assert.deepEqual(f.scrolls, [{ split: "active", id: toEnd ? "inbox--41" : "inbox--42", behavior: "smooth", block: "center" }]);
      assert.deepEqual(f.keyboardRows.map(row => row.key), ["notification--42", "notification-12", "notification--41"]);
    } finally { f.dom.window.close(); }
  });
}

test("gg includes a draft at the displayed boundary", async () => {
  const f = fixture({ draft: true });
  try {
    await f.gg(false);
    assert.deepEqual(f.focus, ["draft-9"]);
    assert.deepEqual(f.indexes, []);
    assert.equal(f.scrolls[0].id, "inbox-draft-9");
  } finally { f.dom.window.close(); }
});

test("empty inbox boundary shortcuts do nothing", async () => {
  const f = fixture({ empty: true });
  try {
    await f.gg(false); await f.gg(true);
    assert.deepEqual(f.focus, []); assert.deepEqual(f.scrolls, []);
  } finally { f.dom.window.close(); }
});

test("flag off keeps the previous raw notification boundary", async () => {
  const f = fixture({ enabled: false });
  try {
    await f.gg(false);
    assert.deepEqual(f.focus, ["notification--41"]);
    assert.equal(f.scrolls[0].id, "inbox--41");
  } finally { f.dom.window.close(); }
});

test("boundary bugfix defaults to Everyone", () => {
  const { default: definition } = jiti(path.join(root, "src/lib/flags/definitions/htpr-8083-inbox-boundaries.ts"));
  assert.equal(definition.key, "htpr-8083-inbox-boundaries");
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
});
