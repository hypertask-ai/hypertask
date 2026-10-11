const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const editor = read("src/app/page/[publicId]/PageEditor.tsx");
const palette = read("src/components/Modals/commands/HTC/commands.tsx");
const parse = (source) => ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const find = (source, predicate) => {
  let result;
  const visit = (node) => {
    if (!result && predicate(node)) result = node;
    if (!result) ts.forEachChild(node, visit);
  };
  visit(parse(source));
  assert.ok(result, "expected syntax node exists");
  return result;
};
const evaluate = (source, context = {}) => vm.runInNewContext(
  ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 } }).outputText,
  { React, ...context },
);
const row = find(editor, (node) => ts.isConditionalExpression(node) && node.condition.getText() === "mobilePageBackRowEnabled && isMobile" && node.whenTrue.getText().includes("<ArrowLeft"));
const mobileRow = row.whenTrue.getText();
const icon = (props) => React.createElement("svg", props);
const renderRow = (mobilePageBackRowEnabled, isMobile, statusText = "Saved") => renderToStaticMarkup(evaluate(`(${row.getText()})`, {
  mobilePageBackRowEnabled, isMobile, statusText, version: 7, isDeleting: false,
  returnToTask() {}, deletePage() {}, cn: (...c) => c.filter(Boolean).join(" "), MOBILE_TARGET: "min-h-[44px] min-w-[44px] shrink-0 flex items-center justify-center", ArrowLeft: icon, ChevronLeft: icon, Trash2: icon,
}));

const checkNoUtilityActions = (markup) => assert.doesNotMatch(markup, /Version|Delete|Trash2/);

test("the new flag is registered with the requested ship date and Owner + QA default", () => {
  assert.match(require("./helpers/flag-files.cjs").source(), /HTPR_6861_MOBILE_PAGE_BACK_ROW_FLAG\s*=\s*"htpr-6861-mobile-page-back-row"/);
  assert.match((read("src/lib/flags.ts") + require("./helpers/flag-files.cjs").source()), /key: HTPR_6861_MOBILE_PAGE_BACK_ROW_FLAG,\s*shippedOn: "2026-10-03",\s*description:/);
  assert.match((read("src/lib/flags.ts") + require("./helpers/flag-files.cjs").source()), /DEFAULT_FEATURE_FLAG_MODE[^=]*=\s*"OWNER_AND_QA"/);
  assert.match(editor, /useFlag\(HTPR_6861_MOBILE_PAGE_BACK_ROW_FLAG\)/);
});

test("the Settings-style row renders only with flag AND mobile, using the original return flow", () => {
  // Settings "Back to app" look, with the shared 44px phone target and 4px corners.
  assert.match(mobileRow, /MOBILE_TARGET,/);
  assert.match(mobileRow, /min-w-0 flex-1 justify-start gap-2 rounded-sm px-2 text-left text-content font-medium text-text-light-gray transition hover:bg-hover-active hover:text-white-black/);
  assert.match(mobileRow, /<ArrowLeft strokeWidth=\{1\.75\} className="h-4 w-4 shrink-0" \/>/);
  assert.match(mobileRow, /<span className="truncate">Back to task<\/span>/);
  assert.match(mobileRow, /onClick=\{\(\) => void returnToTask\(\)\}/);
  assert.match(mobileRow, /flex w-full items-center gap-2 px-2 pt-2/);
  for (const [enabled, mobile] of [[false, false], [true, false], [false, true]]) {
    assert.match(renderRow(enabled, mobile), /Version 7/);
    assert.doesNotMatch(renderRow(enabled, mobile), /min-w-0 flex-1/);
  }
  assert.match(renderRow(true, true), /min-h-\[44px\].*min-w-0 flex-1/);
});

test("flagged mobile row has only save status on the right, never Version or Delete", () => {
  assert.match(mobileRow, /shrink-0 pr-2 text-meta text-text-light-gray/);
  for (const status of ["Saved", "Saving…", "Save failed"]) {
    const markup = renderRow(true, true, status);
    checkNoUtilityActions(markup);
    assert.ok(markup.includes(status));
  }
  assert.throws(() => checkNoUtilityActions(renderRow(false, true)), assert.AssertionError);
});

test("desktop utility row source and rendered markup are unchanged regardless of flag", () => {
  const originalRow = row.whenFalse.expression.getText().replace(/\s+/g, " ");
  assert.equal(crypto.createHash("sha256").update(originalRow).digest("hex"), "1fb45da0e07789f68a8360772d7f9e2502aea3a9d040cf94f961d93b49e5ffe6");
  assert.equal(renderRow(true, false), renderRow(false, false));
});

test("title gets 16px side padding only on flagged mobile with desktop class byte-identical", () => {
  const input = find(editor, (node) => ts.isJsxSelfClosingElement(node) && node.tagName.getText() === "input");
  const className = input.attributes.properties.find((node) => node.name?.getText() === "className").initializer.expression.getText();
  const classes = (enabled, mobile) => evaluate(`(${className})`, { mobilePageBackRowEnabled: enabled, isMobile: mobile });
  assert.match(classes(true, true), /px-4 py-0/);
  for (const [enabled, mobile] of [[false, false], [true, false], [false, true]]) assert.match(classes(enabled, mobile), / p-0 /);
  assert.equal(classes(true, false), "w-full bg-transparent p-0 font-semibold leading-tight text-white-black outline-none placeholder:text-text-light-gray focus:ring-0 text-[32px]");
});

test("page actions are transient, published only on flagged mobile and use the existing confirmed delete", async () => {
  assert.match(read("src/store/currentPageActions.ts"), /default: null/);
  assert.match(editor, /if \(!mobilePageBackRowEnabled \|\| !isMobile\) return;/);
  assert.match(editor, /setCurrentPageActions\(\{ publicId: page.publicId, version, onDelete: deletePage \}\)/);
  assert.match(editor, /return \(\) => setCurrentPageActions\(null\)/);
  assert.match(editor, /\[deletePage, isMobile, mobilePageBackRowEnabled, page.publicId, setCurrentPageActions, version\]/);
  const callback = find(editor, (node) => ts.isVariableDeclaration(node) && node.name.getText() === "deletePage").initializer.arguments[0];
  let calls = 0;
  const runDelete = (confirm, isDeleting) => evaluate(`(${callback.getText()})()`, {
    isDeleting, window: { confirm: (message) => { assert.equal(message, "Delete this page?"); return confirm; } },
    setIsDeleting() {}, page: { publicId: "example" }, taskHref: "/detail/project-15/1",
    fetch: async (url, options) => { calls++; assert.equal(url, "/api/pages/example/archive"); assert.equal(options.method, "POST"); return { ok: true, json: async () => ({}) }; },
    toast: { success() {}, error() {} }, router: { push() {} }, console,
  });
  await runDelete(false, false);
  await runDelete(true, true);
  assert.equal(calls, 0);
  await runDelete(true, false);
  assert.equal(calls, 1);
});

test("This page group is first, single-action, and gated by flag, mobile and matching page route", () => {
  assert.match(palette, /useFlag\(HTPR_6861_MOBILE_PAGE_BACK_ROW_FLAG\)/);
  const guard = find(palette, (node) => ts.isVariableDeclaration(node) && node.name.getText() === "pageActions").initializer.getText();
  const prepend = find(palette, (node) => ts.isVariableDeclaration(node) && node.name.getText() === "rankedGroups" && node.initializer.getText().includes("This page")).initializer.getText();
  for (const [enabled, mobile, pathname, active] of [
    [true, true, "/page/example", true], [false, true, "/page/example", false],
    [true, false, "/page/example", false], [true, true, "/project/15", false],
    [true, true, "/page/stale", false], [true, true, "/page/example/other", false],
  ]) {
    const groups = evaluate(`const pageActions = ${guard}; const mobileGroups = [{group: "App", commandLists: []}]; (${prepend});`, {
      mobilePageBackRowEnabled: enabled, isMobile: mobile, pathname,
      currentPageActions: { publicId: "example", version: 9 }, CommandMode: { Command: "Command" },
    });
    assert.equal(groups.length, active ? 2 : 1);
    if (active) {
      assert.equal(groups[0].group, "This page (Version 9)");
      assert.equal(groups[0].commandLists.length, 1);
      assert.equal(groups[0].commandLists[0].name, "Delete page");
    }
  }
  assert.match(palette, /pinCommentActions,\s*pageActions,/);
});

test("Delete page dispatch closes Commands then invokes the page callback, never a task command", () => {
  const branch = find(palette, (node) => ts.isIfStatement(node) && node.expression.getText() === 'mobilePageBackRowEnabled && command.key === "deletePage"').getText();
  const calls = [];
  evaluate(`(() => { ${branch} })()`, { mobilePageBackRowEnabled: true, command: { key: "deletePage" }, pageActions: { onDelete: () => calls.push("delete") }, resetShowCommands: () => calls.push("close") });
  assert.deepEqual(calls, ["close", "delete"]);
  evaluate(`(() => { ${branch} })()`, { mobilePageBackRowEnabled: true, command: { key: "deletePage" }, pageActions: null, resetShowCommands: () => calls.push("unexpected") });
  assert.deepEqual(calls, ["close", "delete"]);
});
