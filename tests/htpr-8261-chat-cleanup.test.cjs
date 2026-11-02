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

test("the desktop chat action row puts the microphone left of Send", () => {
  const source = read("src/components/AI_CHAT/AiChatComposerActionRow.tsx");
  const desktop = source.slice(source.lastIndexOf("{attachmentControl}"));
  const order = ["{contextControl}", "{recorder}", "{streamControl}", "{sendControl}"].map((control) => desktop.indexOf(control));
  assert.ok(order.every((index) => index >= 0), "every desktop control is rendered");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "desktop order is attach, context, mic, stream, Send");
  assert.ok(desktop.indexOf("{attachmentControl}") < order[0]);
});

test("the chat Send renders a word instead of the paper plane", () => {
  const button = read("src/components/AI_CHAT/SendMessageButton.tsx");
  assert.match(button, /if \(label && !mobile\) \{[\s\S]*?\{label\}[\s\S]*?\n  \}/, "the label branch renders the word");
  const composer = read("src/components/AI_CHAT/AI_Tiptap_Container.tsx");
  assert.match(composer, /label=\{chatCleanupEnabled \? "Send" : undefined\}/);
});

test("listening replaces the microphone with a Dictation pill", () => {
  const audio = read("src/components/RTE/Components/AudioButton.tsx");
  assert.match(audio, /data-ai-chat-dictation-pill/);
  assert.match(audio, />Dictation<\/span>/);
  assert.match(audio, /compactListeningPill/);
  assert.match(read("src/components/AI_CHAT/AI_Tiptap_Container.tsx"), /compactListeningPill=\{chatCleanupEnabled && !isMbl\}/);
});

test("no sparkle or purple is left in the chat surfaces", () => {
  const window = read("src/components/AI_CHAT/ChatWindow.tsx");
  assert.match(window, /\{!chatCleanupEnabled && \(\s*<Sparkles/);
  const welcome = read("src/components/AI_CHAT/WelcomeScreen.tsx");
  assert.match(welcome, /\{!chatCleanupEnabled && \(\s*<Sparkles/);
  const message = read("src/components/AI_CHAT/MessageItem.tsx");
  assert.match(message, /if \(chatCleanupEnabled\) \{[\s\S]*?text-white-black">\{agentStatus\}/);
});
