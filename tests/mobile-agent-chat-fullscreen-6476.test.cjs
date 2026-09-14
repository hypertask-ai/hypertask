const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

const chat = fs.readFileSync(
  path.join(root, "src/app/agents/chat/AgentChatClient.tsx"),
  "utf8",
);
const keys = fs.readFileSync(path.join(root, "src/lib/flags/keys.ts"), "utf8");
const flags = fs.readFileSync(path.join(root, "src/lib/flags.ts"), "utf8");
const store = fs.readFileSync(path.join(root, "src/store/index.ts"), "utf8");
const providers = fs.readFileSync(
  path.join(root, "src/components/ProviderGlobal/GloablProviders.tsx"),
  "utf8",
);
const sendButton = fs.readFileSync(
  path.join(root, "src/components/AI_CHAT/SendMessageButton.tsx"),
  "utf8",
);
const actionRow = fs.readFileSync(
  path.join(root, "src/components/AI_CHAT/AiChatComposerActionRow.tsx"),
  "utf8",
);
const tipTap = fs.readFileSync(
  path.join(root, "src/components/AI_CHAT/AI_Tiptap_Container.tsx"),
  "utf8",
);
const viewport = fs.readFileSync(
  path.join(root, "src/lib/mobileCommentViewport.ts"),
  "utf8",
);

test("HTPR-6476 flag is registered Owner+QA by default", () => {
  assert.match(keys, /HTPR_6476_MOBILE_AGENT_CHAT_FULLSCREEN_FLAG/);
  assert.match(keys, /htpr-6476-mobile-agent-chat-fullscreen/);
  assert.match(
    flags,
    /key:\s*HTPR_6476_MOBILE_AGENT_CHAT_FULLSCREEN_FLAG[\s\S]*?hide the app top bar and bottom nav/,
  );
});

test("fullscreen atom hides shell only while Agent Chat publishes it", () => {
  assert.match(store, /agentChatMobileFullscreenAtom/);
  assert.match(providers, /agentChatMobileFullscreenAtom/);
  assert.match(providers, /!agentChatMobileFullscreen/);
  assert.match(chat, /setAgentChatMobileFullscreen\(mobileFullscreenChrome\)/);
  assert.match(
    chat,
    /mobileFullscreenFlag && isMbl && selectedAgent/,
  );
});

test("mobile fullscreen reuses AI send button and action row, not a new send control", () => {
  assert.match(sendButton, /export function SendMessageButton/);
  assert.match(tipTap, /from "\.\/SendMessageButton"/);
  assert.match(chat, /from "@\/components\/AI_CHAT\/SendMessageButton"/);
  assert.match(chat, /from "@\/components\/AI_CHAT\/AiChatComposerActionRow"/);
  assert.match(chat, /data-agent-chat-ai-composer/);
  assert.match(chat, /AiChatComposerActionRow/);
  assert.match(chat, /SendMessageButton/);
  const flaggedComposer = chat.slice(chat.indexOf("reuseAiComposer ?"));
  const legacySendLabel = flaggedComposer.indexOf(
    '{composerLocked ? "Queue" : "Send"}',
  );
  const elseBranch = flaggedComposer.indexOf(") : (");
  assert.ok(elseBranch > 0);
  assert.ok(
    legacySendLabel < 0 || legacySendLabel > elseBranch,
    "flagged composer must not keep the text Send/Queue button",
  );
});

test("action row skips empty mobile overflow menus", () => {
  assert.match(actionRow, /hasMobileOverflow/);
  assert.match(actionRow, /attachmentControl \|\| contextControl \|\| screenshotControl/);
});

test("hideDock drops tab-bar pad; keyboard still clears inset", () => {
  assert.match(
    viewport,
    /if \(hideDock\) return 0;/,
  );
  assert.match(chat, /pb-\[env\(safe-area-inset-bottom\)\]/);
  assert.match(chat, /hideDock:\s*hideDockInset/);
});

test("slim header keeps back + name only when fullscreen", () => {
  assert.match(chat, /!mobileFullscreenChrome && \(/);
  assert.match(chat, /isNarrow && !mobileFullscreenChrome/);
});
