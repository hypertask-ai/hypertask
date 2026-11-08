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
const inboxSource = fs.readFileSync(path.join(root, "src/app/inbox/Inbox.tsx"), "utf8");
const splitSource = fs.readFileSync(
  path.join(root, "src/components/notifications/inboxSplit/index.tsx"),
  "utf8",
);
const tree = ts.createSourceFile("index.tsx", splitSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

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

const declaration = (name) =>
  find(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some((d) => d.name.getText(tree) === name),
  ).getText(tree);

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "htpr-8868-"));
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

function fixture({ resumes, focusedIndex = 0, count = 6 }) {
  const keys = Array.from({ length: count }, (_, i) => `notification-${i + 1}`);
  const keyboardRows = keys.map((key, notificationIndex) => ({
    key,
    domId: key,
    item: { kind: "notification", notificationIndex },
  }));
  const context = {
    ...navigation,
    value: 0,
    index: 0,
    isApple: false,
    controller: {},
    Element: class {},
    keyboardRows,
    keyboardNavigationStarted: resumes,
    selectedKeyboardNotificationIndex: null,
    selectedKeyboardRow: keyboardRows[focusedIndex],
    bulkHandleKeyDown: () => {},
    returnIfModalOrInputActive: () => false,
    showCommands: { show: false },
    classNamesToReturnFrom: [],
    document: { activeElement: {} },
    KeyCodes: { G: 71, J: 74, K: 75, ARROW_DOWN: 40, ARROW_UP: 38 },
    activeSplitRef: { current: { querySelector: () => null } },
    scrollToCenterIfNearTop: () => {},
    scrollToCenterIfNearBottom: () => {},
    currentHoveredDiv: { current: null },
    prefetchHoverTimeout: { current: null },
    debounceTimeout: { current: null },
    clearPrefetchHoverTimeout: () => {},
    prefetchInboxTaskDetail: () => {},
    setTimeout: () => 1,
    setGlobalFocus: () => {},
    setKeyboardNavigationStarted: (started) => {
      context.keyboardNavigationStarted = started === undefined ? true : started;
    },
    setActiveKeyboardRowKey: (key) => {
      context.selectedKeyboardRow = keyboardRows.find((row) => row.key === key);
    },
  };
  const script = `module.exports = ({${Object.keys(context).join(",")}}) => {
    ${declaration("focusKeyboardRow")}
    ${declaration("handleMouseEnter")}
    ${declaration("handleKeyDown")}
    return { press: handleKeyDown, hover: handleMouseEnter };
  };`;
  const file = path.join(scratch, `first-key-${resumes}-${count}-${focusedIndex}.ts`);
  fs.writeFileSync(file, script);
  const render = loadModule(file);
  return {
    context,
    keys,
    async press(keyCode) {
      await render(context).press({ keyCode, preventDefault() {} });
    },
    hover(index) {
      render(context).hover(index, { movementX: 1, movementY: 0 });
    },
  };
}

test("the first J after opening the inbox focuses the first row", async () => {
  const f = fixture({ resumes: false });
  await f.press(74);
  assert.equal(f.context.selectedKeyboardRow.key, f.keys[0]);
});

test("J then follows the displayed order from the first row", async () => {
  const f = fixture({ resumes: false });
  const visited = [];
  for (let i = 0; i < f.keys.length; i++) {
    await f.press(74);
    visited.push(f.context.selectedKeyboardRow.key);
  }
  assert.deepEqual(visited, f.keys);
});

test("the first K after opening the inbox also stays on the first row", async () => {
  const f = fixture({ resumes: false });
  await f.press(75);
  assert.equal(f.context.selectedKeyboardRow.key, f.keys[0]);
});

test("an arrow key after opening the inbox focuses the first row too", async () => {
  const f = fixture({ resumes: false });
  await f.press(40);
  assert.equal(f.context.selectedKeyboardRow.key, f.keys[0]);
});

test("a resumed inbox steps on from its restored row", async () => {
  const f = fixture({ resumes: true, focusedIndex: 3 });
  await f.press(74);
  assert.equal(f.context.selectedKeyboardRow.key, f.keys[4]);
});

test("hovering a row before the first J keeps J moving down from it", async () => {
  const f = fixture({ resumes: false });
  f.hover(2);
  assert.equal(f.context.selectedKeyboardRow.key, f.keys[2]);
  await f.press(74);
  assert.equal(f.context.selectedKeyboardRow.key, f.keys[3]);
});

test("a fresh G then I ignores the row the last inbox visit stopped on", () => {
  assert.deepEqual(navigation.resolveInboxOpeningPosition({ lastIndex: 12 }), {
    index: 0,
    resumes: false,
  });
});

test("a fresh G then I starts at the top even when a split link is open", () => {
  assert.deepEqual(
    navigation.resolveInboxOpeningPosition({ split: "Agents", lastIndex: 0 }),
    { index: 0, resumes: false },
  );
});

test("coming back to a named split keeps the row the reader stopped on", () => {
  assert.deepEqual(
    navigation.resolveInboxOpeningPosition({ split: "Important", lastIndex: 7 }),
    { index: 7, resumes: true },
  );
  assert.deepEqual(
    navigation.resolveInboxOpeningPosition({ projectId: "15", lastIndex: 3 }),
    { index: 3, resumes: true },
  );
});

test("unusable saved indexes fall back to the top", () => {
  for (const lastIndex of [undefined, null, Number.NaN, -4, 2.7]) {
    const opening = navigation.resolveInboxOpeningPosition({ split: "Agents", lastIndex });
    assert.equal(opening.index, lastIndex === 2.7 ? 2 : 0);
  }
});

test("the inbox page hands the resolved opening position to its split", () => {
  assert.match(inboxSource, /resolveInboxOpeningPosition\(/);
  assert.match(inboxSource, /inboxFirstRow\s*\?/);
  assert.match(inboxSource, /resumesPosition=\{inboxOpening\.resumes && inboxTab === openingTab\}/);
  assert.match(splitSource, /resumesPosition\?: boolean/);
  assert.match(splitSource, /keyboardNavigationStarted/);
});

test("the new first-row behaviour ships behind its own bugfix flag", () => {
  const { default: flag } = jiti(
    path.join(root, "src/lib/flags/definitions/htpr-8868-inbox-first-row.ts"),
  );
  assert.equal(flag.key, "htpr-8868-inbox-first-row");
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
  assert.match(splitSource, /HTPR_8868_INBOX_FIRST_ROW_FLAG/);
  assert.match(inboxSource, /HTPR_8868_INBOX_FIRST_ROW_FLAG/);
});
