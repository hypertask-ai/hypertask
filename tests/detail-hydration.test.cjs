const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot, hydrateRoot } = require("react-dom/client");
const { renderToString } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
function load(relativePath, mocks) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, relativePath), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)((name) => {
    if (name in mocks) return { __esModule: true, ...mocks[name] };
    assert.ok(["react", "react/jsx-runtime"].includes(name), `Unexpected dependency: ${name}`);
    return require(name);
  }, exports);
  return exports;
}

const hydrated = load("src/hooks/General/useHydrated.ts", {});
const MobileViewContext = React.createContext(false);
const TaskContext = React.createContext(null);
const noop = () => null;
const childrenOnly = ({ children }) => children;
let instantTicketOpen;
const mocks = {
  "@/hooks/useFlag": { useFlag: () => instantTicketOpen },
  "@/hooks/General/useHydrated": hydrated,
  "@/hooks/Task Detail/useThreadSettled": { useThreadSettled: () => true },
  "./SettledComposerSlot": { SettledComposerSlot: ({ children }) => children },
  "@/components/PageComponents/TaskDetail/CommentAndDescription/SettledComposerSlot": { SettledComposerSlot: ({ children }) => children },
  "@/lib/flags/keys": {},
  "@/lib/contexts/mobileContext": { MobileViewContext },
  "next/dynamic": { default: () => noop },
  "./DescriptionContainer": { default: childrenOnly },
  "./DescriptionContainer/TopRow/DescriptionTopRow": { default: noop },
  "@/lib/contexts/TaskDetail/DescriptionProvider": { useDescriptionAndCommentsContext: () => ({ comments: [], stacked: {} }) },
  "./UploadingDescription/UploadingDescriptionContainer": { default: noop },
  "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => React.useContext(TaskContext) },
  "./DescriptionContainer/DescriptionSubTasks/DescriptionSubTasks": { default: noop },
  "./DescriptionContainer/DescriptionSubTasks/DescriptionPages": { default: noop },
  "./DescriptionContainer/DescriptionSubTasks/TaskPagesContext": { TaskPagesProvider: childrenOnly },
  "@/lib/contexts/CommentsContext": { CommentsProvider: childrenOnly },
  "./CommentContainer/CommentsContainer": { default: noop },
  "./UploadingComment/UploadingCommentContainer": { default: noop },
  "./CommentContainer/NewCommentComponent": { default: noop },
  "./DescriptionContainer/DescriptonBody": { default: () => React.createElement("article", null, "Cached ticket body") },
  "../TaskInfoColumn/TaskInfo": { default: noop },
  "@/lib/configs/taskDetail.config": { taskDetailSpacing: { mobile: { descriptionContainer: "" } } },
  "./BaseCommentAndDescriptionContainer": { default: ({ children }) => React.createElement("section", null, children) },
  "@/components/Common/RichTextPersonHovercards": { default: noop },
  "./AgentRunActivityRow": { default: noop },
};
const Thread = load("src/components/PageComponents/TaskDetail/CommentAndDescription/index.tsx", mocks).default;

function setup(t, mobile, flag) {
  instantTicketOpen = flag;
  const previous = new Map(["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  delete global.window;
  delete global.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  let items = [];
  const state = {
    currentTask: { id: 42, projectId: 2144 },
    secondaryPanelsReady: false,
    virtualizer: { getTotalSize: () => 200, getVirtualItems: () => items, measureElement: () => {} },
    virtualizeIndexes: { taskInfoVirtualIndex: -1, descriptionVirtualIndex: 0, descriptionBottomVirtualIndex: 1, numberOfComments: 0, numberOfUploadingComments: 0 },
  };
  const render = (observer = null) => React.createElement(MobileViewContext.Provider, { value: mobile },
    React.createElement(TaskContext.Provider, { value: state }, React.createElement(Thread, {}), observer));
  const dom = new JSDOM("<div id='root'></div>", { url: "https://app.hypertask.ai/detail/project-2144/5" });
  const container = dom.window.document.getElementById("root");
  let reactRoot;
  t.after(async () => {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  });
  return {
    container, render,
    populateRows() { items = [{ index: 0, key: "description", start: 0 }, { index: 1, key: "description-bottom", start: 100 }]; },
    installBrowser() { global.window = dom.window; global.document = dom.window.document; },
    setRoot(value) { reactRoot = value; },
  };
}

for (const mobile of [false, true]) {
  for (const flag of [false, true]) {
    const variant = `${mobile ? "phone" : "desktop"}, instant-open ${flag ? "on" : "off"}`;
    test(`late streamed thread hydrates with empty server rows even after its provider has populated the viewport (${variant})`, async (t) => {
      const fixture = setup(t, mobile, flag);
      const serverHtml = renderToString(fixture.render());
      fixture.container.innerHTML = serverHtml;
      assert.equal(fixture.container.querySelectorAll("[data-index]").length, 0);
      const serverSection = fixture.container.firstChild;
      // TasksProvider is outside page.tsx's Suspense: it may commit before this child hydrates.
      fixture.populateRows();
      fixture.installBrowser();
      const errors = [];
      await React.act(async () => {
        fixture.setRoot(hydrateRoot(fixture.container, fixture.render(), {
          onRecoverableError: (error) => errors.push(error.message),
        }));
      });
      assert.deepEqual(errors, [], "hydration must not regenerate the streamed thread");
      assert.equal(fixture.container.firstChild, serverSection);
      assert.equal(fixture.container.querySelectorAll("[data-index]").length, 2);
      assert.match(fixture.container.textContent, /Cached ticket body/);
    });

    test(`client-side ticket navigation renders cached rows in its first commit (${variant})`, async (t) => {
      const fixture = setup(t, mobile, flag);
      fixture.populateRows();
      fixture.installBrowser();
      const commits = [];
      function Observer() {
        React.useLayoutEffect(() => { commits.push(fixture.container.querySelectorAll("[data-index]").length); }, []);
        return null;
      }
      const reactRoot = createRoot(fixture.container);
      fixture.setRoot(reactRoot);
      await React.act(async () => reactRoot.render(fixture.render(React.createElement(Observer))));
      assert.deepEqual(commits, [2], "cached rows must not wait for a mount effect on client navigation");
      assert.match(fixture.container.textContent, /Cached ticket body/);
    });
  }
}
