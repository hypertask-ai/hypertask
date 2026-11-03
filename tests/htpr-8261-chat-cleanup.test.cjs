const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("AI chat cleanup flag is a Everyone improvement", () => {
  const { default: flag, HTPR_8261_CHAT_CLEANUP_FLAG: key } = loadModule("src/lib/flags/definitions/htpr-8261-chat-cleanup.ts");
  assert.equal(key, "htpr-8261-chat-cleanup");
  assert.equal(flag.key, key);
  assert.equal(flag.kind, "improvement");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
  assert.equal(flag.releaseRisk.highRisk, undefined);
});

test("listening replaces the microphone with a Dictation pill", () => {
  const audio = read("src/components/RTE/Components/AudioButton.tsx");
  assert.match(audio, /compactListeningPill\?: boolean/);
  assert.match(audio, /recording && !compactListeningPill && "w-full"/);
  assert.match(audio, /\) : compactListeningPill \? \(/);
  assert.match(audio, /data-ai-chat-dictation-pill/);
  assert.match(audio, />Dictation<\/span>/);
  assert.match(audio, /data-ai-chat-recording-submit=\{isAiChat \|\| undefined\}/);
  assert.match(audio, /data-ai-chat-recording-cancel=\{isAiChat \|\| undefined\}/);
});

test("the chat composer turns the pill on only on desktop", () => {
  const composer = read("src/components/AI_CHAT/AI_Tiptap_Container.tsx");
  assert.match(composer, /const chatCleanupEnabled = useFlag\(HTPR_8261_CHAT_CLEANUP_FLAG\)/);
  assert.match(composer, /compactListeningPill=\{chatCleanupEnabled && !isMbl\}/);
});

test("no sparkle is left in the chat surfaces", () => {
  const window = read("src/components/AI_CHAT/ChatWindow.tsx");
  assert.match(window, /\{!chatCleanupEnabled && \(\s*<Sparkles/);
  const welcome = read("src/components/AI_CHAT/WelcomeScreen.tsx");
  assert.match(welcome, /\{!chatCleanupEnabled && \(\s*<Sparkles/);
  assert.match(welcome, /chatCleanupEnabled\s*\? "flex w-full items-center gap-2 rounded-\[4px\] border-thin border-border-light-gray-thin/);
});
