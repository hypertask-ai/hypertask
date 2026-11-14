const assert = require("node:assert/strict");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const { load } = require("./task-route-loader.cjs");

const routes = load("src/lib/keyboard/globalShortcutRoutes.ts", {});

function withDom(body, run) {
  const dom = new JSDOM(`<body>${body}</body>`, { pretendToBeVisual: true });
  const saved = new Map();
  for (const name of ["document", "HTMLElement", "Element"]) {
    saved.set(name, Object.getOwnPropertyDescriptor(global, name));
    global[name] = name === "document" ? dom.window.document : dom.window[name];
  }
  try {
    return run(dom.window.document);
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
  }
}

const typingKey = (keyCode, overrides = {}) => ({
  keyCode,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...overrides,
});

const FORWARD_SLASH = 191;
const LETTER_M = 77;
const ESCAPE = 27;
const LETTER_K = 75;

const SIDEBAR_AGENT_CHAT = `<div data-ai-chat-panel data-testid="ai-sidebar">
  <div data-ai-chat-composer-root>
    <div data-ai-chat-composer data-agent-chat-ai-composer>
      <div id="agent-chat-composer-editor">
        <div class="outline-none py-2 text-dense tiptap ProseMirror ProseMirror-focused" contenteditable="true" tabindex="0" role="textbox">hello</div>
      </div>
    </div>
  </div>
  <button data-chat-send tabindex="0">Send</button>
</div>`;

const BOARD = `<main><div id="board"><input id="title-input"></div><div id="task-1" tabindex="0"></div></main>`;

test("a question mark typed in the sidebar agent chat stays in the chat", () => {
  withDom(SIDEBAR_AGENT_CHAT, (document) => {
    const composer = document.querySelector(
      "#agent-chat-composer-editor .ProseMirror",
    );
    composer.focus();
    assert.equal(
      routes.chatOwnsKey(true, typingKey(FORWARD_SLASH, { shiftKey: true }), composer),
      true,
    );
  });
});

test("a slash typed in the sidebar agent chat does not open search", () => {
  withDom(SIDEBAR_AGENT_CHAT, (document) => {
    const composer = document.querySelector(
      "#agent-chat-composer-editor .ProseMirror",
    );
    assert.equal(routes.chatOwnsKey(true, typingKey(FORWARD_SLASH), composer), true);
  });
});

test("plain letters typed in the chat never reach the global shortcut map", () => {
  withDom(SIDEBAR_AGENT_CHAT, (document) => {
    const composer = document.querySelector(
      "#agent-chat-composer-editor .ProseMirror",
    );
    composer.focus();
    assert.equal(routes.chatOwnsKey(true, typingKey(LETTER_M), null), true);
    assert.equal(routes.chatOwnsKey(true, typingKey(LETTER_M), composer), true);
  });
});

test("a key pressed on a chat button still counts as chat", () => {
  withDom(SIDEBAR_AGENT_CHAT, (document) => {
    const send = document.querySelector("[data-chat-send]");
    assert.equal(routes.chatOwnsKey(true, typingKey(FORWARD_SLASH), send), true);
  });
});

test("modifier shortcuts keep working while the chat has focus", () => {
  withDom(SIDEBAR_AGENT_CHAT, (document) => {
    const composer = document.querySelector(
      "#agent-chat-composer-editor .ProseMirror",
    );
    composer.focus();
    assert.equal(
      routes.chatOwnsKey(true, typingKey(LETTER_K, { metaKey: true }), composer),
      false,
    );
    assert.equal(
      routes.chatOwnsKey(true, typingKey(LETTER_K, { ctrlKey: true }), composer),
      false,
    );
    assert.equal(
      routes.chatOwnsKey(true, typingKey(LETTER_K, { altKey: true }), composer),
      false,
    );
  });
});

test("escape still leaves the chat so panels stay closable", () => {
  withDom(SIDEBAR_AGENT_CHAT, (document) => {
    const composer = document.querySelector(
      "#agent-chat-composer-editor .ProseMirror",
    );
    composer.focus();
    assert.equal(routes.chatOwnsKey(true, typingKey(ESCAPE), composer), false);
  });
});

test("the board keeps its own keys", () => {
  withDom(BOARD, (document) => {
    const input = document.querySelector("#title-input");
    input.focus();
    assert.equal(routes.chatOwnsKey(true, typingKey(FORWARD_SLASH), input), false);
    assert.equal(
      routes.chatOwnsKey(true, typingKey(FORWARD_SLASH), document.querySelector("#task-1")),
      false,
    );
  });
});

test("the existing agent chat keys flag switches the guard off", () => {
  withDom(SIDEBAR_AGENT_CHAT, (document) => {
    const composer = document.querySelector(
      "#agent-chat-composer-editor .ProseMirror",
    );
    assert.equal(routes.chatOwnsKey(false, typingKey(FORWARD_SLASH), composer), false);
  });
});
