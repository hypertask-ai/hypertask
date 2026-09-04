const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const chat = fs.readFileSync(
  path.join(root, "src/app/agents/chat/AgentChatClient.tsx"),
  "utf8",
);

const narrowLayout = chat.slice(
  chat.indexOf("if (isNarrow)"),
  chat.indexOf("const content =", chat.indexOf("if (isNarrow)")),
);

test("mobile Agent Chat follows the keyboard-visible viewport behind its ticket flag", () => {
  assert.match(
    chat,
    /useFlag\(\s*"htpr-6129-mobile-agent-chat-viewport",?\s*\)/,
  );
  assert.match(
    chat,
    /useMobileVisualViewport\(\s*isMbl\s*&&\s*mobileAgentChatViewportEnabled,?\s*\)/,
  );
  assert.match(narrowLayout, /h-screen/);
  assert.match(
    narrowLayout,
    /`\$\{mobileAgentChatViewport\.visibleHeight\}px`[\s\S]*?:\s*"100dvh"/,
  );
});

test("desktop Agent Chat keeps its existing screen height", () => {
  const desktopLayout = chat.slice(chat.indexOf("const content ="));
  assert.match(desktopLayout, /className="flex h-screen overflow-hidden/);
  assert.doesNotMatch(desktopLayout, /100dvh/);
});
