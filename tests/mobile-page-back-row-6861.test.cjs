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
const row = find(editor, (node) => ts.isConditionalExpression(node) && node.condition.getText() === "isMobile" && node.whenTrue.getText().includes("<ArrowLeft"));
const mobileRow = row.whenTrue.getText();
const icon = (props) => React.createElement("svg", props);
const renderRow = (isMobile, statusText = "Saved") => renderToStaticMarkup(evaluate(`(${row.getText()})`, {
  isMobile, statusText, backLabel: "Back to task", version: 7, isDeleting: false,
  returnToTask() {}, deletePage() {}, cn: (...c) => c.filter(Boolean).join(" "), MOBILE_TARGET: "min-h-[44px] min-w-[44px] shrink-0 flex items-center justify-center", ArrowLeft: icon, ChevronLeft: icon, Trash2: icon,
}));

const checkNoUtilityActions = (markup) => assert.doesNotMatch(markup, /Version|Delete|Trash2/);

test("the Settings-style row renders only on mobile, using the original return flow", () => {
  assert.match(mobileRow, /MOBILE_TARGET,/);
  assert.match(mobileRow, /min-w-0 flex-1 justify-start gap-2 rounded-sm px-2 text-left text-content font-medium text-text-light-gray transition hover:bg-hover-active hover:text-white-black/);
  assert.match(mobileRow, /<ArrowLeft strokeWidth=\{1\.75\} className="h-4 w-4 shrink-0" \/>/);
  assert.match(mobileRow, /<span className="truncate">\{backLabel\}<\/span>/);
  assert.match(mobileRow, /onClick=\{\(\) => void returnToTask\(\)\}/);
  assert.match(mobileRow, /flex w-full items-center gap-2 px-2 pt-2/);
  assert.match(renderRow(false), /Version 7/);
  assert.doesNotMatch(renderRow(false), /min-w-0 flex-1/);
  assert.match(renderRow(true), /min-h-\[44px\].*min-w-0 flex-1/);
});

test("mobile row has only save status on the right, never Version or Delete", () => {
  assert.match(mobileRow, /shrink-0 pr-2 text-meta text-text-light-gray/);
  for (const status of ["Saved", "Saving…", "Save failed"]) {
    const markup = renderRow(true, status);
    checkNoUtilityActions(markup);
    assert.ok(markup.includes(status));
  }
  assert.throws(() => checkNoUtilityActions(renderRow(false)), assert.AssertionError);
});

test("desktop utility row source is unchanged and still shows Version and Delete", () => {
  const originalRow = row.whenFalse.expression.getText().replace("{backLabel}", "Back to task").replace(/\s+/g, " ");
  assert.equal(crypto.createHash("sha256").update(originalRow).digest("hex"), "1fb45da0e07789f68a8360772d7f9e2502aea3a9d040cf94f961d93b49e5ffe6");
  assert.match(renderRow(false), /Version 7.*Delete/);
});

test("title gets 16px side padding only on mobile with desktop class byte-identical", () => {
  const input = find(editor, (node) => ts.isJsxSelfClosingElement(node) && node.tagName.getText() === "input");
  const className = input.attributes.properties.find((node) => node.name?.getText() === "className").initializer.expression.getText();
  const classes = (mobile) => evaluate(`(${className})`, { isMobile: mobile });
  assert.match(classes(true), /px-4 py-0/);
  assert.equal(classes(false), "w-full bg-transparent p-0 font-semibold leading-tight text-white-black outline-none placeholder:text-text-light-gray focus:ring-0 text-[32px]");
});

test("page actions are transient, with desktop navigation only behind Pages, using the existing confirmed delete", async () => {
  assert.match(read("src/store/currentPageActions.ts"), /default: null/);
  const publish = find(editor, (node) => ts.isCallExpression(node) && node.expression.getText() === "useEffect" && node.arguments[0]?.getText().includes("setCurrentPageActions(")).arguments[0];
  const deletePage = () => {};
  const flushPendingSaves = async () => {};
  for (const isMobile of [false, true]) {
    for (const pagesEnabled of [false, true]) {
      const updates = [];
      const cleanup = evaluate(`(${publish.getText()})()`, {
        isMobile, pagesEnabled, standalonePages: true, page: { publicId: "example" }, version: 7,
        deletePage, flushPendingSaves, setCurrentPageActions: (value) => updates.push(value),
      });
      if (!isMobile && !pagesEnabled) {
        assert.deepEqual(updates, []);
        assert.equal(cleanup, undefined);
      } else {
        assert.equal(updates[0].publicId, "example");
        assert.equal(updates[0].version, 7);
        assert.equal(updates[0].onDelete, deletePage);
        assert.equal(updates[0].beforeNavigate, flushPendingSaves);
        cleanup();
        assert.equal(updates[1], null);
      }
    }
  }
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

test("This page group is first, single-action, and gated by mobile and matching page route", () => {
  const guard = find(palette, (node) => ts.isVariableDeclaration(node) && node.name.getText() === "pageActions").initializer.getText();
  const prepend = find(palette, (node) => ts.isVariableDeclaration(node) && node.name.getText() === "rankedGroups" && node.initializer.getText().includes("This page")).initializer.getText();
  for (const [mobile, pathname, active] of [
    [true, "/page/example", true], [false, "/page/example", false],
    [true, "/project/15", false], [true, "/page/stale", false], [true, "/page/example/other", false],
  ]) {
    const groups = evaluate(`const pageActions = ${guard}; const mobileGroups = [{group: "App", commandLists: []}]; (${prepend});`, {
      isMobile: mobile, pathname,
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
  const branch = find(palette, (node) => ts.isIfStatement(node) && node.expression.getText() === 'command.key === "deletePage"').getText();
  const calls = [];
  evaluate(`(() => { ${branch} })()`, { command: { key: "deletePage" }, pageActions: { onDelete: () => calls.push("delete") }, resetShowCommands: () => calls.push("close") });
  assert.deepEqual(calls, ["close", "delete"]);
  evaluate(`(() => { ${branch} })()`, { command: { key: "deletePage" }, pageActions: null, resetShowCommands: () => calls.push("unexpected") });
  assert.deepEqual(calls, ["close", "delete"]);
});
