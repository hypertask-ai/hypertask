const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { hydrateRoot } = require("react-dom/client");
const { renderToString } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const { createJiti } = require("jiti");
const { atom: jotaiAtom } = require("jotai");

const root = path.resolve(__dirname, "..");

function load(relativePath, mocks) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, relativePath), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)((name) => (name in mocks ? { __esModule: true, ...mocks[name] } : require(name)), exports);
  return exports;
}

function loadPageModules() {
  const jiti = createJiti(__filename, {
    interopDefault: true,
    moduleCache: false,
    alias: { "@/lib/state": path.join(root, "tests/stubs/state-noop.cjs"), "@": path.join(root, "src") },
  });
  const { tasksPlayListAtom } = jiti(path.join(root, "src/store/index.ts"));
  const hydrated = load("src/hooks/General/useHydrated.ts", {});
  const state = load("src/lib/state.tsx", { "@/hooks/General/useHydrated": hydrated });
  const icon = () => React.createElement("svg");
  const TaskMovement = load("src/components/PageComponents/TaskDetail/TaskMovement.tsx", {
    "@/components/Common/Tooltip": { default: () => null },
    "@/store": { tasksPlayListAtom, showAIChatInterfaceAtom: jotaiAtom(false), isAiChatSidebarModeAtom: jotaiAtom(false) },
    "lucide-react": { ChevronUp: icon, ChevronDown: icon },
    "@/lib/state": state,
    "@/lib/taskDetailSwipe": load("src/lib/taskDetailSwipe.ts", {}),
  }).default;
  return () => React.createElement(state.StateRoot, null, React.createElement(TaskMovement, {
    currentItemInTasksPlaylist: { projectId: 339, uniqueIndex: 1816 },
    navigateToNextTask: () => {},
    navigateToPreviousTask: () => {},
  }));
}

const savedPlaylist = [
  { id: 61009, projectId: 339, uniqueIndex: 1815 },
  { id: 61010, projectId: 339, uniqueIndex: 1816 },
];

test("reloading a ticket opened from a board hydrates the server HTML and then shows the saved playlist position", async (t) => {
  const previous = new Map(["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  t.after(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  });
  delete global.window;
  delete global.document;
  const serverHtml = renderToString(React.createElement(loadPageModules()));
  assert.doesNotMatch(serverHtml, /\/ 2/);

  const dom = new JSDOM(`<div id="root">${serverHtml}</div>`, { url: "https://app.hypertask.ai/detail/project-339/1816" });
  t.after(() => dom.window.close());
  dom.window.sessionStorage.setItem("tasksPlayListAtom", JSON.stringify(savedPlaylist));
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const ClientPage = loadPageModules();

  const hydrationErrors = [];
  let reactRoot;
  await React.act(async () => {
    reactRoot = hydrateRoot(document.getElementById("root"), React.createElement(ClientPage), {
      onRecoverableError: (error) => hydrationErrors.push(error.message.split("\n")[0]),
    });
  });
  const textAfterHydration = document.getElementById("root").textContent;
  await React.act(async () => reactRoot.unmount());

  assert.deepEqual(hydrationErrors, []);
  assert.match(textAfterHydration, /2 \/ 2/);
  assert.deepEqual(JSON.parse(dom.window.sessionStorage.getItem("tasksPlayListAtom")), savedPlaylist);
});
