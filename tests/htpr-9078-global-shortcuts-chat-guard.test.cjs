const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const { load } = require("./task-route-loader.cjs");

const root = path.resolve(__dirname, "..");
const providerPath = path.join(root, "src/components/ProviderGlobal/GloablProviders.tsx");
const provider = fs.readFileSync(providerPath, "utf8");
const surfaces = load("src/lib/keyboard/chatSurfaceFocus.ts", {});

function handlerBody() {
  const start = provider.indexOf("const handleKeyPress");
  const end = provider.indexOf("const handleKeyUp", start);
  assert.ok(start >= 0 && end > start, "GloablProviders keeps its keydown handler");
  return provider.slice(start, end);
}

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
      <div class="tiptap ProseMirror" contenteditable="true" tabindex="0">hello</div>
    </div>
  </div>
  <button id="chat-send">Send</button>
</div>`;

const BOARD = `<main><div id="board"><input id="board-search"></div><div id="task-1" tabindex="0"></div></main>`;

test("the global keydown handler leaves every key to a focused chat box", () => {
  const body = handlerBody();
  assert.match(
    body,
    /if \(agentChatKeys && isChatSurfaceTarget\(e\.target\)\) return;/,
    "handleKeyPress must ignore keys typed in the agent chat before any shortcut runs",
  );
});

test("the chat guard runs before board favorites and every shortcut branch", () => {
  const body = handlerBody();
  const guard = body.indexOf("isChatSurfaceTarget(e.target)");
  for (const branch of [
    "isFavoriteBoardShortcut(e, isApple)",
    "KeyCodes.BACKSLASH",
    "KeyCodes.FORWARD_SLASH",
    "toggleKeyboardShortcuts",
    "isGlobalCreateTaskShortcut",
  ]) {
    const index = body.indexOf(branch);
    assert.ok(index > guard, `${branch} must run after the chat guard`);
  }
});

test("the guard reads the shipped agent chat keys flag", () => {
  assert.match(
    provider,
    /const agentChatKeys = useFlag\(HTPR_8093_AGENT_CHAT_KEYS_FLAG\);/,
    "the ticket reuses the shipped chat key flag",
  );
  assert.match(provider, /import \{ HTPR_8093_AGENT_CHAT_KEYS_FLAG \}/);
  assert.match(provider, /import \{ isChatSurfaceTarget \} from "@\/lib\/keyboard\/chatSurfaceFocus";/);
});

test("a tiptap composer rendered without the focused class still counts as chat", () => {
  withDom(SIDEBAR_CHAT, (document) => {
    const composer = document.querySelector("#agent-chat-composer-editor .ProseMirror");
    composer.focus();
    assert.equal(composer.className.includes("ProseMirror-focused"), false);
    assert.equal(surfaces.isChatSurfaceTarget(composer), true);
    assert.equal(surfaces.isChatSurfaceTarget(document.querySelector("#chat-send")), true);
  });
});

test("board focus is not treated as chat, so shortcuts still work there", () => {
  withDom(BOARD, (document) => {
    const input = document.querySelector("#board-search");
    input.focus();
    assert.equal(surfaces.isChatSurfaceTarget(input), false);
    document.querySelector("#task-1").focus();
    assert.equal(surfaces.isChatSurfaceTarget(document.querySelector("#task-1")), false);
  });
});
