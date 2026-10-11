const { readAgentChatSource } = require("./helpers/agent-chat-source.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const chat = readAgentChatSource();

const narrowLayout = chat.slice(
  chat.indexOf("if (isNarrow)"),
  chat.indexOf("const content =", chat.indexOf("if (isNarrow)")),
);

test("mobile Agent Chat always follows the keyboard-visible viewport", () => {
  const retired = /htpr-6129-mobile-agent-chat-viewport|mobileAgentChatViewportEnabled/;
  assert.throws(() => assert.doesNotMatch("mobileAgentChatViewportEnabled", retired));
  assert.doesNotMatch(chat, retired);
  assert.doesNotMatch(
    require("./helpers/flag-files.cjs").source(),
    retired,
  );
  assert.match(chat, /useMobileVisualViewport\(isMbl\)/);
  assert.match(chat, /const mobileChromeAwareHeight = isMbl;/);
  assert.match(
    narrowLayout,
    /!\(isMbl && \(mobileLayoutEnabled \|\| mobileFullscreenChrome\)\) &&\s*\n\s*"h-screen"/,
  );
  assert.match(narrowLayout, /height: mobileAgentChatHeight/);
  assert.match(narrowLayout, /mobileShellPaddingStyle/);
  assert.match(chat, /mobileChromeAwareHeight/);
  assert.match(
    chat,
    /`\$\{mobileAgentChatViewport\.visibleHeight\}px`[\s\S]*?: "100dvh"/,
  );
});

test("desktop Agent Chat keeps its existing screen height", () => {
  const desktopLayout = chat.slice(chat.indexOf("const content ="));
  assert.match(desktopLayout, /className="flex h-screen overflow-hidden/);
  assert.doesNotMatch(desktopLayout, /100dvh/);
});
