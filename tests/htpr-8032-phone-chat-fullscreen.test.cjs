const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { load } = require("./helpers/flag-files.cjs");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("phone chat fullscreen ships at Owner + QA and stays reversible", () => {
  const flagModule = load("src/lib/flags/definitions/htpr-8032-phone-chat-fullscreen.ts");
  assert.equal(flagModule.HTPR_8032_PHONE_CHAT_FULLSCREEN_FLAG, "htpr-8032-phone-chat-fullscreen");
  assert.equal(flagModule.default.key, flagModule.HTPR_8032_PHONE_CHAT_FULLSCREEN_FLAG);
  assert.equal(flagModule.default.kind, "improvement");
  assert.equal(flagModule.default.defaultMode, "OWNER_AND_QA");
  assert.equal(flagModule.default.releaseRisk.risk, "small");
});

test("flag on opens a full-screen phone chat that follows the keyboard and the safe areas", () => {
  const layout = read("src/components/AI_CHAT/AI_Chat_Layout.tsx");
  assert.match(layout, /useFlag\(HTPR_8032_PHONE_CHAT_FULLSCREEN_FLAG\)/);
  assert.match(layout, /useMobileVisualViewport\(phoneChatFullscreen && isMbl && showAiChatInterface\)/);
  assert.match(layout, /data-ai-chat-phone-fullscreen/);
  assert.match(layout, /pt-\[env\(safe-area-inset-top\)\]/);
  assert.match(layout, /keyboardOpen \? "pb-0" : "pb-\[env\(safe-area-inset-bottom\)\]"/);
  assert.match(layout, /\$\{phoneViewport\.visibleHeight\}px`[\s\S]*?: "100dvh"/);
  assert.match(layout, /phoneChatFullscreen \? phoneChatScreen\(<ChatWindow \/>\) : \(/);
  assert.match(layout, /phoneChatFullscreen \? phoneChatScreen\(<AI_Chat_Sidebar inOffcanvas \/>\) : \(/);
});

test("flag off keeps the phone chat on the sheet", () => {
  const layout = read("src/components/AI_CHAT/AI_Chat_Layout.tsx");
  const sheet = layout.slice(layout.indexOf("phoneChatFullscreen ? phoneChatScreen(<ChatWindow />)"));
  assert.match(sheet, /<AppSheet/);
  assert.match(sheet, /mobileOverlayAppSheetPanelClass/);
  assert.match(sheet, /aiChatMobileComposerPad/);
  const styles = read("src/components/Modals/Sheets/mobileOverlayAppSheetStyles.ts");
  assert.match(styles, /!max-h-\[85svh\] h-\[85svh\]/);
  const desktop = read("src/components/AI_CHAT/ChatWindow.tsx");
  assert.match(desktop, /h-\[70svh\]/);
  assert.doesNotMatch(desktop, /HTPR_8032_PHONE_CHAT_FULLSCREEN_FLAG/);
});

test("the board picker is one small header chip and a link tap still closes the chat", () => {
  const header = read("src/components/AI_CHAT/ChatHeader.tsx");
  assert.match(header, /aria-label="Close AI chat"/);
  assert.match(header, /phoneChatFullscreen && !pathname\?\.startsWith\("\/chat"\) && \(!sidebarChats \|\| sidebarChats\.target\.kind === "ai"\) && \([\s\S]*<ChatScopeControl[\s\S]*compact/);
  assert.match(header, /"z-sticky flex h-11 shrink-0 items-center gap-1 px-2 text-white-black"/);
  const chip = read("src/components/AI_CHAT/ChatScopeChip.tsx");
  assert.match(chip, /const small = compact && phoneChatFullscreen/);
  const smallClass = chip.match(/small\s*\?\s*"([^"]+)"/);
  assert.ok(smallClass);
  assert.match(smallClass[1], /max-w-32/);
  assert.doesNotMatch(smallClass[1], /h-11|Context/);
  const composer = read("src/components/AI_CHAT/AI_Tiptap_Container.tsx");
  assert.match(composer, /!\(phoneChatFullscreen && isMbl && !controlledComposer\)/);
  assert.match(composer, /phoneChatFullscreen && isMbl \? " shrink-0"/);
  assert.match(composer, /data-ai-chat-phone-board-chip=\{smallChip \|\| undefined\}/);
  const item = read("src/components/AI_CHAT/MessageItem.tsx");
  assert.match(item, /phoneChatFullscreen && isMbl && message\.role === "human"/);
  assert.match(item, /w-fit max-w-xs/);
  assert.match(item, /if \(isMbl && showAiChatInterface\) togglePopover\(\);/);
  const list = read("src/components/AI_CHAT/MessageList.tsx");
  assert.match(list, /phoneChatFullscreen && isMbl \? "space-y-3" : "space-y-2"/);
});
