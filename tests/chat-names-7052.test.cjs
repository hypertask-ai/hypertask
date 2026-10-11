// HTPR-7052: new AI chats are named from the ticket, the board, or the first message.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") } });
const names = jiti(path.join(root, "src/lib/ai/chatNames.ts"));
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("derives a plain-text title from the first message", () => {
  assert.equal(names.deriveChatTitle("  How do I   export\n my board? "), "How do I export my board?");
  assert.equal(names.deriveChatTitle("<p>Summarize <strong>this</strong> ticket</p>"), "Summarize this ticket");
  assert.equal(names.deriveChatTitle("**Plan** the [roadmap](https://x.test/a) for #launch with @Valentin"), "Plan the roadmap for launch with Valentin");
});

test("cuts long text at a word boundary with an ellipsis", () => {
  const title = names.deriveChatTitle("Please write a detailed summary of everything that happened on the marketing board last week");
  assert.ok(title.endsWith("..."));
  assert.ok(title.length <= names.CHAT_TITLE_MAX_LENGTH + 3);
  assert.equal(title, "Please write a detailed summary of everything that...");
  assert.equal(names.deriveChatTitle("a".repeat(80)), `${"a".repeat(50)}...`);
});

test("empty or markup-only text gives no title", () => {
  assert.equal(names.deriveChatTitle(""), "");
  assert.equal(names.deriveChatTitle(null), "");
  assert.equal(names.deriveChatTitle("<p> </p>"), "");
  assert.equal(names.firstMessageChatTitle(true, "New AI Chat", "   ", {}), null);
});

test("fallback order before any message: ticket, then board, then default", () => {
  assert.equal(names.initialChatTitle(true, { taskTitle: "Fix login", boardName: "Web" }), "Fix login");
  assert.equal(names.initialChatTitle(true, { taskTitle: " ", boardName: "Web" }), "Web");
  assert.equal(names.initialChatTitle(true, {}), null);
});

test("flag off keeps New AI Chat", () => {
  assert.equal(names.initialChatTitle(false, { taskTitle: "Fix login", boardName: "Web" }), null);
  assert.equal(names.firstMessageChatTitle(false, "New AI Chat", "hello there", {}), null);
});

test("first message replaces the default or a ticket-name placeholder", () => {
  assert.equal(names.firstMessageChatTitle(true, "New AI Chat", "Hello there", {}), "Hello there");
  assert.equal(names.firstMessageChatTitle(true, "Fix login", "Why does it fail?", { taskTitle: "Fix login" }), "Why does it fail?");
  assert.equal(names.firstMessageChatTitle(true, "Web", "Why?", { boardName: "Web" }), "Why?");
});

test("a manual rename is never overwritten", () => {
  assert.equal(names.firstMessageChatTitle(true, "My own name", "Hello there", { taskTitle: "Fix login" }), null);
  assert.equal(names.isAutoChatTitle("My own name", {}), false);
});

test("server names chats where titles are written, behind the flag", () => {
  const create = read("src/app/api/ai-chat/create-session/route.ts");
  assert.match(create, /isFeatureEnabled\(HTPR_7052_CHAT_NAMES_FLAG, userId\)/);
  assert.match(create, /\.\.\.\(initialTitle \? \{ title: initialTitle \} : \{\}\)/);
  const stream = read("src/lib/ai/chatStream/chatNames.ts");
  assert.match(stream, /isFeatureEnabled\(HTPR_7052_CHAT_NAMES_FLAG, input\.userId\)/);
  const modelTurn = read("src/lib/ai/chatStream/modelTurn.ts");
  assert.match(modelTurn, /chatNameGuardTitle !== null/);
  assert.match(modelTurn, /chatNameGuardTitle === undefined \? \{\} : \{ title: chatNameGuardTitle \}/);
  assert.match(read("src/hooks/MultiPages/AIChat/useSessionAndChatHistory.ts"), /const chatNames = useFlag\(HTPR_7052_CHAT_NAMES_FLAG\)/);
});
