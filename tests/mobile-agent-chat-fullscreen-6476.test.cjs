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
const shell = fs.readFileSync(
  path.join(root, "src/components/Global/mobileShellVisibility.ts"),
  "utf8",
);
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
const controlledEditor = fs.readFileSync(
  path.join(root, "src/lib/controlledComposerEditor.tsx"),
  "utf8",
);
const viewport = fs.readFileSync(
  path.join(root, "src/lib/mobileCommentViewport.ts"),
  "utf8",
);

test("HTPR-6476 flag is registered and defaults with Owner+QA mode", () => {
  assert.match(keys, /HTPR_6476_MOBILE_AGENT_CHAT_FULLSCREEN_FLAG/);
  assert.match(keys, /htpr-6476-mobile-agent-chat-fullscreen/);
  assert.match(
    flags,
    /key:\s*HTPR_6476_MOBILE_AGENT_CHAT_FULLSCREEN_FLAG[\s\S]*?hide the app top bar and bottom nav/,
  );
  assert.match(
    flags,
    /const DEFAULT_FEATURE_FLAG_MODE: FeatureFlagMode = "OWNER_AND_QA"/,
  );
  assert.doesNotMatch(
    flags,
    /key:\s*HTPR_6476_MOBILE_AGENT_CHAT_FULLSCREEN_FLAG[\s\S]{0,400}mode:\s*"EVERYONE"/,
  );
});

test("fullscreen atom hides shell only while Agent Chat publishes it", () => {
  assert.match(store, /agentChatMobileFullscreenAtom/);
  assert.match(providers, /agentChatMobileFullscreenAtom/);
  assert.match(providers, /isAgentChatPage/);
  assert.match(
    providers,
    /shouldMountAgentChatRuntime\s*=\s*isAgentChatPage && mbl && agentChatMobileFullscreenFlag/,
  );
  assert.match(
    providers,
    /isFullScreenChat \|\|\s*shouldMountAgentChatRuntime \|\|\s*isTaskDetailPage/,
  );
  assert.match(providers, /agentChatMobileFullscreenFlag && agentChatMobileFullscreenAtomOn/);
  assert.match(chat, /setAgentChatMobileFullscreen\(mobileFullscreenChrome\)/);
  assert.match(
    chat,
    /return \(\) => setAgentChatMobileFullscreen\(false\)/,
  );
  assert.match(
    chat,
    /mobileFullscreenFlag && isMbl && selectedAgent/,
  );
});

test("flagged Agent Chat also hides the mobile shell by path", () => {
  assert.match(shell, /export const isAgentChatPath/);
  assert.match(
    shell,
    /pathname === "\/agents\/chat" \|\| pathname\?\.startsWith\("\/agents\/chat\/"\)/,
  );
  assert.match(
    providers,
    /agentChatMobileFullscreenFlag && isAgentChatPath\(pathname\)/,
  );
});

test("mobile fullscreen renders the AI chat composer component itself", () => {
  assert.match(sendButton, /export function SendMessageButton/);
  assert.match(tipTap, /from "\.\/SendMessageButton"/);
  assert.match(
    chat,
    /import \{ AI_Tiptap_Container \} from "@\/components\/AI_CHAT\/AI_Tiptap_Container"/,
  );

  const flaggedStart = chat.indexOf("reuseAiComposer ? (");
  const flaggedEnd = chat.indexOf(") : (", flaggedStart);
  assert.ok(flaggedStart > 0 && flaggedEnd > flaggedStart);
  const flaggedComposer = chat.slice(flaggedStart, flaggedEnd);
  assert.match(flaggedComposer, /<AI_Tiptap_Container/);
  assert.doesNotMatch(flaggedComposer, /<textarea/);
  assert.doesNotMatch(flaggedComposer, /<AiChatComposerActionRow/);
  assert.doesNotMatch(flaggedComposer, /<AudioButton/);
  assert.doesNotMatch(flaggedComposer, /<SendMessageButton/);
  assert.match(tipTap, /<ControlledComposerEditor/);
  assert.match(tipTap, /from "@\/lib\/controlledComposerEditor"/);
  assert.match(controlledEditor, /<EditorContent editor=\{editor\}/);
  assert.match(tipTap, /useTiptapEditor/);
  assert.match(chat, /useTiptapEditor: true/);
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

test("6476 chrome-aware height applies only while an agent is open", () => {
  assert.match(chat, /mobileFullscreenChrome/);
  assert.match(
    chat,
    /mobileLayoutEnabled \|\|\s*mobileAgentChatViewportEnabled \|\|\s*mobileFullscreenChrome/,
  );
  assert.match(
    chat,
    /\(mobileLayoutEnabled \|\| mobileFullscreenChrome\) &&\s*\n\s*"mobile-agent-chat/,
  );
});

test("slim header keeps back + name only when fullscreen", () => {
  assert.match(chat, /!mobileFullscreenChrome && \(/);
  assert.match(chat, /isNarrow && !mobileFullscreenChrome/);
});
