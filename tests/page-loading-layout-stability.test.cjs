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
  let source = fs.readFileSync(path.join(root, relative), "utf8");
  if (declaration) {
    const tree = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let node;
    function visit(statement) {
      if (statement.name?.text === declaration ||
          statement.declarationList?.declarations.some((item) => item.name.text === declaration) ||
          (ts.isJsxElement(statement) && `<${statement.openingElement.tagName.getText(tree)}>` === declaration)) node = statement;
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
