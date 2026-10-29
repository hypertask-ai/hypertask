const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const noop = () => {};
const FLAG = "htpr-7763-ctrl-tab-session-switch";

function load(file, mocks = {}) {
  const loaded = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: file,
  }).outputText;
  new Function("require", "module", "exports", js)(name => {
    if (name === "react/jsx-runtime") return require(name);
    assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency ${name}`);
    return { __esModule: true, ...mocks[name] };
  }, loaded, loaded.exports);
  return loaded.exports;
}

const flag = load("src/lib/flags/definitions/htpr-7763-ctrl-tab-session-switch.ts");
const displayMode = load("src/lib/aiChatDisplayMode.ts");

function elements(tree, predicate) {
  if (!tree || typeof tree !== "object") return [];
  return [
    ...(predicate(tree) ? [tree] : []),
    ...[tree.props?.children].flat(Infinity).flatMap(child => elements(child, predicate)),
  ];
}

function fixture() {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const row = (id, days, extra = {}) => {
    const updatedAt = new Date(today);
    updatedAt.setDate(updatedAt.getDate() - days);
    return { id, title: `Match ${id}`, updatedAt: updatedAt.toISOString(), projectId: 15, hasMessages: true, ...extra };
  };
  return [
    row("older", 20), row("week", 3), row("today", 0), row("pinned", 30),
    row("hidden", 1, { title: "Other title" }), row("empty", 0, { hasMessages: false }),
    row("foreign", 0, { projectId: 99 }),
  ];
}

function chat({ shared = false, enabled = flag.default.defaultMode === "EVERYONE", paging = true, width = 1440, current = "today", rows = fixture() } = {}) {
  const dom = new JSDOM('<input id="search"><textarea id="composer"></textarea>', { url: "https://app.hypertask.ai/chat" });
  dom.window.innerWidth = width;
  const savedGlobals = ["window", "document", "setTimeout"].map(key => [key, Object.getOwnPropertyDescriptor(global, key)]);
  global.window = dom.window;
  global.document = dom.window.document;
  const timers = [];
  global.setTimeout = callback => { timers.push(callback); return timers.length; };
  const composer = document.getElementById("composer");
  const slots = [], effects = [], routes = [], selections = [];
  let cursor = 0, cleanups = [], tree, activeSlots = slots;
  const react = {
    useMemo: callback => callback(),
    useRef: current => activeSlots[cursor++] ??= { current },
    useState: initial => {
      const index = cursor++;
      if (!(index in activeSlots)) activeSlots[index] = initial;
      return [activeSlots[index], next => { activeSlots[index] = typeof next === "function" ? next(activeSlots[index]) : next; }];
    },
    useEffect: callback => { effects.push(callback); },
  };
  const context = {
    activeSession: current,
    currentSession: rows.find(row => row.id === current),
    sessions: paging ? [] : rows.map(({ hasMessages, ...row }) => ({ ...row, messages: hasMessages ? [{}] : [] })),
    historySessions: paging ? rows : [], sessionPagingEnabled: paging,
    hasMoreSessions: false, isLoadingMoreSessions: false, pagingError: null,
    refreshHistorySessions: noop, startNewSession: noop,
    editor: { view: { dom: composer } },
    selectSession: id => {
      selections.push(id);
      context.activeSession = id;
      context.currentSession = rows.find(row => row.id === id);
    },
  };
  const remountComposer = () => {
    document.activeElement?.blur?.();
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.appendChild(composer);
  };
  const router = { replace: route => { routes.push(route); remountComposer(); } };
  const { default: Chat } = load("src/app/chat/Chat.tsx", {
    react,
    "@/hooks/MultiPages/AIChat/useChatShortcuts": { useChatShortcuts: () => ({ enabled: shared }) },
    "@/lib/aiChat/chatShortcuts": { chatShortcutHint: () => "" },
    "@/components/Modals/OptionPicker": { default: "OptionPicker" },
    "@/lib/flags/definitions/htpr-7766-chat-shortcuts": { HTPR_7766_CHAT_SHORTCUTS_FLAG: "htpr-7766-chat-shortcuts" },
    "@/components/AI_CHAT/AI_Tiptap_Container": { AI_Tiptap_Container: "Composer" },
    "@/components/AI_CHAT/MessageList": { MessageList: "MessageList" },
    "@/components/AI_CHAT/WelcomeScreen": { WelcomeScreen: "WelcomeScreen" },
    "@/hooks/MultiPages/useGetAllTeamsMinimal": { useGetAllTeamsMinimal: () => ({ data: [] }) },
    "@/hooks/useFlag": { useFlag: key => key === FLAG ? enabled : paging },
    "@/lib/ai/chipEvents": { signalAiChip: () => {} },
    "@/lib/flags/keys": { HTPR_6971_CHAT_HISTORY_PAGING_FLAG: "paging" },
    "@/lib/flags/definitions/htpr-7763-ctrl-tab-session-switch": flag,
    "@/lib/flags/definitions/htpr-7762-chat-new-session-focus": { HTPR_7762_CHAT_NEW_SESSION_FOCUS_FLAG: "htpr-7762-chat-new-session-focus" },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => context },
    "@/lib/aiChatDisplayMode": displayMode,
    "@/lib/state": {
      useRecoilValue: () => ({ id: 7 }),
      useRecoilState: atom => react.useState(atom === "width" ? 280 : atom === "scope" ? 15 : atom === "pinned" ? ["pinned"] : null),
    },
    "@/store": { fullScreenChatRailWidthAtom: "width", fullScreenChatScopeAtom: "scope", aiChatPinnedSessionIdsAtom: "pinned", aiChatExplicitOpenAtAtom: "explicit" },
    "@/utils/aiChat/sortBoardsByRecent": { sortBoardsByRecent: teams => teams },
    "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
    "@/utils/generateTime": { default: () => "" },
    "lucide-react": Object.fromEntries(["Check", "ChevronDown", "Minimize2", "Pin", "Search", "Sparkles", "SquarePen", "Trash2"].map(name => [name, name])),
    "next/navigation": { useRouter: () => router, useSearchParams: () => new URLSearchParams("return_to=%2Fmy-tasks") },
  });
  function renderChildren(node) {
    if (!node || typeof node !== "object") return;
    const props = node.props ?? {};
    if (typeof node.type === "function") {
      const savedCursor = cursor;
      const savedSlots = activeSlots;
      cursor = 0;
      activeSlots = [];
      renderChildren(node.type({ ...props, children: undefined }));
      activeSlots = savedSlots;
      cursor = savedCursor;
    }
    [props.children].flat(Infinity).forEach(renderChildren);
  }
  function render() {
    cleanups.forEach(cleanup => cleanup?.());
    cleanups = [];
    cursor = 0;
    activeSlots = slots;
    tree = Chat({});
    renderChildren(tree);
    cleanups = effects.splice(0).map(effect => effect());
  }
  render();
  return {
    context, routes, selections, composer, dom,
    searchKey(overrides = {}) {
      const event = { key: "Enter", keyCode: 13, nativeEvent: { isComposing: false }, preventDefault: noop, stopPropagation: noop, ...overrides };
      elements(tree, node => node.type === "input")[0].props.onKeyDown(event);
      render();
    },
    get ids() { return elements(tree, node => node.type === "li").map(node => node.key); },
    get groups() { return elements(tree, node => node.type === "h2").map(node => node.props.children); },
    setFlag(value) { enabled = value; render(); },
    search(value) {
      elements(tree, node => node.type === "input")[0].props.onChange({ target: { value } });
      render();
    },
    get location() { return dom.window.location.pathname + dom.window.location.search; },
    remountComposer,
    drainTimers() {
      for (let pass = 0; pass < 5 && timers.length; pass++) timers.splice(0).forEach(callback => callback());
    },
    press(overrides = {}, { beforeTimers } = {}) {
      const event = new dom.window.KeyboardEvent("keydown", { key: "Tab", ctrlKey: true, bubbles: true, cancelable: true, ...overrides });
      if (overrides.defaultPrevented) event.preventDefault();
      document.getElementById("search").focus();
      const previousSelections = selections.length;
      document.activeElement.dispatchEvent(event);
      render();
      if (selections.length > previousSelections) {
        assert.equal(document.activeElement.id, "search", "composer focus waits until after selection renders");
      }
      beforeTimers?.();
      this.drainTimers();
      return event;
    },
    close() {
      cleanups.forEach(cleanup => cleanup?.());
      dom.window.close();
      for (const [key, descriptor] of savedGlobals) {
        if (descriptor) Object.defineProperty(global, key, descriptor);
        else delete global[key];
      }
    },
  };
}

for (const paging of [false, true]) {
  test(`${paging ? "paged" : "legacy"} rail order drives both directions, updates the address without navigating and keeps the caret in the composer`, () => {
    const view = chat({ paging });
    try {
      assert.deepEqual(view.groups, ["Pinned", "Today", "Previous 7 days", "Older"]);
      assert.deepEqual(view.ids, ["pinned", "today", "hidden", "week", "older"]);
      assert.equal(view.press().defaultPrevented, true);
      assert.equal(view.context.currentSession.id, "hidden");
      assert.equal(document.activeElement, view.composer);
      view.press();
      assert.equal(view.context.currentSession.id, "week");
      view.press({ shiftKey: true });
      assert.equal(view.context.currentSession.id, "hidden");
      view.press({ shiftKey: true });
      view.press({ shiftKey: true });
      assert.equal(view.context.currentSession.id, "pinned");
      assert.equal(document.activeElement, view.composer);
      assert.deepEqual(view.selections, ["hidden", "week", "hidden", "today", "pinned"]);
      assert.deepEqual(view.routes, []);
      assert.equal(view.location, "/chat/pinned?return_to=%2Fmy-tasks");
      assert.equal(document.activeElement, view.composer);
    } finally { view.close(); }
  });
}

test("switching chats updates the address without navigating and keeps the caret when the composer re-renders", () => {
  const view = chat();
  try {
    view.press();
    assert.equal(view.context.currentSession.id, "hidden");
    assert.deepEqual(view.routes, []);
    assert.equal(view.location, "/chat/hidden?return_to=%2Fmy-tasks");
    assert.equal(document.activeElement, view.composer);
    view.remountComposer();
    assert.notEqual(document.activeElement, view.composer);
    view.press();
    assert.equal(view.context.currentSession.id, "week");
    assert.equal(document.activeElement, view.composer);
  } finally { view.close(); }
});

test("search uses only displayed matches and stops at both ends without wrapping", () => {
  const view = chat({ current: "pinned" });
  try {
    view.search("  MATCH  ");
    assert.deepEqual(view.ids, ["pinned", "today", "week", "older"]);
    view.press({ shiftKey: true });
    assert.equal(view.context.currentSession.id, "pinned");
    assert.deepEqual(view.selections, []);
    for (let i = 0; i < 4; i++) view.press();
    assert.equal(view.context.currentSession.id, "older");
    assert.deepEqual(view.selections, ["today", "week", "older"]);
    assert.deepEqual(view.routes, []);
    assert.equal(view.location, "/chat/older?return_to=%2Fmy-tasks");
    view.press({ shiftKey: true });
    assert.equal(view.context.currentSession.id, "week");
    assert.equal(document.activeElement, view.composer);
    view.search("no matches");
    assert.deepEqual(view.ids, []);
    view.press();
    assert.equal(view.context.currentSession.id, "week");
  } finally { view.close(); }
});

test("missing, hidden and single active sessions never jump to a different session", () => {
  for (const current of ["missing", "hidden", "today"]) {
    const view = chat({ current });
    try {
      view.search("Match today");
      view.press();
      view.press({ shiftKey: true });
      assert.equal(view.context.currentSession?.id ?? "missing", current);
      assert.deepEqual(view.selections, []);
      assert.deepEqual(view.routes, []);
    } finally { view.close(); }
  }
});

test("flag Off and phone widths keep their keys; desktop starts at the visible rail breakpoint", () => {
  for (const config of [{ enabled: false }, { width: 390 }, { width: 767 }, { width: 768 }]) {
    const view = chat(config);
    try {
      const event = view.press();
      const desktopEnabled = config.width === 768;
      assert.equal(view.context.currentSession.id, desktopEnabled ? "hidden" : "today");
      assert.equal(event.defaultPrevented, desktopEnabled);
      assert.equal(document.activeElement.id, desktopEnabled ? "composer" : "search");
    } finally { view.close(); }
  }
});

test("other chat shortcuts and modifier combinations pass through without selecting a session", () => {
  const view = chat();
  try {
    for (const overrides of [
      { key: "O", shiftKey: true, keyCode: 79 },
      { key: "J", shiftKey: true, keyCode: 74 },
      { key: "q", keyCode: 81 },
      { ctrlKey: false }, { metaKey: true }, { altKey: true },
    ]) {
      assert.equal(view.press(overrides).defaultPrevented, false);
      assert.equal(view.context.currentSession.id, "today");
    }
    view.press({ defaultPrevented: true });
    assert.deepEqual(view.selections, []);
    view.press();
    assert.equal(view.context.currentSession.id, "hidden");
    assert.equal(document.activeElement, view.composer);
  } finally { view.close(); }
});

test("Everyone default enables switching and switching the flag Off removes the live listener", () => {
  const view = chat();
  try {
    assert.equal(flag.HTPR_7763_CTRL_TAB_SESSION_SWITCH_FLAG, FLAG);
    assert.equal(flag.default.key, FLAG);
    assert.equal(flag.default.kind, "feature");
    assert.equal(flag.default.shippedOn, "2026-10-24");
    assert.equal(flag.default.releaseRisk.risk, "small");
    assert.ok(flag.default.releaseRisk.reason.trim());
    view.press();
    assert.equal(view.context.currentSession.id, "hidden");
    view.setFlag(false);
    assert.equal(view.press().defaultPrevented, false);
    assert.equal(view.context.currentSession.id, "hidden");
    assert.equal(document.activeElement.id, "search");
    view.setFlag(true);
    view.press();
    assert.equal(view.context.currentSession.id, "week");
    assert.deepEqual(view.selections, ["hidden", "week"]);
  } finally { view.close(); }
});

test("existing Ctrl+Shift+O, Ctrl+Shift+J and Ctrl+Q still execute alongside session switching", () => {
  const view = chat();
  const { createAiChatKeyboard } = load("src/hooks/MultiPages/AIChat/aiChatKeyboard.ts", {
    "@/lib/aiChat/chatShortcuts": load("src/lib/aiChat/chatShortcuts.ts"),
    "@/lib/constants/keyboard-handler": load("src/lib/constants/keyboard-handler.ts"),
    "@/lib/skills/slashSkills": { SLASH_MENU_DOM_ID: "slash-menu" },
    "@/lib/configs/general.config": { DIV_ID_CONSTANTS: { aiMentionList: "mentions" } },
    "./aiChatShared": { MOBILE_VIEWPORT_MAX_PX: 768 },
  });
  let newChats = 0;
  const keyboard = createAiChatKeyboard({
    isApple: false, isFullScreenChat: true, showAiChatInterface: true,
    startNewSession: () => { newChats++; },
    editor: { view: { dom: view.composer }, commands: { focus: () => view.composer.focus() } },
  });
  document.addEventListener("keydown", keyboard.layoutKeydown);
  try {
    for (const [key, keyCode] of [["O", 79], ["J", 74]]) {
      assert.equal(view.press({ key, keyCode, shiftKey: true }).defaultPrevented, true);
      assert.equal(document.activeElement, view.composer);
    }
    assert.equal(newChats, 2);
    assert.equal(view.press({ key: "q", keyCode: 81 }).defaultPrevented, true);
    assert.equal(document.activeElement, view.composer);
    assert.deepEqual(view.selections, []);
    view.press();
    assert.equal(view.context.currentSession.id, "hidden");
    assert.equal(newChats, 2);
  } finally {
    document.removeEventListener("keydown", keyboard.layoutKeydown);
    view.close();
  }
});

test("full-screen rail search preserves IME commits and still selects with ordinary Enter", () => {
  const view = chat({ shared: true, current: "pinned" });
  const previousFrame = global.requestAnimationFrame;
  global.requestAnimationFrame = callback => callback();
  view.context.editor.commands = { focus: () => view.composer.focus() };
  try {
    view.search("MATCH");
    view.searchKey({ nativeEvent: { isComposing: true } });
    view.searchKey({ keyCode: 229 });
    assert.deepEqual(view.selections, []);
    view.searchKey();
    assert.deepEqual(view.selections, ["pinned"]);
    assert.equal(document.activeElement.id, "composer");
  } finally {
    if (previousFrame) global.requestAnimationFrame = previousFrame;
    else delete global.requestAnimationFrame;
    view.close();
  }
});
