const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const { load } = require("./task-route-loader.cjs");

const flag = load("src/lib/flags/definitions/htpr-7762-chat-new-session-focus.ts", {});
const hooks = {
  useCallback: (callback) => callback,
  useEffect: () => {},
  useRef: (current) => ({ current }),
  useMemo: (callback) => callback(),
  useState: (value) => [value, () => {}],
};
const noop = () => {};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function chat({ enabled = true, fullscreen = true } = {}) {
  const dom = new JSDOM('<button id="new-chat">New chat</button><div id="composer" tabindex="0" contenteditable="true"></div>', { url: "https://app.hypertask.ai/chat/old-session" });
  const composer = dom.window.document.getElementById("composer");
  const button = dom.window.document.getElementById("new-chat");
  button.focus();
  const request = deferred();
  const positions = [];
  const scopes = [];
  let pending;
  const context = {
    sessionIntentGenerationRef: { current: 0 }, sessionSetupRef: { current: null },
    resolvedBoardSessionRef: { current: null }, previousProjectIdRef: { current: null },
    clearMessageQueue: noop, selectSessionInHistory: noop, setDockedChatScope: (scope) => scopes.push(scope),
    createSession: () => request.promise, isFullScreenChat: fullscreen, currentProject: { id: 15 },
    editor: { commands: { focus: (position) => { positions.push(position); composer.focus(); } } },
  };
  const { useAiChatSessions } = load("src/hooks/MultiPages/AIChat/useAiChatSessions.ts", {
    react: hooks,
    "@/hooks/useFlag": { useFlag: (key) => { assert.equal(key, flag.default.key); return enabled; } },
    "@/lib/ai/chipEvents": { signalAiChip: () => {} },
    "@/lib/flags/definitions/htpr-7762-chat-new-session-focus": flag,
    "@/lib/agents/chatViewerState": { getNativeSidebarChat: () => null },
    "@/lib/constants": { default: {} },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/components/Common/AttachmentsUpload/FileUploadHandler": { useFileUpload: () => ({}) },
    "@/lib/byokSelectedProviderGate": { shouldBlockAiDueToByokProvider: () => false },
    "@/lib/demo/isGuestClient": { isGuestCookieUser: () => false },
  });
  const sessions = useAiChatSessions(context);
  const startNewSession = () => { pending = sessions.startNewSession(); return pending; };
  const { createAiChatKeyboard } = load("src/hooks/MultiPages/AIChat/aiChatKeyboard.ts", {
    "@/lib/constants/keyboard-handler": { KeyCodes: { O: 79, J: 74 } },
    "@/lib/skills/slashSkills": { SLASH_MENU_DOM_ID: "slash-menu" },
    "@/lib/configs/general.config": { DIV_ID_CONSTANTS: {} },
    "./aiChatShared": { MOBILE_VIEWPORT_MAX_PX: 768 },
  });
  const keyboard = createAiChatKeyboard({ ...context, startNewSession, showAiChatInterface: true, isApple: false });
  return {
    dom, button, composer, request, context, positions, scopes, sessions, startNewSession, keyboard,
    finish: async (session) => { request.resolve(session); return pending; },
  };
}

function fullScreenNewChat(chat, { enabled = false, sessions = [], activeSession } = {}) {
  const state = { sessions, activeSession };
  const refs = [];
  const navigations = [];
  let refIndex = 0;
  let effects = [];
  const file = path.join(__dirname, "../src/app/chat/Chat.tsx");
  const mocks = {
    react: {
      ...hooks,
      useRef: (current) => refs[refIndex++] ??= { current },
      useEffect: (effect) => effects.push(effect),
    },
    "react/jsx-runtime": require("react/jsx-runtime"),
    "@/hooks/useFlag": { useFlag: (key) => key === flag.default.key && enabled },
    "@/lib/ai/chipEvents": { signalAiChip: () => {} },
    "@/lib/flags/keys": {},
    "@/lib/flags/definitions/htpr-7762-chat-new-session-focus": flag,
    "@/lib/flags/definitions/htpr-7763-ctrl-tab-session-switch": { HTPR_7763_CTRL_TAB_SESSION_SWITCH_FLAG: "htpr-7763-ctrl-tab-session-switch" },
    "@/components/AI_CHAT/AI_Tiptap_Container": { AI_Tiptap_Container: "Composer" },
    "@/components/AI_CHAT/MessageList": { MessageList: "Messages" },
    "@/components/AI_CHAT/WelcomeScreen": { WelcomeScreen: "Welcome" },
    "@/hooks/MultiPages/useGetAllTeamsMinimal": { useGetAllTeamsMinimal: () => ({ data: [] }) },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": {
      useAiChatContext: () => ({ ...state, historySessions: [], selectSession: chat.sessions.selectSession, startNewSession: chat.startNewSession, editor: { view: { dom: chat.composer } } }),
    },
    "@/lib/aiChatDisplayMode": load("src/lib/aiChatDisplayMode.ts", {}),
    "@/lib/state": { useRecoilState: () => [[], noop], useRecoilValue: () => null },
    "@/store": {},
    "@/utils/aiChat/sortBoardsByRecent": { sortBoardsByRecent: (teams) => teams },
    "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
    "@/utils/generateTime": { __esModule: true, default: () => "" },
    "lucide-react": new Proxy({}, { get: (_, name) => String(name) }),
    "next/navigation": {
      useRouter: () => ({ replace: (url) => {
        navigations.push(url);
        chat.composer.replaceWith(chat.composer.cloneNode(true));
        chat.button.replaceWith(chat.button.cloneNode(true));
        chat.dom.window.history.replaceState(null, "", url);
      } }),
      useSearchParams: () => new URLSearchParams("return_to=%2Fmy-tasks"),
    },
  };
  const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency ${name}`);
    return mocks[name];
  }, loaded, loaded.exports);
  const findButton = (element) => {
    if (!element || typeof element !== "object") return;
    if (element.type === "button" && [element.props.children].flat(Infinity).some((child) => child?.props?.children === "New chat")) return element;
    return [element.props?.children].flat(Infinity).map(findButton).find(Boolean);
  };
  return {
    state, navigations,
    render: () => {
      refIndex = 0;
      effects = [];
      const previousWindow = global.window;
      global.window = chat.dom.window;
      try {
        const button = findButton(loaded.exports.default({ initialSessionId: "old-session" }));
        for (const effect of effects) effect();
        return button;
      } finally {
        if (previousWindow === undefined) delete global.window;
        else global.window = previousWindow;
      }
    },
  };
}

for (const entry of ["button", "Ctrl+Shift+O", "Ctrl+Shift+J"]) {
  test(`${entry} focuses the full-screen composer after delayed session creation`, async () => {
    const view = chat();
    try {
      if (entry === "button") fullScreenNewChat(view).render().props.onClick();
      else view.keyboard.layoutKeydown({ keyCode: entry.endsWith("O") ? 79 : 74, ctrlKey: true, shiftKey: true, preventDefault: noop });
      await new Promise((resolve) => setTimeout(resolve, 0));
      view.button.focus();
      assert.equal(view.dom.window.document.activeElement, view.button);
      assert.deepEqual(await view.finish({ id: "new-session" }), { id: "new-session" });
      assert.equal(view.dom.window.document.activeElement, view.composer);
      assert.deepEqual(view.positions, ["end"]);
    } finally { view.dom.window.close(); }
  });
}

test("New chat keeps composer focus when the completed session updates the rail URL", async () => {
  for (const enabled of [true, false]) {
    const view = chat({ enabled });
    const oldSession = { id: "old-session", title: "Existing chat", updatedAt: new Date(), messages: [{ role: "human", content: "Hello" }] };
    const newSession = { id: "new-session", title: "New chat", updatedAt: new Date(), messages: [] };
    const screen = fullScreenNewChat(view, { enabled, sessions: [oldSession], activeSession: oldSession.id });
    try {
      screen.render().props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
      view.button.focus();
      assert.deepEqual(await view.finish(newSession), newSession);
      screen.state.sessions = [newSession, oldSession];
      screen.state.activeSession = newSession.id;
      screen.render();
      assert.equal(view.dom.window.location.pathname, "/chat/new-session");
      assert.equal(view.dom.window.location.search, "?return_to=%2Fmy-tasks");
      assert.equal(view.dom.window.document.activeElement, enabled ? view.composer : view.dom.window.document.body);
      assert.equal(view.composer.isConnected, enabled);
      assert.deepEqual(screen.navigations, enabled ? [] : ["/chat/new-session?return_to=%2Fmy-tasks"]);
      assert.deepEqual(view.positions, enabled ? ["end"] : []);
    } finally { view.dom.window.close(); }
  }
});

test("flag off and docked chat preserve existing focus and scope behavior", async () => {
  for (const options of [{ enabled: false }, { fullscreen: false }]) {
    const view = chat(options);
    try {
      view.startNewSession();
      assert.deepEqual(await view.finish({ id: "new-session" }), { id: "new-session" });
      assert.equal(view.dom.window.document.activeElement, view.button);
      assert.deepEqual(view.positions, []);
      assert.deepEqual(view.scopes, options.fullscreen === false ? [null] : []);
    } finally { view.dom.window.close(); }
  }
});

test("failed or superseded creation never takes focus", async () => {
  for (const superseded of [false, true]) {
    const view = chat();
    try {
      view.startNewSession();
      if (superseded) view.sessions.selectSession("another-session");
      assert.equal(await view.finish(superseded ? { id: "stale-session" } : undefined), undefined);
      assert.equal(view.dom.window.document.activeElement, view.button);
      assert.deepEqual(view.positions, []);
      assert.equal(view.context.sessionIntentGenerationRef.current, superseded ? 2 : 1);
    } finally { view.dom.window.close(); }
  }
});

test("the focus flag is an Everyone-default bugfix with rollback metadata", () => {
  assert.equal(flag.default.key, "htpr-7762-chat-new-session-focus");
  assert.equal(flag.default.kind, "bugfix");
  assert.equal(flag.default.defaultMode, "EVERYONE");
  assert.equal(flag.default.releaseRisk.risk, "small");
  assert.ok(flag.default.releaseRisk.reason.length > 0);
});
