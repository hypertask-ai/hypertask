const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const chat = fs.readFileSync(
  path.join(root, "src/app/agents/chat/AgentChatClient.tsx"),
  "utf8",
);
const audio = fs.readFileSync(
  path.join(root, "src/components/RTE/Components/AudioButton.tsx"),
  "utf8",
);
const topBar = fs.readFileSync(
  path.join(root, "src/components/Global/MobileTopBar.tsx"),
  "utf8",
);
const messagesRoute = fs.readFileSync(
  path.join(root, "src/app/api/agent-chat/[sessionId]/messages/route.ts"),
  "utf8",
);
const flags = fs.readFileSync(path.join(root, "src/lib/flags.ts"), "utf8");
const keys = fs.readFileSync(path.join(root, "src/lib/flags/keys.ts"), "utf8");
const events = fs.readFileSync(
  path.join(root, "src/lib/agentWebhooks/events.ts"),
  "utf8",
);

const narrowLayout = chat.slice(
  chat.indexOf("if (isNarrow)"),
  chat.indexOf("const content =", chat.indexOf("if (isNarrow)")),
);
const desktopLayout = chat.slice(chat.indexOf("const content ="));

test("HTPR-6407 flag is registered", () => {
  assert.match(keys, /HTPR_6407_MOBILE_AGENT_CHAT_LAYOUT_FLAG/);
  assert.match(keys, /htpr-6407-mobile-agent-chat-layout/);
  assert.match(keys, /AGENT_CHAT_ADHD_REPLY_GUIDANCE/);
  assert.match(
    flags,
    /key:\s*HTPR_6407_MOBILE_AGENT_CHAT_LAYOUT_FLAG[\s\S]*?Pins the Agent Chat composer on mobile/,
  );
});

test("flagged mobile shell drops h-screen and uses chrome-aware classes", () => {
  assert.match(chat, /HTPR_6407_MOBILE_AGENT_CHAT_LAYOUT_FLAG/);
  assert.match(chat, /mobileLayoutEnabled/);
  assert.match(narrowLayout, /!\(isMbl && mobileLayoutEnabled\) && "h-screen"/);
  assert.match(narrowLayout, /mobile-agent-chat/);
  assert.match(narrowLayout, /overscroll-y-none/);
  assert.match(
    chat,
    /if \(\s*isMbl &&\s*\(mobileLayoutEnabled \|\| mobileAgentChatViewportEnabled\)\s*\) \{[\s\S]*?: "100dvh"/,
  );
});

test("desktop Agent Chat height stays h-screen", () => {
  assert.match(desktopLayout, /className="flex h-screen overflow-hidden/);
  assert.doesNotMatch(desktopLayout, /100dvh/);
  assert.doesNotMatch(desktopLayout, /mobile-agent-chat/);
});

test("scroll button can sit above the composer when flagged", () => {
  assert.match(chat, /className="-top-12 z-50"/);
  assert.match(chat, /showScrollToBottom && isMbl && mobileLayoutEnabled/);
  assert.match(chat, /pb-12/);
});

test("activity rows keep a truncating text column", () => {
  assert.match(chat, /constrainRows/);
  assert.match(chat, /constrainRows=\{isMbl && mobileLayoutEnabled\}/);
  assert.match(chat, /block w-full/);
  assert.match(chat, /min-w-0 flex-1">\{eventContent\}/);
});

test("dictation uses an explicit agent board id behind the flag", () => {
  assert.match(chat, /function agentDictationProjectId/);
  assert.match(
    chat,
    /projectId=\{\s*isMbl && mobileLayoutEnabled \? dictationProjectId : undefined\s*\}/,
  );
  assert.match(
    chat,
    /isMbl && mobileLayoutEnabled && dictationProjectId === null/,
  );
  assert.match(audio, /projectId\?: number \| null/);
  assert.match(audio, /projectIdProp === undefined \? currentProject\?\.id/);
});

test("mobile top bar reads the published agent title on agent chat", () => {
  assert.match(topBar, /onAgentChat/);
  assert.match(topBar, /calendarTitle \?\? "Agents"/);
  assert.match(chat, /setMobileTopBarTitle/);
  assert.match(chat, /mobileTopBarTitleAtom/);
});

test("chat.message can carry ADHD reply guidance behind the flag", () => {
  assert.match(events, /replyGuidance\?: string/);
  assert.match(messagesRoute, /HTPR_6407_MOBILE_AGENT_CHAT_LAYOUT_FLAG/);
  assert.match(messagesRoute, /AGENT_CHAT_ADHD_REPLY_GUIDANCE/);
  assert.match(messagesRoute, /replyGuidance: AGENT_CHAT_ADHD_REPLY_GUIDANCE/);
});
