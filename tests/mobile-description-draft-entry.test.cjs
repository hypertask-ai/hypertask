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
    ? execFileSync("git", ["show", `${process.env.MOBILE_DESCRIPTION_BASELINE === "1" ? "HEAD" : process.env.MOBILE_DESCRIPTION_BASELINE}:${relativePath}`], { cwd: root, encoding: "utf8" })
    : fs.readFileSync(path.join(root, relativePath), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    if (name === "react") return mocks.react ?? React;
    if (name === "react/jsx-runtime") return require(name);
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}

async function fixture(t, { mobile = true, hasDraft = false, hasDraftInit = false, cachedLayout = true } = {}) {
  const dom = new JSDOM("<div id='root'></div>", { url: `https://app.hypertask.ai${boardHref}`, pretendToBeVisual: true });
  const previous = new Map();
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, Element: dom.window.Element, Event: dom.window.Event, DOMParser: dom.window.DOMParser, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true })) {
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
  const mutations = [];
  const queryClient = {
    getQueryData: () => hasDraft || hasDraftInit ? [draft] : [],
    setQueryData: () => mutations.push("draft cache write"),
    invalidateQueries: () => mutations.push("draft invalidation"),
  };
  const { useTaskDetailEditorDrafts } = load("src/components/RTE/useTaskDetailEditorDrafts.tsx", {
    "@/utils/api/Task Detail": { updateDraftHelper: () => { mutations.push("draft save"); return Promise.resolve({ status: 200 }); } },
    "@/hooks/General/useDebounceWithCancel": () => [() => mutations.push("draft debounce"), () => {}],
    "@/hooks/General/useGetUserDrafts": { USER_DRAFTS_QUERY_KEY: id => ["drafts", id] },
    axios: { post: () => assert.fail("must not discard") },
    "@/lib/constants/TaskDetail": { descriptionContainerId: "description-container" },
  });
  const { useTaskDetailEditorSave } = load("src/components/RTE/useTaskDetailEditorSave.tsx", {
    "@/hooks/useFlag": { useFlag: () => false },
    "@/lib/flags/keys": {},
    "@/lib/state": { useSetRecoilState: () => () => {} },
    "@/store": {},
    "@/models/enums": {},
    "@/utils/api/Task Detail": { cancelPendingDraftUpdates: () => {} },
    "react-hot-toast": {},
    "./draftSync": { shouldSkipUnchangedMobileDescriptionSave: () => false },
    "@/lib/tutorial/learnTutorialState": {},
    "@/lib/ai/autoDescriptionSuggestion": {},
  });
  const { useTaskDetailEditorState } = load("src/components/RTE/useTaskDetailEditorState.tsx", {
    "@/lib/flags/keys": {},
    "@tanstack/react-query": { useQueryClient: () => queryClient },
    "@/lib/state": { useRecoilState: () => [{ id: 2343 }, () => {}] },
    "@/store": {},
    "@/hooks/General/useGetUserPreferences": { useGetUserPreferences: () => ({ data: {} }) },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "./Tiptap": ({ defaultContent }) => {
      const ref = React.useRef(null);
      if (!ref.current) {
        let html = defaultContent;
        const listeners = new Map();
        ref.current = {
          getHTML: () => html,
          isDestroyed: false,
          commands: {
            setContent: (content, { emitUpdate } = {}) => { html = content; if (emitUpdate) listeners.get("update")?.(); },
            blur: () => {},
            focus: () => {},
          },
          setEditable: () => {},
          view: { dispatch: () => {}, state: { tr: {} } },
          on: (event, callback) => listeners.set(event, callback),
          off: event => listeners.delete(event),
        };
      }
      return { editor: ref.current };
    },
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
  // Execute the real cancel and draft hooks as well as Back dismissal; replacing
  // cancel with setEditMode(null) would hide errors before the mode is cleared.
  function Editor(props) {
    editorProps = props;
    const state = useTaskDetailEditorState(props);
    const editorContext = { ...state, ...useTaskDetailEditorDrafts(state) };
    Object.assign(editorContext, useTaskDetailEditorSave(() => editorContext));
    useTaskDetailEditorFocus(editorContext);
    editorState = editorContext;
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
  const cache = load("src/lib/navigation/cachedTaskDetail.ts", {
    "@/lib/boardSync/revocationTombstone": { isBoardRevocationTombstoned: () => false },
    "./nextHistoryState": {},
  });
  const navigationCalls = [];
  const previousLocation = { current: undefined };
  const navigationCleanups = [];
  const Navigation = load("src/components/PageComponents/TaskDetail/CachedTaskDetailNavigation.tsx", {
    react: {
      useRef: () => previousLocation,
      useState: () => [() => null],
      useSyncExternalStore: () => dom.window.location.pathname,
      useEffect: callback => { const cleanup = callback(); if (cleanup) navigationCleanups.push(cleanup); },
    },
    "next/navigation": { usePathname: () => taskHref, useRouter: () => ({ replace: href => navigationCalls.push(href), refresh: () => navigationCalls.push("refresh") }) },
    "@tanstack/react-query": { useQueryClient: () => ({ getQueryData: () => task }) },
    "@/lib/state": { useRecoilValue: () => ({ id: 2343 }) },
    "@/store": {},
    "@/hooks/useFlag": { useFlag: () => cachedLayout },
    "@/lib/flags/keys": {},
    "@/lib/navigation/cachedTaskDetail": cache,
  }).default;
  let resolveBack;
  dom.window.addEventListener("popstate", () => resolveBack?.(), true);
  const nextState = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ["source route"] };
  dom.window.history.replaceState(nextState, "", boardHref);
  const openDetail = setOpen => {
    dom.window.history.pushState({ ...nextState, ...(cachedLayout ? { cachedTaskDetail: { accountId: 2343, taskId: task.id, projectId: task.projectId, uniqueIndex: task.uniqueIndex } } : {}) }, "", taskHref);
    Navigation({ accountId: 2343, children: null });
    // Next's background refresh strips custom state from the task entry before
    // the modal adds its own entry, while cached navigation retains the task.
    dom.window.history.replaceState(nextState, "", taskHref);
    setOpen(true);
  };
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
      dom.window.addEventListener("cached-task-detail-navigation", onPop);
      return () => {
        dom.window.removeEventListener("popstate", onPop);
        dom.window.removeEventListener("cached-task-detail-navigation", onPop);
      };
    }, []);
    context = { parsedTask: JSON.stringify(task), currentTask: task, editMode, setEditMode, currentId: "comment", setCurrentId: () => {}, focusOn: () => {}, toggleRecording: () => {}, secondaryPanelsReady: true, cachedLayout, descriptionFocusRequest: null, ...draftState };
    return open
      ? React.createElement(TaskContext.Provider, { value: context }, React.createElement(Container, null, React.createElement(Body, { draftTQ: draftState.hasDraft || draftState.hasDraftInit ? [draft] : [] })))
      : React.createElement(Card, { active: false, taskHref, openDetail: () => openDetail(setOpen) }, "Open task");
  }
  const reactRoot = createRoot(document.getElementById("root"));
  t.after(async () => {
    await React.act(async () => reactRoot.unmount());
    navigationCleanups.forEach(cleanup => cleanup());
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
    await new Promise(resolve => { resolveBack = resolve; dom.window.history.back(); });
    resolveBack = undefined;
  });
  return { dom, pushes, click, back, mutations, navigationCalls, context: () => context, type: html => React.act(async () => editorState.editor.commands.setContent(html, { emitUpdate: true })), editorOpen: () => Boolean(document.querySelector("[data-mobile-existing-content-editor]")), props: () => editorProps, state: () => editorState, hydrateDraft: () => React.act(async () => setDraftState({ hasDraft: true, hasDraftInit: false })) };
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

for (const cachedLayout of [false, true]) {
  for (const draftState of [{ hasDraft: true }, { hasDraftInit: true }, {}]) {
    test(`intentional phone description double tap; Back closes without saving or discarding (cached=${cachedLayout}, draft=${JSON.stringify(draftState)})`, async t => {
      const f = await fixture(t, { cachedLayout, ...draftState });
      await f.click("a");
      assert.equal(f.editorOpen(), false);
      await f.click("#description-input");
      assert.equal(f.editorOpen(), false, "one tap keeps the established selection-only behavior");
      await f.click("#description-input");
      await React.act(async () => new Promise(resolve => setTimeout(resolve, 150)));
      assert.equal(f.editorOpen(), true);
      assert.equal(f.props().allowEdit, true);
      const openingHtml = f.state().editor.getHTML();
      assert.equal(openingHtml, draftState.hasDraft || draftState.hasDraftInit ? draft.content : task.description_.content);
      assert.equal(f.pushes.length, 2, "only intentional editing adds the back-dismiss entry");
      assert.equal(f.dom.window.history.state.__htMobileExistingContentEdit, true);
      const editor = f.state().editor;
      await f.type("<p>Phone session changes</p>");
      assert.deepEqual(f.mutations, [], "phone existing-content editing does not autosave drafts");
      await f.back();
      assert.equal(f.editorOpen(), false, "Back must reach the real cancel handler even after Next strips cached history state");
      assert.equal(f.context().editMode, null);
      assert.equal(editor.getHTML(), openingHtml, "cancel silently restores the opening snapshot");
      assert.equal(f.context().hasDraft, Boolean(draftState.hasDraft));
      assert.equal(f.context().hasDraftInit, Boolean(draftState.hasDraftInit));
      assert.deepEqual(f.mutations, [], "Back must neither publish, delete nor overwrite the stored draft");
      assert.deepEqual(f.navigationCalls, [], "modal Back must not refresh the underlying task route");
      assert.equal(f.dom.window.location.pathname, taskHref);
      assert.equal(f.pushes.length, 2, "the retained draft must not rearm the dismissed editor");
      await f.back();
      assert.equal(f.dom.window.location.pathname + f.dom.window.location.search, boardHref);
      assert.deepEqual(f.navigationCalls, cachedLayout ? [boardHref, "refresh"] : [], "the cached source-route Back repair still runs when actually leaving the task");
    });
  }
}

for (const draftState of [{ hasDraft: true }, { hasDraftInit: true }]) {
  test(`desktop retains inline draft editing (${JSON.stringify(draftState)})`, async t => {
    const f = await fixture(t, { mobile: false, ...draftState });
    await f.click("a");
    assert.equal(f.props().allowEdit, true);
    assert.equal(f.editorOpen(), false);
    assert.match(f.props().defaultContent, /Unsaved draft/);
    assert.equal(f.pushes.length, 1);
    await f.type("<p>Desktop draft update</p>");
    assert.deepEqual(f.mutations, ["draft debounce"], "desktop still listens for updates and autosaves drafts");
    await f.back();
    assert.equal(f.dom.window.location.pathname + f.dom.window.location.search, boardHref);
    assert.deepEqual(f.navigationCalls, [boardHref, "refresh"]);
  });
}
