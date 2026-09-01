const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, { interopDefault: true });
const {
  buildFullScreenChatPath,
  resolveFullScreenChatReturnPath,
} = jiti(path.join(root, "src/lib/aiChatDisplayMode.ts"));

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("the last side-panel or floating-window mode is persisted", () => {
  const store = source("src/store/index.ts");
  const modeAtom = store.match(
    /export const isAiChatSidebarModeAtom[\s\S]*?\n\}\);/
  );

  assert.ok(modeAtom, "isAiChatSidebarModeAtom should exist");
  assert.match(modeAtom[0], /default: true/);
  assert.match(modeAtom[0], /effects_UNSTABLE: \[persistAtom\]/);
});

test("full-screen chat returns to the remembered desktop mode", () => {
  const chat = source("src/app/chat/Chat.tsx");
  const switchHandler = chat.match(
    /const switchToDocked = \(\) => \{[\s\S]*?\n  \};/
  );

  assert.ok(switchHandler, "switchToDocked should exist");
  assert.doesNotMatch(switchHandler[0], /setIsSidebarMode\(true\)/);
  assert.match(chat, /aria-label="Exit full-screen AI chat"/);
  assert.match(chat, /<Minimize2/);
});

test("automatic board and task opening do not overwrite the saved mode", () => {
  const board = source("src/app/[...boardURL]/LandingPage.tsx");
  const task = source("src/app/detail/[...slug]/TaskDetailComp.tsx");
  const boardAutoOpen = board.match(
    /\/\/ Pinning always opens chat[\s\S]*?useEffect\(\(\) => \{[\s\S]*?\n\}\, \[/
  );
  const taskAutoOpen = task.match(
    /\/\/ Pinning always opens chat[\s\S]*?useEffect\(\(\) => \{[\s\S]*?\n  \}\, \[/
  );

  assert.ok(boardAutoOpen, "board auto-open effect should exist");
  assert.ok(taskAutoOpen, "task auto-open effect should exist");
  assert.doesNotMatch(boardAutoOpen[0], /setIsAiChatSidebarMode\(true\)/);
  assert.doesNotMatch(taskAutoOpen[0], /setIsAiChatSidebarMode\(true\)/);
  assert.match(boardAutoOpen[0], /isMblForChat/);
  assert.match(taskAutoOpen[0], /_mbl/);
  assert.match(boardAutoOpen[0], /setShowAiChatInterface\(true\)/);
  assert.match(taskAutoOpen[0], /setShowAiChatInterface\(true\)/);
});

test("mobile chat uses the approved header controls and guarded new-chat action", () => {
  const header = source("src/components/AI_CHAT/ChatHeader.tsx");
  const mobileBranch = header.match(/if \(isMbl\) \{[\s\S]*?\n  \}\n\n  return \(/);
  const newSessionHandler = header.match(
    /const handleStartNewSession = async \(\) => \{[\s\S]*?\n  \};/
  );

  assert.ok(mobileBranch, "mobile header must be a separate rendered branch");
  assert.ok(newSessionHandler, "new-chat handler must exist");
  assert.match(mobileBranch[0], /data-ai-chat-mobile-header/);
  assert.match(mobileBranch[0], /aria-label="Close AI chat"[\s\S]*?h-11 w-11/);
  assert.match(mobileBranch[0], /<AIModelDropDownButton/);
  assert.match(mobileBranch[0], /aria-label="Chat history"[\s\S]*?h-11 w-11/);
  assert.match(mobileBranch[0], /aria-label="New chat"[\s\S]*?h-11 w-11/);
  assert.match(mobileBranch[0], /disabled=\{isStartingNewSession\}/);
  assert.match(newSessionHandler[0], /if \(isStartingNewSession\) return;/);
  assert.match(
    newSessionHandler[0],
    /setIsStartingNewSession\(true\);[\s\S]*?await startNewSession\(\);/
  );
  assert.match(newSessionHandler[0], /catch \{[\s\S]*?toast\.error\(/);
  assert.match(newSessionHandler[0], /finally \{[\s\S]*?setIsStartingNewSession\(false\)/);
});

test("pinning chat does not overwrite the saved mode", () => {
  const header = source("src/components/AI_CHAT/ChatHeader.tsx");
  const commands = source("src/components/commands.tsx");

  assert.doesNotMatch(header, /setIsAiChatSidebarMode\(true\)/);
  assert.doesNotMatch(commands, /setIsSidebarMode\(true\)/);
  assert.match(header, /setAiChatPinned\(nextPinned\)/);
  assert.match(commands, /setAiChatPinned\(!aiChatPinned\)/);
});

test("the existing chat control still exposes floating and full-screen modes", () => {
  const header = source("src/components/AI_CHAT/ChatHeader.tsx");

  assert.match(header, /toggleSidebarMode\(\)/);
  assert.match(header, /buildFullScreenChatPath\(/);
  assert.match(header, /<PictureInPicture2/);
  assert.match(header, /<Maximize2/);
});

test("full-screen navigation stays inside Hypertask", () => {
  const chat = source("src/app/chat/Chat.tsx");

  assert.equal(
    buildFullScreenChatPath("/project?id=15#task"),
    "/chat?return_to=%2Fproject%3Fid%3D15%23task"
  );
  assert.equal(
    buildFullScreenChatPath("/project?id=15", "session-1"),
    "/chat/session-1?return_to=%2Fproject%3Fid%3D15"
  );
  for (const unsafePath of [
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/chat",
    "/chat/session-1",
    "/bad\0path",
    "/bad\npath",
  ]) {
    assert.equal(resolveFullScreenChatReturnPath(unsafePath), "/project");
  }
  assert.doesNotMatch(chat, /router\.back\(\)/);
  assert.match(chat, /router\.replace\(returnPath\)/);
  assert.match(chat, /buildFullScreenChatPath\(returnPath, session\.id\)/);
});
