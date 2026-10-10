const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToString } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const noop = () => null;

function load(relative, dependencies, declaration) {
  if (/src\/lib\/flags\/(?:keys|definitions)\.ts$/.test(relative)) return require("./helpers/flag-files.cjs").load(relative);
  let source = fs.readFileSync(path.join(root, relative), "utf8");
  if (declaration) {
    const tree = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let node;
    function visit(statement) {
      if (statement.name?.text === declaration ||
          statement.declarationList?.declarations.some((item) => item.name.text === declaration) ||
          (ts.isJsxElement(statement) && `<${statement.openingElement.tagName.getText(tree)}>` === declaration) ||
          (ts.isJsxSelfClosingElement(statement) && `<${statement.tagName.getText(tree)}>` === declaration)) node = statement;
      if (!node) ts.forEachChild(statement, visit);
    }
    visit(tree);
    assert.ok(node, `Missing production declaration ${declaration}`);
    source = declaration.startsWith("<")
      ? `exports.component = (${node.getText(tree)});`
      : `${node.getText(tree)}\nexports.component = ${declaration};`;
  }
  const js = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  for (const dependency of Object.values(dependencies)) {
    if (dependency && typeof dependency === "object" && "default" in dependency) dependency.__esModule = true;
  }
  const names = Object.keys(dependencies).filter((name) => name !== declaration && /^[A-Za-z_$][\w$]*$/.test(name));
  new Function("require", "exports", ...names, js)((name) => {
    if (name === "react/jsx-runtime") return require(name);
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports, ...names.map((name) => dependencies[name]));
  return declaration ? exports.component : (exports.default ?? exports);
}

function boardRender(pending) {
  const row = () => React.createElement("div", { className: "h-8" }, "Board controls");
  const controls = pending ? React.lazy(() => new Promise(() => {})) : row;
  return load("src/app/[...boardURL]/LandingPage.tsx", {
    Suspense: React.Suspense,
    BoardDocumentBoundary: React.Suspense,
    KanbanModalsProvider: ({ children }) => children,
    AppShellRail: noop,
    ViewTabsBar: controls,
    ShellViewControls: controls,
    GuestAuthLinks: noop,
    Header: controls,
    CycleBoardMeta: noop,
    getActiveBoardViewId: noop,
    HomePage: () => React.createElement("div", { "data-board-content": true }, "Cached board"),
  }, "renderLandingSection")({
    boardLayout: "board", isMbl: false, appShellRailOn: true,
    _currentProject: { id: 7049 }, sections: [], activeBuiltinViews: {},
    _notifications: { all: 0, unseen: 0 },
  });
}

test("lazy rail controls reserve their final 56px before cached board content paints", () => {
  const html = renderToString(boardRender(true));
  const document = new JSDOM(html).window.document;
  const placeholder = document.querySelector('[aria-label="Loading Board controls"]');
  assert.ok(placeholder);
  assert.match(placeholder.className, /(?:^|\s)h-\[56px\](?:\s|$)/);
  assert.equal(document.querySelector("[data-board-content]").textContent, "Cached board");
  const ready = new JSDOM(renderToString(boardRender(false))).window.document;
  assert.equal(ready.querySelector('[aria-label="Loading Board controls"]'), null);
  assert.ok(ready.querySelector(".pills-row"));
});

test("empty inbox split titles reserve the loaded 32px row and remain hidden on phones", () => {
  const SplitTitles = load("src/app/inbox/Inbox.tsx", { ButtonGroup: noop }, "SplitTitlesContainer");
  const SplitTitle = load("src/components/notifications/inboxSplit/SplitTitle.tsx", {
    "@/hooks/Inbox/useInboxZeroStyling": { useInboxZeroStyling: () => ({ classes: {} }) },
    "lucide-react": { Circle: noop },
  });
  for (const contentGap of [false, true]) {
    const empty = new JSDOM(renderToString(React.createElement(SplitTitles, { contentGap }))).window.document;
    const row = empty.querySelector(".pills-row");
    assert.match(row.className, /(?:^|\s)min-h-8(?:\s|$)/);
    assert.match(row.parentElement.className, /hidden/);
    assert.match(row.parentElement.className, /@md:flex/);
    const ready = new JSDOM(renderToString(React.createElement(SplitTitles, { contentGap }, React.createElement(SplitTitle, {
      tab: { project: "Important", length: 0 }, onClick: noop,
    })))).window.document;
    assert.equal(ready.querySelector(".pills-row").className, row.className);
    assert.equal(ready.querySelector(".pills-row").textContent, "Important");
    assert.match(ready.querySelector(".footer_tags_main").className, /@md:h-8/);
  }
});

const globalProvider = "src/components/ProviderGlobal/GloablProviders.tsx";

function reservations(state) {
  const atoms = {
    aiChatPinnedAtom: "aiChatPinned", openAiChatByDefaultAtom: "openAiChatByDefault",
    isAiChatSidebarModeAtom: "isAiChatSidebarMode", aiChatSidebarWidthPxAtom: "aiChatSidebarWidthPx",
  };
  const { usePageLoadReservations } = load("src/hooks/General/usePageLoadReservations.ts", {
    "@/lib/state": { useRecoilValue: (atom) => state[atom] },
    "@/store": atoms,
    "@/lib/configs/style.config": { AI_CHAT_SIDEBAR_MIN_PX: 340 },
    "@/components/Global/mobileShellVisibility": load("src/components/Global/mobileShellVisibility.ts", {}),
  });
  return usePageLoadReservations(state);
}

function renderWorkspace({ pathname, mobile = false, topBar = false, dock = false, sidebar = false, width = 420, panels }) {
  const MobileViewContext = React.createContext(mobile);
  const Frame = load("src/components/AI_CHAT/AI_Chat_Closed_Layout.tsx", {
    react: React,
    "@/hooks/useFlag": { useFlag: () => false, useFlagReady: () => true, useFlagLoaded: () => true },
    "@/lib/flags/keys": load("src/lib/flags/keys.ts", {}),
    "next/navigation": { usePathname: () => pathname },
    "lucide-react": { ChevronLeft: noop },
    "@/components/Common/Tooltip": { default: noop },
    "@/lib/contexts/mobileContext": { MobileViewContext },
    "@/utils/undoActions/helperFuncs": { cn: (...parts) => parts.filter(Boolean).join(" ") },
  });
  return load(globalProvider, {
    AIChatClosedLayout: Frame, showMobileTabBar: topBar,
    mobileBottomInsetVisible: dock, mobilePullCommandVisible: false,
    openAIChatInterface: noop, showAiChatInterface: sidebar,
    sidebarWidthPx: reservations({
      mbl: mobile, pathname, authenticatedUserId: 985, showAiChatInterface: sidebar,
      isAiChatSidebarMode: true, aiChatSidebarWidthPx: width,
    }).sidebarWidthPx,
    shouldMountChatRuntime: true, Suspense: React.Suspense,
    AIChatPanels: () => panels,
    CachedTaskDetailNavigation: ({ children }) => children,
    authenticatedUserId: 985, children: React.createElement("div", { "data-page": true }, "Page content"),
  }, "<AIChatClosedLayout>");
}

const documentFor = (element) => new JSDOM(renderToString(element)).window.document;

test("mobile shell space exists before the authenticated profile finishes loading", () => {
  for (const pathname of ["/project", "/inbox", "/detail/project-7049/31", "/login", "/share/task/1"]) {
    const dependencies = {
      mbl: true, authenticatedUserId: 985, currentUserId: undefined, pathname,
      mobilePageHideDockFlag: false, commentComposerOpen: false, agentChatHidesMobileShell: false,
    };
    const render = () => {
      const { showMobileTabBar: topBar, showMobileBottomInset: dock } = reservations(dependencies);
      return documentFor(renderWorkspace({ pathname, mobile: true, topBar, dock })).querySelector("[data-ai-workspace]");
    };
    const pending = render();
    dependencies.currentUserId = 985;
    const ready = render();
    assert.equal(pending.className, ready.className, "profile resolution must not move the page");
    const hidden = pathname.startsWith("/login") || pathname.startsWith("/share");
    assert.equal(pending.className.includes("pt-[var(--mobile-top-bar-h)]"), !hidden, pathname);
    dependencies.currentUserId = undefined;
    dependencies.authenticatedUserId = null;
    assert.equal(render().className.includes("mobile-tab-bar-content"), false, "signed-out pages must not gain shell padding");
  }
});

test("task auto-open reserves the lazy desktop sidebar width without affecting closed, floating or mobile chat", () => {
  const state = {
    mbl: false, isAiChatSidebarMode: true, showAiChatInterface: false,
    pathname: "/detail/project-7049/31", authenticatedUserId: 985, aiChatSidebarWidthPx: 420,
    aiChatPinned: false, openAiChatByDefault: true, aiChatAutoOpenSuppressed: false,
  };
  assert.equal(reservations(state).sidebarWidthPx, 420);
  for (const [change, expected] of [
    [{ aiChatAutoOpenSuppressed: true }, false],
    [{ openAiChatByDefault: false }, false],
    [{ aiChatPinned: true, openAiChatByDefault: false }, true],
    [{ isAiChatSidebarMode: false }, false],
    [{ mbl: true }, false],
    [{ authenticatedUserId: null }, false],
    [{ pathname: "/project" }, false],
    [{ pathname: "/project", showAiChatInterface: true }, true],
  ]) assert.equal(reservations({ ...state, ...change }).sidebarWidthPx, expected ? 420 : 0, JSON.stringify(change));

  for (const width of [280, 420, 600]) {
    const pending = documentFor(renderWorkspace({ pathname: "/detail/project-7049/31", sidebar: true, width }));
    const ready = documentFor(renderWorkspace({ pathname: "/detail/project-7049/31", sidebar: true, width,
      panels: React.createElement("aside", { style: { width: Math.max(width, 340) }, "data-ai-chat-panel": true }),
    }));
    const slot = pending.querySelector("[data-ai-chat-slot]");
    assert.ok(slot, "the slot must exist even before the lazy runtime or panels load");
    assert.equal(slot.style.width, `${Math.max(width, 340)}px`);
    assert.equal(slot.className, "shrink-0");
    const readySlot = ready.querySelector("[data-ai-chat-slot]");
    assert.equal(slot.style.width, readySlot.style.width);
    assert.equal(slot.className, readySlot.className);
    assert.ok(pending.querySelector("[data-page]"), "ticket content must not wait for chat");
  }
  const closed = documentFor(renderWorkspace({ pathname: "/detail/project-7049/31" }));
  assert.equal(closed.querySelector("[data-ai-chat-slot]").style.width, "");
});

test("title autosizing reads the attached ref during layout, without waiting for another paint", () => {
  const layouts = [], effects = [];
  const useAutosize = load("src/hooks/General/useAutosizeTextarea.ts", {
    react: {
      useRef: (current) => ({ current }),
      useLayoutEffect: (callback) => layouts.push(callback),
      useEffect: (callback) => effects.push(callback),
    },
    "@/lib/configs/aiTaskWriter.config": { aiTaskWriterConfig: {} },
  });
  const ref = { current: null };
  useAutosize(ref, "A title wrapping across two lines", undefined, "closed:420");
  ref.current = { style: { height: "70px" }, scrollHeight: 72 };
  layouts.forEach((effect) => effect());
  assert.equal(ref.current.style.height, "72px", "height must be correct in the first layout phase");
  assert.equal(ref.current.style.overflowY, "hidden");
  // A subsequent sidebar reflow still measures the current element and wrap width.
  layouts.length = 0;
  ref.current.scrollHeight = 108;
  useAutosize(ref, "A title wrapping across two lines", undefined, "open:600");
  layouts.forEach((effect) => effect());
  assert.equal(ref.current.style.height, "108px");
  const previousRaf = global.requestAnimationFrame;
  const previousCancel = global.cancelAnimationFrame;
  let nextFrame, cancelled;
  global.requestAnimationFrame = (callback) => { nextFrame = callback; return 17; };
  global.cancelAnimationFrame = (id) => { cancelled = id; };
  try {
    const cleanup = effects[effects.length - 2]();
    assert.equal(typeof nextFrame, "function", "sidebar width changes still get the HTPR-4321 post-reflow measure");
    ref.current.scrollHeight = 144;
    nextFrame();
    assert.equal(ref.current.style.height, "144px", "the second measure uses the settled ancestor width");
    cleanup();
    assert.equal(cancelled, 17);
  } finally {
    global.requestAnimationFrame = previousRaf;
    global.cancelAnimationFrame = previousCancel;
  }
  assert.equal(effects.length, 4, "post-reflow and viewport-resize effects are retained");
});

test("autosizing still accepts a nullable DOM element and preserves Task Writer height caps", () => {
  const layouts = [];
  const useAutosize = load("src/hooks/General/useAutosizeTextarea.ts", {
    react: { useRef: (current) => ({ current }), useLayoutEffect: (callback) => layouts.push(callback), useEffect: noop },
    "@/lib/configs/aiTaskWriter.config": { aiTaskWriterConfig: { fontSizes: { placeholder: "24px" } } },
  });
  for (const element of [null, { style: {}, scrollHeight: 72 }]) {
    layouts.length = 0;
    useAutosize(element, "Shared title");
    layouts.forEach((callback) => callback());
    if (element) assert.equal(element.style.height, "72px");
  }
  const writer = { style: {}, scrollHeight: 240 };
  const details = { createTask: true, isMobile: true, maxHeightPx: 120 };
  layouts.length = 0;
  useAutosize(writer, "Draft", details);
  layouts.forEach((callback) => callback());
  assert.equal(writer.style.height, "120px");
  assert.equal(writer.style.overflowY, "auto");
  layouts.length = 0;
  useAutosize(writer, "", details);
  layouts.forEach((callback) => callback());
  assert.equal(writer.style.height, "24px");
});

test("the task title passes its stable ref to autosizing on the first render", () => {
  const task = { id: 42, title: "Cached title" };
  let sizingRef;
  const Title = load("src/components/PageComponents/TaskDetail/TopRow/TaskTitle.tsx", {
    react: React,
    "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => ({ parsedTask: JSON.stringify(task), currentTask: task }) },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "@/store": {},
    "@/lib/state": { useRecoilState: () => [null, noop], useRecoilValue: () => false },
    "@/utils/api/Task Detail": {},
    "react-hot-toast": { default: noop },
    "@/lib/constants/TaskDetail": {},
    "@/hooks/MultiPages/Route/useHypertasksNavigate": { default: () => ({ navigate: noop }) },
    "@/hooks/MultiPages/useClickOutside": { default: noop },
    "@/components/Modals/Common Modals/ConfirmActionModal": { default: noop },
    "@/hooks/General/useAutosizeTextarea": { default: (ref) => { sizingRef = ref; } },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/hooks/General/useDebounce": { default: noop },
    "@/components/Common/Tooltip": { default: noop },
    "lucide-react": { Circle: noop },
    "@/hooks/MultiPages/useUpdateTaskInBoards": { default: () => ({ updateTaskInCache: noop }) },
    "./RunningTimerIndicator": { default: noop },
  });
  const html = renderToString(React.createElement(Title));
  assert.ok(sizingRef && "current" in sizingRef, "the initial null DOM node cannot size the title");
  assert.match(html, /Cached title/);
  assert.equal(new JSDOM(html).window.document.querySelector("textarea").rows, 1);
});

test("an unset priority stays null while its background query loads, keeping the No Priority row height", () => {
  const metaHook = load("src/lib/useTaskDetailMetaField.ts", {
    "@tanstack/react-query": { useQuery: (options) => ({ data: options.initialData }), useQueryClient: () => ({}) },
    "@/hooks/General/useAuth": { useAuth: () => ({ authenticatedUserId: null }) },
    "@/hooks/useFlag": { useFlag: () => false, useFlagReady: () => true, useFlagLoaded: () => true },
    "@/lib/flags/keys": {},
    "@/lib/taskDetailReads": {},
  });
  const { useGetPriorityForTask } = load("src/hooks/MultiPages/useGetPriorityForTask.ts", {
    "@/lib/useTaskDetailMetaField": metaHook,
    "@tanstack/react-query": { useQuery: (options) => ({ data: options.initialData }) },
    "@/utils/api/global": { default: {} },
  });
  assert.equal(useGetPriorityForTask(["priority", 42], 42, null).data, null, "an empty array is truthy and renders a blank 24px priority instead of the final 27px label");
  const priority = { priority_index: 1 };
  assert.equal(useGetPriorityForTask(["priority", 42], 42, priority).data, priority);
});

test("a disabled board's empty Time row is absent before and after its summary loads", () => {
  let data;
  const TaskTime = load("src/components/PageComponents/TaskDetail/TaskInfoColumn/TaskTime.tsx", {
    react: React,
    "@/lib/constants": { default: {} },
    "react-hot-toast": { default: noop },
    "@/components/Common/Tooltip": { default: noop },
    "@/components/Modals/TimeLog/TimeLogModal": { default: noop },
    "@/hooks/Task Detail/useTimeTracking": { useTaskTime: () => ({ data, dataUpdatedAt: 0 }), useTimerNow: () => 0 },
    "@/lib/constants/TaskDetail": {},
    "@/lib/timeDuration": { formatElapsed: (seconds) => `${seconds}s` },
    "@/lib/timeLogModal": {},
    "../MainPageComponents": {
      TaskInfoRow: ({ children }) => React.createElement("div", { "data-time-row": true }, children),
      LocalRightSideInfo: ({ title }) => title,
      TaskInfoValue: ({ children }) => children,
    },
  });
  const props = { taskId: 42, ticketId: "QA-42", title: "Task", timeTrackingEnabled: false };
  const render = () => documentFor(React.createElement(TaskTime, props));
  assert.equal(render().querySelector("[data-time-row]"), null, "pending data must not invent a row that disappears 48px later");
  data = { enabled: false, taskTotalSeconds: 0, runningEntry: null };
  assert.equal(render().querySelector("[data-time-row]"), null);
  data = undefined;
  props.timeTrackingEnabled = true;
  assert.ok(render().querySelector("[data-time-row]"), "enabled boards still reserve their timer row immediately");
  data = { enabled: false, taskTotalSeconds: 90, otherEntriesSeconds: 90 };
  props.timeTrackingEnabled = false;
  assert.match(render().body.textContent, /90s/, "disabled boards retain logged history");
  data = { enabled: false, taskTotalSeconds: 0, runningEntry: { startedAt: new Date(0).toISOString() } };
  assert.match(render().body.textContent, /Stop/, "an existing timer can still be stopped");
  const timer = load("src/components/PageComponents/TaskDetail/TaskInfoColumn/TaskInfo.tsx", {
    currentTask: { id: 42, title: "Task", project: { timeTrackingEnabled: false } },
    TaskTime: noop,
  }, "<TaskTime>");
  assert.equal(timer.props.timeTrackingEnabled, false, "use the board setting already present in the task snapshot");
});

function editorPanels(flag) {
  return load("src/components/RTE/TaskDetailEditorPanels.tsx", {
    useFlag: (key) => key === "instant" && flag,
    HTPR_6752_INSTANT_TICKET_OPEN_FLAG: "instant",
    HTPR_6929_COMPOSE_TASK_WRITER_FLAG: "compose",
    HTPR_6937_NEW_TASK_WINDOW_FLAG: "new-task",
    useSetRecoilState: () => noop,
    showCommandsAtom: "commands",
    createPortal: noop,
    TiptapProvider: ({ children }) => children,
    TiptapBubbleMenu: noop,
    TiptapMainContainer: () => React.createElement("div", { "data-editor": true }),
    InnerHTMLDescription: ({ descriptionText }) => React.createElement("article", null, descriptionText),
    cn: (...parts) => parts.filter(Boolean).join(" "),
    taskDetailSpacing: { mobile: {} },
    EmojiGifPicker: noop,
    SetLinkModal: noop,
  }, "TaskDetailEditorPanels");
}

test("with instant open, the description reserves its real content before the editor exists", () => {
  for (const flag of [true]) {
    const Panels = editorPanels(flag);
    const context = {
      divIds: {}, currentTask: { id: 42 }, inViewObject: {},
      mode: "read-edit-description", id: "description", defaultContent: "Long cached description",
    };
    const first = documentFor(React.createElement(Panels, context));
    assert.equal(first.querySelector("article")?.textContent, context.defaultContent, "do not paint the 21px empty editor placeholder");
    const ready = documentFor(React.createElement(Panels, { ...context, editor: {} }));
    assert.ok(ready.querySelector("[data-editor]"), "the loaded editor still replaces the read-only placeholder");
    const comment = documentFor(React.createElement(Panels, { ...context, mode: "create-comment" }));
    assert.equal(comment.querySelector("article"), null, "new-comment editors are unchanged");
  }
});

function threadRender({ hydrated, mobile = false, measured = false, comments = false }) {
  const items = measured ? [{ index: 0, key: "description", start: 0 }, { index: 1, key: "bottom", start: 711 }] : [];
  if (comments) items.push({ index: 2, key: "comment-42", start: 711 });
  const Component = load("src/components/PageComponents/TaskDetail/CommentAndDescription/index.tsx", {
    useContext: React.useContext,
    MobileViewContext: React.createContext(mobile),
    useDescriptionAndCommentsContext: () => ({ comments: [{ text: "Existing comment" }], stacked: [] }),
    useFlag: () => true,
    HTPR_6752_INSTANT_TICKET_OPEN_FLAG: "instant",
    HTPR_6899_STABLE_LAYOUT_FLAG: "stable",
    HTPR_7074_TICKET_PAGE_CLS_FLAG: "cls",
    useThreadSettled: () => true,
    SettledComposerSlot: ({ children }) => children,
    useTaskContext: () => ({
      currentTask: { id: 42 }, secondaryPanelsReady: true,
      virtualizer: { getVirtualItems: () => items, getTotalSize: () => measured ? (comments ? 800 : 711) : 200, measureElement: noop },
      virtualizeIndexes: { taskInfoVirtualIndex: -1, descriptionVirtualIndex: 0, descriptionBottomVirtualIndex: 1, commentsStartVirtualIndex: 2, numberOfComments: comments ? 1 : 0 },
      visibleFeedItems: [{ kind: "comment", commentIndex: 0 }],
    }),
    useHydrated: () => hydrated,
    BaseCommentAndDescriptionContainer: ({ children }) => React.createElement("main", null, children),
    RichTextPersonHovercards: noop,
    Description: () => React.createElement("article", { style: { height: 711 }, "data-description": true }, "Cached description"),
    NewCommentComponent: () => React.createElement("div", { id: "comment", style: { height: 168 } }, "Composer"),
    taskDetailSpacing: { mobile: {} },
    CommentsProvider: ({ children }) => children,
    CommentsContainer: () => React.createElement("div", { "data-stored-comment": true }, "Existing comment"),
    Suspense: React.Suspense,
  }, "CommentAndDescriptionContainer");
  return React.createElement(Component, {});
}

test("desktop description is in normal flow on the first paint, while comments and mobile keep virtualization", () => {
  for (const hydrated of [true]) {
    const document = documentFor(threadRender({ hydrated }));
    const description = document.querySelector("[data-description]");
    assert.ok(description, "the pinned description must exist before virtualizer viewport measurements");
    assert.equal(description.parentElement.style.position, "relative");
    assert.equal(description.parentElement.style.transform, "");
    assert.equal(description.parentElement.parentElement.style.height, "");
    assert.equal(description.parentElement.parentElement.style.minHeight, "200px");
  }
  const ready = documentFor(threadRender({ hydrated: true, measured: true, comments: true }));
  assert.equal(ready.querySelectorAll("[data-description]").length, 1, "do not mount a second description or reload embeds");
  assert.equal(ready.querySelector("[data-stored-comment]").parentElement.style.position, "absolute");
  assert.equal(ready.querySelector("[data-stored-comment]").parentElement.style.transform, "translateY(711px)");
  const phone = documentFor(threadRender({ hydrated: true, measured: true, mobile: true }));
  assert.equal(phone.querySelector("[data-description]").parentElement.style.position, "absolute");
  assert.equal(phone.querySelector("[data-description]").parentElement.parentElement.style.height, "711px");
});

// CI runs unit tests without a Playwright browser; the source checks above still guard it there.
const browserInstalled = (() => {
  try { return require("node:fs").existsSync(require("playwright").chromium.executablePath()); } catch { return false; }
})();

test("rendered desktop composer does not move when description estimates settle or the AI sidebar toggles and resizes", { skip: !browserInstalled && "Playwright browser not installed" }, async () => {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const compose = (measured, width) => renderToString(renderWorkspace({
      pathname: "/detail/project-7049/31", sidebar: width > 0, width,
      panels: width > 0 ? React.createElement("aside", { style: { width } }) : undefined,
    })).replace('<div data-page="true">Page content</div>', renderToString(threadRender({ hydrated: true, measured })));
    const positions = [];
    for (const [measured, width] of [[false, 420], [true, 420], [true, 600], [true, 0], [true, 420]]) {
      await page.setContent(`<style>body{margin:0}.flex{display:flex}.flex-1{flex:1;min-width:0}.shrink-0{flex-shrink:0}.contents{display:contents}</style>${compose(measured, width)}`);
      positions.push(await page.locator("#comment").evaluate((node) => node.getBoundingClientRect().y));
    }
    assert.deepEqual(positions, [711, 711, 711, 711, 711], "reserve the description's natural height, not the virtualizer's initial 200px estimate");
  } finally {
    await browser.close();
  }
});
