const { readAgentChatSource } = require("./helpers/agent-chat-source.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const chat = readAgentChatSource();
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
const events = fs.readFileSync(
  path.join(root, "src/lib/agentWebhooks/events.ts"),
  "utf8",
);
const closedLayout = fs.readFileSync(
  path.join(root, "src/components/AI_CHAT/AI_Chat_Closed_Layout.tsx"),
  "utf8",
);

const narrowLayout = chat.slice(
  chat.indexOf("if (isNarrow)"),
  chat.indexOf("const content =", chat.indexOf("if (isNarrow)")),
);
const desktopLayout = chat.slice(chat.indexOf("const content ="));

test("mobile shell drops h-screen and uses chrome-aware classes", () => {
  assert.match(
    narrowLayout,
    /!isMbl && "h-screen"/,
  );
  assert.match(narrowLayout, /mobile-agent-chat/);
  assert.match(narrowLayout, /overscroll-y-none/);
  assert.match(
    chat,
    /mobileChromeAwareHeight[\s\S]*?: "100dvh"/,
  );
});

test("desktop Agent Chat height stays h-screen", () => {
  assert.match(desktopLayout, /className="flex h-screen overflow-hidden/);
  assert.doesNotMatch(desktopLayout, /100dvh/);
  assert.doesNotMatch(desktopLayout, /mobile-agent-chat/);
});

test("scroll button can sit above the composer on mobile", () => {
  assert.match(chat, /className="-top-12 z-50"/);
  assert.match(chat, /showScrollToBottom && isMbl/);
  assert.match(chat, /pb-12/);
});

test("activity rows keep a truncating text column", () => {
  assert.match(chat, /constrainRows/);
  assert.match(chat, /constrainRows=\{isMbl\}/);
  assert.match(chat, /block w-full/);
  assert.match(chat, /min-w-0 flex-1">\{eventContent\}/);
});

test("dictation uses an explicit agent board id on mobile", () => {
  assert.match(chat, /function agentDictationProjectId/);
  assert.match(
    chat,
    /projectId=\{\s*isMbl \? dictationProjectId : undefined\s*\}/,
  );
  assert.match(
    chat,
    /isMbl && dictationProjectId === null/,
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

test("chat.message carries ADHD reply guidance permanently", () => {
  assert.match(events, /replyGuidance\?: string/);
  assert.match(messagesRoute, /AGENT_CHAT_ADHD_REPLY_GUIDANCE/);
  assert.match(messagesRoute, /replyGuidance: AGENT_CHAT_ADHD_REPLY_GUIDANCE/);
});

test("closed AI layout does not double-pad /agents/chat", () => {
  assert.match(
    closedLayout,
    /\(pathname\?\.startsWith\(\s*["']\/settings["']\s*\)\s*&&\s*!settingsChatEnabled\)\s*\|\|\s*pathname\?\.startsWith\(\s*["']\/agents\/chat["']\s*\)/,
  );
  assert.match(
    narrowLayout,
    /mobile-tab-bar-content pt-\[var\(--mobile-top-bar-h\)\] pb-\[max\(var\(--mobile-dock-h,64px\),64px\)\]/,
  );
});
