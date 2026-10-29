const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { loadModule } = require("./helpers/loadModule.cjs");
const test = require("node:test");
const ts = require("typescript");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") } });
const navigation = jiti(path.join(root, "src/lib/inboxKeyboardNavigation.ts"));
const source = fs.readFileSync(path.join(root, "src/components/notifications/inboxSplit/index.tsx"), "utf8");
const tree = ts.createSourceFile("index.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate) {
  let found;
  function visit(node) {
    if (predicate(node)) found = node;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(found, "production entry point exists");
  return found;
}
const declaration = name => find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(tree) === name)).getText(tree);
const row = find(node => ts.isJsxOpeningElement(node) && node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === "onMouseEnter" && attribute.getText(tree).includes("handleMouseEnter(globalIndex)")));
const handler = name => {
  const attribute = row.attributes.properties.find(attribute => attribute.name?.getText(tree) === name);
  return attribute?.initializer?.expression?.getText(tree) ?? "() => {}";
};

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "htpr-8142-"));
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

function fixture(count, enabled = true) {
  const keys = Array.from({ length: count }, (_, i) => `notification-${i % Math.ceil(count / 5) === 0 ? "-" : ""}${i + 1}`);
  const keyboardRows = keys.map((key, notificationIndex) => ({ key, domId: key, item: { kind: "notification", notificationIndex } }));
  const context = {
    ...navigation,
    inboxKeyboardFocus: enabled, globalIndex: 0,
    value: 0, index: 0, isApple: false, controller: {},
    keyboardRows, selectedKeyboardRow: keyboardRows[0], selectedKeyboardNotificationIndex: 0,
    bulkHandleKeyDown: () => {}, returnIfModalOrInputActive: () => false,
    showCommands: { show: false }, classNamesToReturnFrom: [],
    document: { activeElement: {} }, Element: class {},
    KeyCodes: { G: 71, J: 74, K: 75, ARROW_DOWN: 40, ARROW_UP: 38 },
    activeSplitRef: { current: { querySelector: () => null } },
    setGlobalFocus: () => {},
    setActiveKeyboardRowKey: key => {
      context.selectedKeyboardRow = keyboardRows.find(row => row.key === key);
      context.selectedKeyboardNotificationIndex = context.selectedKeyboardRow.item.notificationIndex;
    },
    currentHoveredDiv: { current: null }, clearPrefetchHoverTimeout: () => {},
    prefetchHoverTimeout: { current: null }, setTimeout: () => 1,
    prefetchInboxTaskDetail: () => {}, debounceTimeout: { current: null },
  };
  const script = `module.exports = ({${Object.keys(context).join(",")}}) => {
    ${declaration("focusKeyboardRow")}
    ${declaration("handleMouseEnter")}
    ${declaration("handleKeyDown")}
    return { enter: ${handler("onMouseEnter")}, move: ${handler("onMouseMove")}, press: handleKeyDown, nestedEnter: handleMouseEnter };
  };`;
  const file = path.join(scratch, `dispatch-${count}-${enabled}.ts`);
  fs.writeFileSync(file, script);
  const render = loadModule(file);
  context.move = event => render(context).move(event);
  return {
    context, keys,
    async press(keyCode) { await render(context).press({ keyCode, preventDefault() {} }); },
    scrollUnderPointer(index) {
      context.globalIndex = index;
      render(context).enter();
      render(context).nestedEnter(index);
      context.move({ movementX: 0, movementY: 0 });
    },
  };
}

for (const count of [10, 200]) {
  test(`J/K visit all ${count} mixed rows once despite scroll-generated pointer entry`, async () => {
    const f = fixture(count);
    const forward = [f.context.selectedKeyboardRow.key];
    for (let i = 1; i < count; i++) {
      await f.press(74);
      f.scrollUnderPointer(Math.max(0, i - 2));
      forward.push(f.context.selectedKeyboardRow.key);
    }
    assert.deepEqual(forward, f.keys);
    const backward = [f.context.selectedKeyboardRow.key];
    for (let i = count - 2; i >= 0; i--) {
      await f.press(75);
      f.scrollUnderPointer(Math.min(count - 1, i + 2));
      backward.push(f.context.selectedKeyboardRow.key);
    }
    assert.deepEqual(backward, [...f.keys].reverse());
    assert.deepEqual(f.context.keyboardRows.map(row => row.key), f.keys);
    assert.equal(f.keys.filter(key => key.includes("--")).length, 5);
  });
}

test("real pointer movement still focuses a blocked row, on both axes", async () => {
  const f = fixture(10);
  await f.press(74);
  f.scrollUnderPointer(4);
  assert.equal(f.context.selectedKeyboardRow.key, f.keys[1]);
  f.context.move({ movementX: 1, movementY: 0 });
  assert.equal(f.context.selectedKeyboardRow.key, "notification--5");
  f.context.globalIndex = 6;
  f.context.move({ movementX: 0, movementY: -1 });
  assert.equal(f.context.selectedKeyboardRow.key, "notification--7");
});

test("flag off preserves the old mouse-enter focus", async () => {
  const f = fixture(10, false);
  await f.press(74);
  f.scrollUnderPointer(4);
  assert.equal(f.context.selectedKeyboardRow.key, "notification--5");
  f.context.globalIndex = 6;
  f.context.move({ movementX: 1, movementY: 0 });
  assert.equal(f.context.selectedKeyboardRow.key, "notification--5");
});

test("keyboard focus bugfix defaults to Everyone", () => {
  const { default: flag } = jiti(path.join(root, "src/lib/flags/definitions/htpr-8142-inbox-keyboard-focus.ts"));
  assert.equal(flag.key, "htpr-8142-inbox-keyboard-focus");
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
});
