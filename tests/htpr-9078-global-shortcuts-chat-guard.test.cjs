const assert = require("node:assert/strict");
const path = require("node:path");
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

const SIDEBAR_CHAT = `<div data-ai-chat-panel class="ai-chat-sidebar bg-ai-chat">
  <div data-ai-chat-surface="sidebar">
    <div id="agent-chat-composer-editor">
      <div class="tiptap ProseMirror" contenteditable="true" tabindex="0">hello?</div>
    </div>
  </div>
  <button id="chat-send">Send</button>
</div>`;

const BOARD = `<main><div id="board"><input id="board-search"></div><div id="task-1" tabindex="0"></div></main>`;

test("a question mark typed in the sidebar agent chat is left to the chat", () => {
  withDom(SIDEBAR_CHAT, (document) => {
    const composer = document.querySelector("#agent-chat-composer-editor .ProseMirror");
    assert.equal(routes.chatOwnsKey(true, composer), true);
  });
});

test("a slash typed in the sidebar agent chat is left to the chat", () => {
  withDom(SIDEBAR_CHAT, (document) => {
    const composer = document.querySelector("#agent-chat-composer-editor .ProseMirror");
    assert.equal(routes.chatOwnsKey(true, composer), true);
  });
});

test("keys pressed on a chat button stay in the chat too", () => {
  withDom(SIDEBAR_CHAT, (document) => {
    assert.equal(routes.chatOwnsKey(true, document.querySelector("#chat-send")), true);
  });
});

test("keys in the chat are still left to it when the event reports nothing", () => {
  withDom(SIDEBAR_CHAT, (document) => {
    document.querySelector("#agent-chat-composer-editor .ProseMirror").focus();
    assert.equal(routes.chatOwnsKey(true, null), true);
  });
});

test("board keys keep running the global shortcuts", () => {
  withDom(BOARD, (document) => {
    const input = document.querySelector("#board-search");
    input.focus();
    assert.equal(routes.chatOwnsKey(true, input), false);
    document.querySelector("#task-1").focus();
    assert.equal(routes.chatOwnsKey(true, document.querySelector("#task-1")), false);
  });
});

test("with the flag off the chat does not stop the global shortcuts", () => {
  withDom(SIDEBAR_CHAT, (document) => {
    const composer = document.querySelector("#agent-chat-composer-editor .ProseMirror");
    assert.equal(routes.chatOwnsKey(false, composer), false);
  });
});
