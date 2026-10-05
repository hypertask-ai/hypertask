const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const boardHref = "/project?id=6859";
const taskHref = "/detail/project-6859/43";
const task = { id: 52406, projectId: 6859, uniqueIndex: 43, description_: { content: "<p>Published</p>" } };
const draft = { type: "Description", content: "<p>Unsaved draft</p>" };

function load(relativePath, mocks = {}) {
  const source = process.env.MOBILE_DESCRIPTION_BASELINE
    ? execFileSync("git", ["show", `HEAD:${relativePath}`], { cwd: root, encoding: "utf8" })
    : fs.readFileSync(path.join(root, relativePath), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return require(name);
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}

async function fixture(t, { mobile = true, hasDraft = false, hasDraftInit = false, cachedLayout = true } = {}) {
  const dom = new JSDOM("<div id='root'></div>", { url: `https://app.hypertask.ai${boardHref}` });
  const previous = new Map();
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, Element: dom.window.Element, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(name, Object.getOwnPropertyDescriptor(global, name));
    Object.defineProperty(global, name, { configurable: true, writable: true, value });
  }
  const TaskContext = React.createContext(null);
  const MobileViewContext = React.createContext(mobile);
  const useTaskContext = () => React.useContext(TaskContext);
  const description = { description: task.description_.content, descriptionAttachments: [], uploadingDescription: null };
  const { armBackDismiss } = load("src/lib/mobile/backDismiss.ts");
  const useDoubleTap = load("src/hooks/MultiPages/useDoubleTap.ts");
  const guest = {
    GUEST_DESCRIPTION_EDITOR_ID: "description",
    GUEST_DESCRIPTION_INTERACTIVE_TARGET: "a,button",
    shouldEnterGuestDescriptionEdit: () => false,
    subscribeGuestDescriptionEditRequests: () => () => {},
    syncGuestDescriptionEditorState: () => {},
  };
  const { useTaskDetailEditorState } = load("src/components/RTE/useTaskDetailEditorState.tsx", {
    "@/lib/flags/keys": {},
    "@tanstack/react-query": { useQueryClient: () => ({}) },
    "@/lib/state": { useRecoilState: () => [{ id: 2343 }, () => {}] },
    "@/store": {},
    "@/hooks/General/useGetUserPreferences": { useGetUserPreferences: () => ({ data: {} }) },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "./Tiptap": () => ({ editor: null }),
    "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext },
    "next/navigation": { useRouter: () => ({}), useSearchParams: () => null },
    "@/lib/contexts/TaskDetail/DescriptionProvider": { useDescriptionAndCommentsContext: () => description },
    "@/lib/taskDetailArchiveNavigation": { shouldAdvanceAfterNotificationArchive: () => false },
    "@/hooks/General/useMobileVisualViewport": { useMobileVisualViewport: () => null },
    "@/hooks/useFlag": { useFlag: () => false },
  });
  const { useTaskDetailEditorFocus } = load("src/components/RTE/useTaskDetailEditorFocus.tsx", {
    "@/lib/demo/guest": { isGuestUser: () => false },
    "@/lib/demo/guestDescriptionEdit": guest,
    "@/lib/mobile/backDismiss": { armBackDismiss },
  });
  let editorProps, editorState, context, setDraftState;
  // Keep the real editor state and back-dismiss effects, without loading Tiptap,
  // uploads or autosave. No network/data mutation is possible in this fixture.
  function Editor(props) {
    editorProps = props;
    const state = useTaskDetailEditorState(props);
    state.cancelMobileExistingEditRef.current = () => context.setEditMode(null);
    useTaskDetailEditorFocus(state);
    editorState = state;
    return React.createElement("div", {
      id: "description-input",
      ...(state.mobileExistingEditOpen ? { "data-mobile-existing-content-editor": true } : {}),
    }, props.defaultContent);
  }
  const Body = load("src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/DescriptonBody.tsx", {
    "@/components/Common/AttachmentsView": () => null,
    "@/hooks/Task Detail/CommentAndDescriptionHooks/useSaveContent": () => ({ redirectAPI: () => assert.fail("must not save") }),
    "@/lib/contexts/TaskDetail/DescriptionProvider": { useDescriptionAndCommentsContext: () => description },
    "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext },
    "@/lib/contexts/mobileContext": { MobileViewContext },
    "@/hooks/General/useHasDrafts": { isMeaningfulDescriptionDraft: d => d.type === "Description" && Boolean(d.content) },
    "./InnerHtmlDescription": props => React.createElement("div", { id: props.id }, props.descriptionText),
    "../ContextMenu": { HighlightMenu: () => null },
    "../ContextMenu/QuoteButton": () => null,
    "@/components/RTE/TipTapTaskDetail": Editor,
    "../BackgroundTaskAttachments": () => null,
    "@/utils/helperFunctions/linkifyHtml": { linkifyHtml: content => content },
    "@/hooks/useFlag": { useFlag: () => true },
    "@/lib/flags/keys": {},
  }).default;
  const Container = load("src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/index.tsx", {
    "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext },
    "@/lib/contexts/mobileContext": { MobileViewContext },
    "@/lib/constants/TaskDetail": { descriptionContainerId: "description-container", DELIBERATE_DOUBLE_CLICK_MS: 500 },
    "@/hooks/MultiPages/useDoubleTap": useDoubleTap,
    "@/lib/state": { useRecoilValue: () => ({ id: 2343 }) },
    "@/store": {},
    "@/lib/demo/guest": { isGuestUser: () => false },
    "@/lib/demo/guestDescriptionEdit": guest,
  }).default;
  const Card = load("src/components/PageComponents/Kanban/KanbanTaskComponents/TaskDraggableContainer.tsx", {
    "next/link": ({ prefetch, ...props }) => React.createElement("a", props),
    "@/lib/contexts/mobileContext": { MobileViewContext },
    "@/utils/undoActions/helperFuncs": { cn: (...classes) => classes.filter(Boolean).join(" ") },
  }).default;
  const pushes = [];
  const originalPush = dom.window.history.pushState.bind(dom.window.history);
  dom.window.history.pushState = (...args) => { pushes.push(args); originalPush(...args); };
  function App() {
    const [open, setOpen] = React.useState(false);
    const [editMode, setEditMode] = React.useState(null);
    const [draftState, updateDraftState] = React.useState({ hasDraft, hasDraftInit });
    setDraftState = updateDraftState;
    React.useEffect(() => {
      const onPop = () => { if (dom.window.location.pathname === "/project") setOpen(false); };
      dom.window.addEventListener("popstate", onPop);
      return () => dom.window.removeEventListener("popstate", onPop);
    }, []);
    context = { parsedTask: JSON.stringify(task), currentTask: task, editMode, setEditMode, currentId: "comment", setCurrentId: () => {}, focusOn: () => {}, secondaryPanelsReady: true, cachedLayout, descriptionFocusRequest: null, ...draftState };
    return open
      ? React.createElement(TaskContext.Provider, { value: context }, React.createElement(Container, null, React.createElement(Body, { draftTQ: draftState.hasDraft || draftState.hasDraftInit ? [draft] : [] })))
      : React.createElement(Card, { active: false, taskHref, openDetail: () => { dom.window.history.pushState({}, "", taskHref); setOpen(true); } }, "Open task");
  }
  const reactRoot = createRoot(document.getElementById("root"));
  t.after(async () => {
    await React.act(async () => reactRoot.unmount());
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
  });
  await React.act(async () => reactRoot.render(React.createElement(App)));
  const click = async selector => React.act(async () => {
    const element = document.querySelector(selector);
    assert.ok(element, selector);
    element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
  const back = async () => React.act(async () => {
    await new Promise(resolve => { dom.window.addEventListener("popstate", resolve, { once: true }); dom.window.history.back(); });
  });
  return { dom, pushes, click, back, editorOpen: () => Boolean(document.querySelector("[data-mobile-existing-content-editor]")), props: () => editorProps, state: () => editorState, hydrateDraft: () => React.act(async () => setDraftState({ hasDraft: true, hasDraftInit: false })) };
}

for (const cachedLayout of [false, true]) {
  for (const draftState of [{ hasDraft: true }, { hasDraftInit: true }, {}]) {
    test(`phone card entry stays closed with one push and one Back (cached=${cachedLayout}, draft=${JSON.stringify(draftState)})`, async t => {
      const f = await fixture(t, { cachedLayout, ...draftState });
      await f.click("a");
      assert.equal(f.editorOpen(), false, "a stored description draft is not a request to open the full-screen editor");
      assert.equal(f.pushes.length, 1);
      assert.equal(f.dom.window.location.pathname, taskHref);
      assert.match(document.getElementById("description-input").textContent, draftState.hasDraft || draftState.hasDraftInit ? /Unsaved draft/ : /Published/);
      await f.back();
      assert.equal(f.dom.window.location.pathname + f.dom.window.location.search, boardHref);
      assert.ok(document.querySelector("a"), "one Back must show the board");
    });
  }
}

test("late description draft hydration does not open the phone editor", async t => {
  const f = await fixture(t);
  await f.click("a");
  await f.hydrateDraft();
  assert.equal(f.editorOpen(), false);
  assert.equal(f.pushes.length, 1);
  assert.match(document.getElementById("description-input").textContent, /Unsaved draft/);
});

test("intentional phone description double tap opens the draft; Back closes it without leaving the task", async t => {
  const f = await fixture(t, { hasDraft: true });
  await f.click("a");
  assert.equal(f.editorOpen(), false);
  await f.click("#description-input");
  assert.equal(f.editorOpen(), false, "one tap keeps the established selection-only behavior");
  await f.click("#description-input");
  await React.act(async () => new Promise(resolve => setTimeout(resolve, 150)));
  assert.equal(f.editorOpen(), true);
  assert.equal(f.props().allowEdit, true);
  assert.match(f.props().defaultContent, /Unsaved draft/);
  assert.equal(f.pushes.length, 2, "only intentional editing adds the back-dismiss entry");
  assert.equal(f.dom.window.history.state.__htMobileExistingContentEdit, true);
  await f.back();
  assert.equal(f.editorOpen(), false);
  assert.equal(f.dom.window.location.pathname, taskHref);
  assert.equal(f.pushes.length, 2, "the retained draft must not rearm the dismissed editor");
  await f.back();
  assert.equal(f.dom.window.location.pathname + f.dom.window.location.search, boardHref);
});

for (const draftState of [{ hasDraft: true }, { hasDraftInit: true }]) {
  test(`desktop retains inline draft editing (${JSON.stringify(draftState)})`, async t => {
    const f = await fixture(t, { mobile: false, ...draftState });
    await f.click("a");
    assert.equal(f.props().allowEdit, true);
    assert.equal(f.editorOpen(), false);
    assert.match(f.props().defaultContent, /Unsaved draft/);
    assert.equal(f.pushes.length, 1);
  });
}
