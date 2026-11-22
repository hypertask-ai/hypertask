const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToString } = require("react-dom/server");
const ts = require("typescript");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const flagKey = "htpr-9071-inbox-zero-image";

function loadSplitTabs(hideOnInboxZero) {
  const relative = "src/app/inbox/Inbox.tsx";
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  const tree = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let node;
  function visit(statement) {
    if (statement.declarationList?.declarations.some((item) => item.name.text === "SplitTabsUnlessInboxZero")) {
      node = statement;
    }
    if (!node) ts.forEachChild(statement, visit);
  }
  visit(tree);
  assert.ok(node, "Missing production declaration SplitTabsUnlessInboxZero");
  const js = ts.transpileModule(`${node.getText(tree)}\nexports.component = SplitTabsUnlessInboxZero;`, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  const dependencies = {
    useFlag: (key) => {
      assert.equal(key, flagKey);
      return hideOnInboxZero;
    },
    HTPR_9071_INBOX_ZERO_IMAGE_FLAG: flagKey,
  };
  new Function("require", "exports", "useFlag", "HTPR_9071_INBOX_ZERO_IMAGE_FLAG", js)(
    (name) => {
      if (name === "react/jsx-runtime") return require(name);
      throw new Error(`Unexpected dependency ${name}`);
    },
    exports,
    dependencies.useFlag,
    dependencies.HTPR_9071_INBOX_ZERO_IMAGE_FLAG,
  );
  return exports.component;
}

function tabs(hideOnInboxZero, isInboxZero, splitLengths = [0], unsavedCommentDrafts = 0) {
  const SplitTabsUnlessInboxZero = loadSplitTabs(hideOnInboxZero);
  return renderToString(React.createElement(
    SplitTabsUnlessInboxZero,
    { isInboxZero, splitLengths, unsavedCommentDrafts },
    React.createElement("div", { "data-testid": "inbox-split-titles" }, "All"),
  ));
}

function showsAll(html) {
  assert.match(html, /All/);
  assert.match(html, /data-testid="inbox-split-titles"/);
}

test("the flag is a bugfix that starts on for everyone", () => {
  const { default: flag, HTPR_9071_INBOX_ZERO_IMAGE_FLAG: exported } = loadModule(
    "src/lib/flags/definitions/htpr-9071-inbox-zero-image.ts",
  );
  assert.equal(exported, flagKey);
  assert.equal(flag.key, flagKey);
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
});

test("an empty inbox drops the split tabs, and an inbox with items keeps them", () => {
  const empty = tabs(true, true, [0], 0);
  assert.equal(empty.includes("All"), false);
  assert.equal(empty.includes("inbox-split-titles"), false);

  showsAll(tabs(true, false, [4], 0));
  showsAll(tabs(false, true, [0], 0));
  showsAll(tabs(false, false, [4], 0));
});

test("an empty split keeps the tabs when another split or a draft still has something", () => {
  showsAll(tabs(true, true, [0, 2], 0));
  showsAll(tabs(true, true, [0, 0], 1));
  showsAll(tabs(true, true, [], 0));

  const everySplitEmpty = tabs(true, true, [0, 0], 0);
  assert.equal(everySplitEmpty.includes("All"), false);
});
