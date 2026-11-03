const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const { load } = require("./task-route-loader.cjs");

const root = path.resolve(__dirname, "..");

const surfaces = load("src/lib/keyboard/chatSurfaceFocus.ts", {});
const flag = load("src/lib/flags/definitions/htpr-8093-agent-chat-keys.ts", {});

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

const SIDEBAR = `<div data-ai-chat-panel data-testid="ai-sidebar" class="ai-chat-sidebar bg-ai-chat">
  <div data-ai-chat-composer-root>
    <div data-ai-chat-composer data-agent-chat-ai-composer id="agent-chat-composer-editor">
      <div class="ProseMirror" contenteditable="true" tabindex="0">agent message</div>
    </div>
  </div>
  <button id="chat-send">Send</button>
</div>`;

const REGULAR_SIDEBAR = `<div data-ai-chat-panel class="ai-chat-sidebar bg-ai-chat">
  <div id="ai-chat-tiptap-editor"><div class="ProseMirror" contenteditable="true" tabindex="0"></div></div>
</div>`;

const FLOATING = `<div class="chatwindow"><div class="ProseMirror" contenteditable="true" tabindex="0"></div></div>`;

test("the agent chat box in the AI sidebar counts as chat focus", () => {
  withDom(SIDEBAR, (document) => {
    const composer = document.querySelector("#agent-chat-composer-editor .ProseMirror");
    composer.focus();
    assert.equal(surfaces.isAIChatElementFocused(), true);
    assert.equal(surfaces.isChatSurfaceTarget(composer), true);
  });
});

test("a message button inside the sidebar counts too, so keys pressed there stay put", () => {
  withDom(SIDEBAR, (document) => {
    const send = document.querySelector("#chat-send");
    send.focus();
    assert.equal(surfaces.isChatSurfaceTarget(send), true);
  });
});

test("the regular AI chat box still counts as chat focus", () => {
  withDom(REGULAR_SIDEBAR, (document) => {
    const composer = document.querySelector("#ai-chat-tiptap-editor .ProseMirror");
    composer.focus();
    assert.equal(surfaces.isAIChatElementFocused(), true);
  });
});

test("the floating chat window still counts as chat focus", () => {
  withDom(FLOATING, (document) => {
    const composer = document.querySelector(".chatwindow .ProseMirror");
    composer.focus();
    assert.equal(surfaces.isAIChatElementFocused(), true);
  });
});

test("the board and its task cards are not chat focus", () => {
  withDom(
    `<main><div id="board"><input id="title-input"></div><div id="task-1" tabindex="0"></div></main>`,
    (document) => {
      const input = document.querySelector("#title-input");
      input.focus();
      assert.equal(surfaces.isAIChatElementFocused(), false);
      assert.equal(surfaces.isChatSurfaceTarget(input), false);
      document.querySelector("#task-1").focus();
      assert.equal(surfaces.isChatSurfaceTarget(document.querySelector("#task-1")), false);
    },
  );
});

test("the flag ships on for everyone as a bug fix for the reported keys", () => {
  assert.equal(flag.HTPR_8093_AGENT_CHAT_KEYS_FLAG, "htpr-8093-agent-chat-keys");
  assert.equal(flag.default.kind, "bugfix");
  assert.equal(flag.default.defaultMode, "EVERYONE");
});

const guardedPages = [
  "src/app/inbox/Inbox.tsx",
  "src/app/inbox/agent/AgentInbox.tsx",
  "src/app/starred/StarredComp.tsx",
  "src/app/pinned/PinnedComp.tsx",
  "src/app/archived/ArchivedComp.tsx",
  "src/app/archived/ArchivedTasksComp.tsx",
  "src/app/archived/ArchivedInboxComp.tsx",
  "src/app/reminders/ReminderPageComponent.tsx",
];

for (const file of guardedPages) {
  test(`${path.basename(file)} ignores keys typed in a chat box`, () => {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(
      source,
      /HTPR_8093_AGENT_CHAT_KEYS_FLAG/,
      `${file} must read the ticket flag before changing its keyboard map`,
    );
    assert.match(
      source,
      /isChatSurfaceTarget\(e\.target\)|isAIChatElementFocused\(\)/,
      `${file} must skip its keyboard map while a chat box owns the keyboard`,
    );
  });
}

for (const file of guardedPages) {
  test(`${path.basename(file)} reinstalls its keyboard listener when the flag changes`, () => {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(
      source,
      /\[\s*agentChatKeys\s*,/,
      `${file} must keep agentChatKeys in its listener dependencies so a flag switch takes effect`,
    );
  });
}

test("the shared helper is the only place that names the chat surfaces", () => {
  const helper = fs.readFileSync(path.join(root, "src/lib/keyboard/chatSurfaceFocus.ts"), "utf8");
  for (const selector of ["#ai-chat-tiptap-editor", "#agent-chat-composer-editor", ".chatwindow", "[data-ai-chat-panel]"]) {
    assert.ok(helper.includes(selector), `chatSurfaceFocus must know ${selector}`);
  }
  const pageHandlers = guardedPages.filter((file) =>
    /getElementById\("ai-chat-tiptap-editor"\)/.test(fs.readFileSync(path.join(root, file), "utf8")),
  );
  assert.deepEqual(
    pageHandlers,
    ["src/app/inbox/Inbox.tsx", "src/app/inbox/agent/AgentInbox.tsx"],
    "only the two inbox pages keep the old id as the flag-off path",
  );
});
