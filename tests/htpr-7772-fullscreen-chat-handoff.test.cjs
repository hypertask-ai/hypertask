const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { load } = require("./helpers/flag-files.cjs");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("full-screen chat handoff defaults to Everyone and stays reversible", () => {
  const flagModule = load("src/lib/flags/definitions/htpr-7772-fullscreen-chat-handoff.ts");
  assert.equal(flagModule.HTPR_7772_FULLSCREEN_CHAT_HANDOFF_FLAG, "htpr-7772-fullscreen-chat-handoff");
  assert.equal(flagModule.default.key, flagModule.HTPR_7772_FULLSCREEN_CHAT_HANDOFF_FLAG);
  assert.equal(flagModule.default.kind, "bugfix");
  assert.equal(flagModule.default.defaultMode, "EVERYONE");
  assert.equal(flagModule.default.releaseRisk.risk, "small");
});

test("the full-screen chat shares the one conversation the docked chat keeps", () => {
  const state = read("src/hooks/MultiPages/AIChat/useAiChatState.ts");
  assert.match(state, /const fullScreenHandoff = useFlag\(HTPR_7772_FULLSCREEN_CHAT_HANDOFF_FLAG\);/);
  assert.match(state, /const manualDockedChat = manualChat && !\(pathname\?\.startsWith\("\/demo"\) \?\? false\) && \(!isFullScreenChat \|\| fullScreenHandoff\);/);
  const history = read("src/hooks/MultiPages/AIChat/useSessionAndChatHistory.ts");
  assert.match(history, /const selectionScope = manualChat \? `manual:\$\{teamKey \?\? "none"\}`/);
});

test("flag off leaves the full-screen chat on its own scope", () => {
  const state = read("src/hooks/MultiPages/AIChat/useAiChatState.ts");
  assert.doesNotMatch(state, /manualDockedChat = manualChat && !isFullScreenChat && !\(pathname/);
  assert.match(state, /\(!isFullScreenChat \|\| fullScreenHandoff\)/);
});

test("a ticket link in the full-screen chat opens the side panel before the app leaves the chat", () => {
  const item = read("src/components/AI_CHAT/MessageItem.tsx");
  assert.match(item, /const handoffEnabled = useFlag\(HTPR_7772_FULLSCREEN_CHAT_HANDOFF_FLAG\);/);
  assert.match(item, /if \(handoffEnabled && !isMbl && \(pathname\?\.startsWith\("\/chat"\) \?\? false\)\) openDockedChat\(\);/);
  assert.match(item, /interceptMessageLinkClick\(event, router, followInternalLink\);/);
  assert.match(item, /onNavigate=\{\(url\) => \{ followInternalLink\(\); router\.push\(url\); \}\}/);
  const presentation = read("src/hooks/MultiPages/AIChat/useAiChatPresentation.ts");
  assert.match(presentation, /const openDockedChat = \(\) => \{\n    setAiChatAutoOpenSuppressed\(false\);\n    setAiChatExplicitOpenAt\(Date\.now\(\)\);\n    setChatMounted\(true\);\n    setShowAIChat\(true\);\n  \};/);
  assert.match(presentation, /renameChat, openDockedChat,/);
  assert.doesNotMatch(presentation, /useSetRecoilState/);
  assert.match(presentation, /setAiChatAutoOpenSuppressed,\n  \} = context;/);
  const chat = read("src/hooks/MultiPages/AIChat/useAiChat.ts");
  assert.match(chat, /toggleRenameChatModal, renameChat, openDockedChat,/);
  assert.equal((chat.match(/^    openDockedChat,$/gm) ?? []).length, 1);
  const context = read("src/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context.tsx");
  assert.match(context, /^  openDockedChat: \(\) => void;$/m);
});

test("docked tickets keep the manual chat contract", () => {
  const state = read("src/hooks/MultiPages/AIChat/useAiChatState.ts");
  assert.match(state, /if \(manualChat\) historyTaskId = undefined;/);
  assert.match(state, /useSessionAndChatHistory\(historyTaskId, shouldLoadChatHistory, isDetailPage, manualDockedChat \|\| parallelChatsEnabled, manualDockedChat, modelTeamId\)/);
});
