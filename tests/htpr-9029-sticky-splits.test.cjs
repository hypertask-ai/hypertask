const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToString } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const stickyKey = "htpr-9029-sticky-splits";
const THIN_LINE = "shadow-[0_1px_0_0_var(--border-light-gray-thin)]";

function loadSplitTitlesContainer({ flagOn }) {
  const relative = "src/app/inbox/Inbox.tsx";
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  const tree = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let node;
  tree.forEachChild((statement) => {
    if (statement.declarationList?.declarations.some((item) => item.name.text === "SplitTitlesContainer")) node = statement;
  });
  assert.ok(node, "SplitTitlesContainer declaration found");
  const js = ts.transpileModule(`${node.getText(tree)}\nexports.component = SplitTitlesContainer;`, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  const dependencies = {
    ButtonGroup: () => null,
    useFlag: (key) => key === stickyKey && flagOn,
    useRef: React.useRef,
    useState: React.useState,
    useEffect: React.useEffect,
    HTPR_9029_STICKY_SPLITS_FLAG: stickyKey,
  };
  new Function("require", "exports", ...Object.keys(dependencies), js)(
    (name) => {
      assert.equal(name, "react/jsx-runtime");
      return require(name);
    },
    exports,
    ...Object.values(dependencies),
  );
  return exports.component;
}

function barClasses({ flagOn, contentGap }) {
  const SplitTitlesContainer = loadSplitTitlesContainer({ flagOn });
  const html = renderToString(React.createElement(SplitTitlesContainer, { contentGap }));
  const bar = new JSDOM(html).window.document.querySelector(".inbox_title");
  assert.ok(bar, "split bar rendered");
  return bar.className.split(/\s+/);
}

test("the flag is a feature that starts at Owner + QA", () => {
  const { default: flag, HTPR_9029_STICKY_SPLITS_FLAG: exported } = loadModule("src/lib/flags/definitions/htpr-9029-sticky-splits.ts");
  assert.equal(exported, stickyKey);
  assert.equal(flag.key, stickyKey);
  assert.equal(flag.kind, "feature");
  assert.equal(flag.defaultMode, "OWNER_AND_QA");
  assert.equal(flag.releaseRisk.risk, "new");
});

test("flag on: the split bar pins to the top with an opaque page background", () => {
  const withRail = barClasses({ flagOn: true, contentGap: true });
  for (const name of ["sticky", "top-0", "z-sticky", "bg-taskDetailPage"]) assert.ok(withRail.includes(name), name);
  assert.ok(!withRail.includes("relative"));
  const withoutRail = barClasses({ flagOn: true, contentGap: false });
  for (const name of ["sticky", "top-0", "z-sticky", "bg-containerBackground"]) assert.ok(withoutRail.includes(name), name);
});

test("the thin line shows only once the list is scrolled", () => {
  assert.ok(!barClasses({ flagOn: true, contentGap: true }).includes(THIN_LINE));
  const inbox = fs.readFileSync(path.join(root, "src/app/inbox/Inbox.tsx"), "utf8");
  assert.ok(inbox.includes("listScrolled ? \"shadow-[0_1px_0_0_var(--border-light-gray-thin)]\" : \"\""));
});

test("still allowed: flag off keeps today's non-sticky bar", () => {
  const classes = barClasses({ flagOn: false, contentGap: true });
  assert.ok(classes.includes("relative"));
  for (const name of ["sticky", "top-0", "z-sticky", "bg-taskDetailPage", "bg-containerBackground"]) assert.ok(!classes.includes(name), name);
});
