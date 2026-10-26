const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const { load } = require("./task-route-loader.cjs");

const registry = load("src/lib/aiChat/chatShortcuts.ts", {});
const flag = load("src/lib/flags/definitions/htpr-7766-chat-shortcuts.ts", {});
const noop = () => {};

function loadHook(mocks) {
  const file = "src/hooks/MultiPages/AIChat/useChatShortcuts.tsx";
  const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: file,
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    if (name === "react/jsx-runtime") return require(name);
    assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency ${name}`);
    return { __esModule: true, ...mocks[name] };
  }, loaded, loaded.exports);
  return loaded.exports.useChatShortcuts;
}

function fixture(surface, { enabled = true, width = 1440 } = {}) {
  const dom = new JSDOM(`<input id="board"><section data-ai-chat-surface="${surface}" tabindex="-1">
    <button id="header">Chat</button><div data-ai-chat-scope><button id="scope">Scope</button></div>
    <div data-ai-chat-model><button id="model">Model</button></div><div data-ai-chat-composer>
    <div class="ProseMirror" contenteditable="true" tabindex="0"></div>
    <button data-ai-chat-recorder>Mic</button><button data-ai-chat-recording-submit>Send recording</button>
    <button data-ai-chat-recording-cancel>Cancel recording</button></div></section>
    <section data-ai-chat-surface="other"><textarea id="other"></textarea></section>`, { pretendToBeVisual: true });
  dom.window.innerWidth = width;
  const saved = new Map();
  const frames = [];
  for (const name of ["window", "document", "HTMLElement", "HTMLInputElement", "requestAnimationFrame"]) {
    saved.set(name, Object.getOwnPropertyDescriptor(global, name));
    global[name] = name === "requestAnimationFrame" ? (callback) => { frames.push(callback); } : name === "window" ? dom.window : name === "document" ? dom.window.document : dom.window[name];
  }
  const root = document.querySelector("section");
  const composer = root.querySelector(".ProseMirror");
  composer.getClientRects = () => [{ width: 500, height: 40 }];
  const actions = [];
  const sessions = ["a", "b", "c"].map((id, index) => ({ id, title: `Chat ${id}`, updatedAt: new Date(2026, 9, 26 - index).toISOString() }));
  const context = {
    sessions, historySessions: sessions, sessionPagingEnabled: true, currentSession: sessions[1],
    minimized: false, isTyping: false, isRecording: false,
    restoreChat: () => { context.minimized = false; actions.push("restore"); },
    startNewSession: async () => { actions.push("new"); },
    refreshHistorySessions: async () => { actions.push("refresh"); },
    selectSession: (id) => { actions.push(`select:${id}`); context.currentSession = sessions.find((session) => session.id === id); },
    handleAttachmentClick: () => actions.push("attach"), handleAddContext: () => actions.push("mention"),
    handleCancelStream: () => actions.push("stop"), deleteSession: async (id) => actions.push(`delete:${id}`),
  };
  const { createAiChatKeyboard } = load("src/hooks/MultiPages/AIChat/aiChatKeyboard.ts", {
    "@/lib/constants/keyboard-handler": { KeyCodes: { ENTER: 13, ESCAPE: 27, Q: 81, U: 85, D: 68 } },
    "@/lib/configs/general.config": { DIV_ID_CONSTANTS: { aiMentionList: "mentions" } },
    "@/lib/skills/slashSkills": { SLASH_MENU_DOM_ID: "slash-menu" },
    "./aiChatShared": { MOBILE_VIEWPORT_MAX_PX: 768 },
  });
  context.tiptapKeydown = (event) => createAiChatKeyboard({
    sharedShortcutsEnabled: true, isApple: false, editor: { isEmpty: false },
    showMentionList: Boolean(document.getElementById("mentions")),
    handleSendMessage: () => actions.push("send"), fileUpload: {},
  }).tiptapKeydown(event);
  for (const id of ["scope", "model"]) root.querySelector(`#${id}`).onclick = () => actions.push(id);
  root.querySelector("[data-ai-chat-recorder]").onclick = () => actions.push("mic");
  root.querySelector("[data-ai-chat-recording-submit]").onclick = () => actions.push("dictation-submit");
  root.querySelector("[data-ai-chat-recording-cancel]").onclick = () => actions.push("dictation-cancel");
  let pins = [], index = 0, slots = [], hook;
  const useChatShortcuts = loadHook({
    react: {
      useRef: (current) => slots[index++] ??= { current },
      useState: (initial) => { const slot = index++; if (!(slot in slots)) slots[slot] = initial; return [slots[slot], (next) => { slots[slot] = next; }]; },
    },
    "react-hot-toast": { default: { error: (message) => actions.push(message) } },
    "@/lib/state": { useRecoilState: () => [pins, (next) => { pins = next(pins); }] },
    "@/store": {},
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => context },
    "@/hooks/useFlag": { useFlag: (key) => { assert.equal(key, flag.default.key); return enabled; } },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/lib/flags/definitions/htpr-7766-chat-shortcuts": flag,
    "@/lib/aiChat/chatShortcuts": registry,
    "@/components/Modals/OptionPicker": { default: "OptionPicker" },
    "@/lib/configs/general.config": { DIV_ID_CONSTANTS: { aiMentionList: "mentions" } },
    "@/lib/skills/slashSkills": { SLASH_MENU_DOM_ID: "slash-menu" },
  });
  const render = () => { index = 0; hook = useChatShortcuts(); hook.surfaceRef(root); return hook; };
  render();
  root.addEventListener("keydown", (nativeEvent) => {
    const event = {
      nativeEvent, target: nativeEvent.target, currentTarget: root,
      key: nativeEvent.key, code: nativeEvent.code, keyCode: nativeEvent.keyCode, ctrlKey: nativeEvent.ctrlKey, metaKey: nativeEvent.metaKey,
      altKey: nativeEvent.altKey, shiftKey: nativeEvent.shiftKey,
      get defaultPrevented() { return nativeEvent.defaultPrevented; },
      preventDefault: () => nativeEvent.preventDefault(), stopPropagation: () => nativeEvent.stopPropagation(),
    };
    hook.onKeyDownCapture(event);
  }, true);
  const flush = () => { while (frames.length) frames.shift()(); };
  const press = (key, modifiers = {}, target = composer) => {
    target.focus();
    const event = new dom.window.KeyboardEvent("keydown", { key, keyCode: key === "Enter" ? 13 : key === "Escape" ? 27 : 0, bubbles: true, cancelable: true, ...modifiers });
    target.dispatchEvent(event); flush(); return event;
  };
  return {
    dom, root, composer, actions, context, render, press, flush, pins: () => pins,
    close: () => { dom.window.close(); for (const [name, value] of saved) { if (value) Object.defineProperty(global, name, value); else delete global[name]; } },
  };
}

for (const surface of ["fullscreen", "sidebar", "floating"]) {
  test(`${surface}: every shortcut uses existing actions and returns local composer focus`, async () => {
    const f = fixture(surface);
    try {
      for (const [key, modifiers, expected] of [
        ["b", { ctrlKey: true, shiftKey: true }, "scope"], ["m", { ctrlKey: true, shiftKey: true }, "model"],
        ["u", { ctrlKey: true }, "attach"], ["d", { ctrlKey: true, shiftKey: true }, "mic"],
        ["2", { altKey: true }, "mention"], ["Enter", {}, "send"], ["Enter", { ctrlKey: true }, "send"],
      ]) {
        assert.equal(f.press(key, modifiers).defaultPrevented, true);
        assert.equal(f.actions.at(-1), expected);
      }
      f.context.isTyping = true;
      assert.equal(f.press("Escape").defaultPrevented, true);
      assert.equal(f.actions.at(-1), "stop");
      f.context.isRecording = true;
      f.press("d", { ctrlKey: true, shiftKey: true });
      assert.equal(f.actions.at(-1), "dictation-submit");
      f.press("Enter"); assert.equal(f.actions.at(-1), "dictation-submit");
      f.press("Escape"); assert.equal(f.actions.at(-1), "dictation-cancel");
      f.context.isRecording = false;
      f.press("Tab", { ctrlKey: true }); assert.equal(f.actions.at(-1), "select:c");
      f.press("ArrowUp", { altKey: true }); assert.equal(f.actions.at(-1), "select:b");
      f.press("p", { ctrlKey: true, shiftKey: true }); assert.deepEqual(f.pins(), ["b"]);
      f.render(); f.press("p", { ctrlKey: true, shiftKey: true }); assert.deepEqual(f.pins(), []);
      f.context.minimized = true;
      f.press("q", { ctrlKey: true }, f.root.querySelector("#header"));
      assert.equal(f.context.minimized, false);
      assert.equal(document.activeElement === f.composer, true, "focus stays in the owning composer");
      f.press("o", { ctrlKey: true, shiftKey: true });
      await new Promise((resolve) => setImmediate(resolve)); f.flush();
      assert.equal(f.actions.filter((action) => action === "new").length, 1);
      assert.equal(document.activeElement === f.composer, true, "focus stays in the owning composer");
      f.dom.window.confirm = () => false;
      f.press("Backspace", { ctrlKey: true, shiftKey: true }); assert.ok(!f.actions.includes("delete:b"));
      f.dom.window.confirm = () => true;
      f.press("Backspace", { ctrlKey: true, shiftKey: true }); assert.equal(f.actions.at(-1), "delete:b");
      await new Promise((resolve) => setImmediate(resolve)); f.flush();
    } finally { f.close(); }
  });

  test(`${surface}: searchable help and session picker share the complete registry`, () => {
    const f = fixture(surface);
    try {
      f.press("/", { altKey: true });
      let modal = f.render().modal;
      assert.equal(modal.props.header, "Chat shortcuts");
      assert.equal(modal.props.options.length, 15);
      assert.deepEqual(modal.props.options.map((option) => option.hint), registry.CHAT_SHORTCUTS.map((shortcut) => registry.chatShortcutHint(shortcut.id)));
      modal.props.onClose(); f.flush(); assert.equal(document.activeElement === f.composer, true, "focus stays in the owning composer");
      f.press("f", { ctrlKey: true, shiftKey: true });
      modal = f.render().modal;
      assert.equal(modal.props.header, "Search chats");
      assert.deepEqual(modal.props.options.map((option) => option.id), ["a", "b", "c"]);
      modal.props.onSelect({ id: "c" }); f.flush();
      assert.equal(f.actions.at(-1), "select:c");
      assert.equal(document.activeElement === f.composer, true, "focus stays in the owning composer");
    } finally { f.close(); }
  });
}

test("board keys, other inputs, other windows, composition, repeats, phone and rollback remain untouched", () => {
  for (const config of [{}, { enabled: false }, { width: 390 }]) {
    const f = fixture("sidebar", config);
    try {
      const model = f.root.querySelector("[data-ai-chat-model]");
      f.root.querySelector("[data-ai-chat-composer]").append(model);
      assert.equal(f.press("Enter", {}, model.querySelector("button")).defaultPrevented, false);
      const controlled = document.createElement("div");
      controlled.setAttribute("data-agent-chat-ai-composer", "true");
      controlled.setAttribute("data-ai-chat-composer", "");
      controlled.innerHTML = '<textarea></textarea>';
      f.root.append(controlled);
      assert.equal(f.press("Enter", {}, controlled.querySelector("textarea")).defaultPrevented, false);
      assert.equal(f.press("u", { ctrlKey: true }, controlled.querySelector("textarea")).defaultPrevented, false);
      const unchanged = ["c", "j", "k", "/", "?", "Enter"];
      for (const key of unchanged) assert.equal(f.press(key, {}, document.getElementById("board")).defaultPrevented, false);
      for (const key of ["c", "j", "k", "/", "?"]) assert.equal(f.press(key).defaultPrevented, false);
      assert.equal(f.press("k", { ctrlKey: true }).defaultPrevented, false);
      assert.equal(f.press("Enter", { shiftKey: true }).defaultPrevented, false);
      assert.equal(f.press("o", { ctrlKey: true, shiftKey: true, isComposing: true }).defaultPrevented, false);
      assert.equal(f.press("o", { ctrlKey: true, shiftKey: true, repeat: true }).defaultPrevented, false);
      assert.equal(f.press("u", { ctrlKey: true }, document.getElementById("other")).defaultPrevented, false);
      if (config.enabled === false || config.width === 390) {
        assert.equal(f.press("o", { ctrlKey: true, shiftKey: true }).defaultPrevented, false);
      } else {
        const mentions = document.createElement("div"); mentions.id = "mentions"; document.body.append(mentions);
        assert.equal(f.press("Enter").defaultPrevented, false);
      }
      assert.deepEqual(f.actions, []);
    } finally { f.close(); }
  }
});

test("session navigation respects order and boundaries without wrapping", () => {
  assert.equal(registry.adjacentChatSession(["a", "b"], "b", "next"), undefined);
  assert.equal(registry.adjacentChatSession(["a", "b"], "a", "previous"), undefined);
  assert.equal(registry.adjacentChatSession(["a", "b"], undefined, "next"), "a");
  assert.equal(registry.adjacentChatSession([], undefined, "previous"), undefined);
  assert.equal(registry.chatShortcutHint("new", true), "Cmd+Shift+O");
  assert.equal(registry.chatShortcutHint("focus", true), "Ctrl+Q");
  assert.equal(flag.default.defaultMode, "OWNER_AND_QA");
  assert.equal(flag.default.releaseRisk.highRisk, "data-deletion");
});

test("Option shortcuts use physical codes on Apple layouts", () => {
  const f = fixture("floating");
  try {
    f.press("™", { altKey: true, code: "Digit2" });
    assert.equal(f.actions.at(-1), "mention");
    f.press("÷", { altKey: true, code: "Slash" });
    assert.equal(f.render().modal.props.header, "Chat shortcuts");
    assert.equal(registry.chatShortcutHint("mention", true), "Option+2");
  } finally { f.close(); }
});
