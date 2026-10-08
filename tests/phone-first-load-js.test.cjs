const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const notificationMarkup = require("./fixtures/phone-first-load-notifications.json");
const jiti = require("jiti")(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });
const projection = jiti(path.join(root, "src/lib/firstScreen/comment.ts"));

function staticImports(file, source = read(file)) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  return ast.statements.filter(ts.isImportDeclaration)
    .map(node => node.moduleSpecifier.text)
    .filter(id => compiled.includes(`require("${id}")`));
}

test("first-screen owners no longer statically import closed dialogs or server HTML parsing", () => {
  const cases = [
    ["src/components/notifications/NotificationRow.tsx", "@/lib/firstScreen/comment"],
    ["src/components/notifications/inboxSplit/index.tsx", "@/components/Modals/RemindMe/RemindMeComponent"],
    ["src/components/notifications/inboxSplit/RemindMeInbox.tsx", "@/components/Modals/RemindMe/RemindMeComponent"],
  ];
  for (const [file, dependency] of cases) {
    const regressed = `import * as legacyDependency from "${dependency}";\nconsole.log(legacyDependency);\n${read(file)}`;
    assert.ok(staticImports(file, regressed).includes(dependency), `detect reintroduced eager dependency: ${file}`);
    assert.ok(!staticImports(file).includes(dependency), `first-screen boundary: ${file}`);
  }
});

function compile(file, mocks) {
  const exports = {};
  const code = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    exports, require: id => Object.hasOwn(mocks, id) ? { __esModule: true, ...mocks[id] } : require(id),
    document: global.document, window: global.window, console,
  }, { filename: file });
  return exports;
}

test("phone inbox flag on and pending skip legacy downloads; off and desktop warm only inbox modules", async () => {
  const file = "src/components/ProviderGlobal/GloablProviders.tsx";
  const source = read(file);
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0]?.getText(ast).includes("legacyImports")) callback = node.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(callback, "exercise the real import scheduling effect");
  const code = ts.transpileModule(`export const effect = ${callback};`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  for (const [mobile, enabled, resolved, pathname, expected, viewport] of [
    [true, true, true, "/project", 0], [true, true, true, "/inbox", 0],
    [true, false, undefined, "/project", 0], [true, false, undefined, "/inbox", 0],
    [true, false, true, "/project", 0], [true, false, true, "/inbox", 0],
    [true, false, false, "/project", 0], [true, false, false, "/inbox", 2],
    [false, true, true, "/project", 0], [false, true, true, "/inbox", 2],
    [true, false, false, "/my-tasks", 0],
    [false, true, true, "/project", 0, 390],
    [false, false, undefined, "/inbox", 0, 390],
  ]) {
    const imports = [];
    const exports = {};
    vm.runInNewContext(code, { exports, window: { innerWidth: viewport ?? (mobile ? 390 : 1440) }, mbl: mobile, phoneFirstLoadJs: enabled, phoneJsFlagValue: resolved, pathname, require: id => { imports.push(id); return {}; } });
    exports.effect();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(imports.length, expected, JSON.stringify({ mobile, enabled, resolved, pathname }));
  }
});

test("inbox content remains identical, with parser code needed only by seeded server content", () => {
  const dom = new JSDOM("<html><body></body></html>");
  global.document = dom.window.document;
  global.window = dom.window;
  let snapshot = null;
  let notification;
  const Seeded = () => null;
  const noop = () => null;
  const mocks = {
    "next/dynamic": { default: () => Seeded },
    "next/link": { default: noop },
    "@/models/model": {},
    "@/utils/generateTime": { default: () => "today" },
    "@/lib/firstScreen/SurfaceContext": { useFirstScreenSurface: () => snapshot },
    "@/lib/firstScreen/display": { projectDisplayDate: () => "Oct 08" },
    "@/lib/firstScreen/comment": projection,
    "@/components/Common/UserAvatar": { default: noop },
    "../Common/UserAvatar": { default: noop },
    "@/utils/helperFunctions/helperFunctions": { convertToPlain: html => { const div = document.createElement("div"); div.innerHTML = html; return div.textContent; } },
    "@/lib/IconsLocal": { ArchiveNotificationIcon: noop },
    "../Common/Tooltip": { default: noop },
    "@/lib/contexts/NotificationContext": { useNotificationContext: () => ({ notification, isIbxSlctd: false }) },
    "../Common/TaskRowComponents/TaskRowContainer": { default: noop },
    "../Common/TaskRowComponents/TaskTitle": { default: noop, TaskMetaChips: noop },
    "./inboxSplit/RemindMeInbox": { default: noop },
    "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
    "@/lib/configs/inbox.config": { inboxConfig: { bulkSelectionStyling: { content: () => "content" } } },
    "@/lib/nativeAgent/agentMessageEnvelope": { decodeAgentMessage: value => value },
  };
  try {
    const after = compile("src/components/notifications/NotificationRow.tsx", mocks);
    for (const seeded of [false, true]) {
      snapshot = seeded ? { now: "2026-10-08T08:00:00.000Z" } : null;
      for (const type of ["Comment", "Mentioned", "Assigned", "TaskArchived", "TaskMoved", "AddedToFollowerInTask", "Invited", "TaskDueDate", "TaskReminder", "TaskMovedToInbox", "TaskOverdue", "TaskUpdateDescription", "AgentMessage", "Reacted"]) {
        notification = { type, userId: 985, commentId: 1, comment: { text: '<blockquote>Quote</blockquote><p><span data-type="mention" data-label="name-985">Teammate</span> review &amp; reply</p>' }, task: { status: "Normal", section: "To do" }, reaction: { emoji: "heart" }, message: "Agent text" };
        const expected = notificationMarkup[`${type}, seeded=${seeded}`];
        const actual = renderToStaticMarkup(React.createElement(after.NotificationContentBody, { projection: seeded ? projection : undefined }));
        assert.equal(actual, expected, `${type}, seeded=${seeded}`);
        assert.equal(after.NotificationContent().type, seeded ? Seeded : after.NotificationContentBody);
      }
    }
  } finally {
    dom.window.close(); delete global.document; delete global.window;
  }
});

test("reminder stays closed until click intent mounts its dynamic boundary", async () => {
  const dom = new JSDOM('<div id="root"></div>');
  global.document = dom.window.document; global.window = dom.window;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = require("react-dom/client");
  const dialogs = [];
  const mocks = {
    "next/dynamic": { default: loader => { const Runtime = () => { dialogs.push(loader); return React.createElement("div", { role: "dialog" }, "Reminder"); }; return Runtime; } },
    "@/components/Common/Tooltip": { default: () => null },
    "@/lib/constants": { default: { gThenKeyDelay: 1000 } },
    "@/lib/contexts/Inbox/BulkSelectionContext": { useBulkSelectionContext: () => ({ selectedNotifications: [] }) },
    "@/utils/helperFunctions/helperFunctions": { returnIfModalOrInputActive: () => false },
    "next/navigation": { useRouter: () => ({ refresh() {} }) },
  };
  const rootNode = createRoot(document.getElementById("root"));
  try {
    const Reminder = compile("src/components/notifications/inboxSplit/RemindMeInbox.tsx", mocks).default;
    await React.act(async () => rootNode.render(React.createElement(Reminder, { show: true })));
    assert.equal(dialogs.length, 0);
    await React.act(async () => document.querySelector("button").click());
    assert.ok(document.querySelector('[role="dialog"]'));
    assert.equal(dialogs.length, 1);
  } finally {
    await React.act(async () => rootNode.unmount());
    dom.window.close(); delete global.window; delete global.document; delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});
