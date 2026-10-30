const { readAgentChatSource } = require("./helpers/agent-chat-source.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const chat = readAgentChatSource();

function loadDrafts(store) {
  const src = fs
    .readFileSync(path.join(root, "src/lib/agents/chatDrafts.ts"), "utf8")
    .replace(/^export /gm, "")
    .replace(/: (string|number|void|Storage \| null)\b/g, "")
    .replace(/\bwindow\b/g, "fakeWindow");
  const fakeWindow = store === null ? undefined : { localStorage: store };
  return new Function(
    "fakeWindow",
    `${src}; return { readDraft, writeDraft };`,
  )(fakeWindow);
}

function fakeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test("a draft survives a round trip and is scoped to one user and one agent", () => {
  const store = fakeStorage();
  const { readDraft, writeDraft } = loadDrafts(store);

  writeDraft(6, "agent-a", "half typed question");
  assert.equal(readDraft(6, "agent-a"), "half typed question");

  assert.equal(readDraft(6, "agent-b"), "");
  assert.equal(readDraft(7, "agent-a"), "");
});

test("an emptied composer clears the stored draft instead of leaving a ghost", () => {
  const store = fakeStorage();
  const { readDraft, writeDraft } = loadDrafts(store);

  writeDraft(6, "agent-a", "typed then sent");
  writeDraft(6, "agent-a", "   ");
  assert.equal(readDraft(6, "agent-a"), "");
  assert.equal(store.map.size, 0, "whitespace-only draft must remove the key");
});

test("a blocked or missing store degrades to no draft rather than throwing", () => {
  const throwing = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("QuotaExceededError");
    },
    removeItem() {
      throw new Error("SecurityError");
    },
  };
  const blocked = loadDrafts(throwing);
  assert.doesNotThrow(() => blocked.writeDraft(6, "agent-a", "x"));
  assert.equal(blocked.readDraft(6, "agent-a"), "");

  const serverSide = loadDrafts(null);
  assert.doesNotThrow(() => serverSide.writeDraft(6, "agent-a", "x"));
  assert.equal(serverSide.readDraft(6, "agent-a"), "");
});

test("switching agents saves the outgoing draft before restoring the incoming one", () => {
  const selectAgent = chat.slice(
    chat.indexOf("const selectAgent = useCallback("),
    chat.indexOf("const agentParam = searchParams?."),
  );
  const leavingAt = selectAgent.indexOf("const leaving = selectedIdRef.current");
  const reassignAt = selectAgent.indexOf("selectedIdRef.current = agent.id");
  assert.ok(leavingAt > -1 && reassignAt > leavingAt);
  assert.match(
    selectAgent,
    /writeDraft\(currentUser\.id, embedded\?\.draftKey \?\? leaving, draftRef\.current\)/,
  );
  assert.match(
    selectAgent,
    /const restored = readDraft\(currentUser\.id, embedded\?\.draftKey \?\? agent\.id\)/,
  );
  assert.match(selectAgent, /setDraft\(restored\)/);
  assert.doesNotMatch(selectAgent, /setDraft\(""\)/);
  assert.match(selectAgent, /\[router, openAgentSession, isMbl, currentUser\.id, embedded\?\.projectId\]/);
});

test("the mobile details sheet is a native modal dialog, so Escape and focus work", () => {
  const sheet = chat.slice(
    chat.indexOf("const detailsSheetShown ="),
    chat.indexOf("const closeCreateAgent ="),
  );
  assert.match(sheet, /<dialog/);
  assert.match(sheet, /el\.showModal\(\)/);
  assert.match(sheet, /onClose=\{\(\) => setDetailsSheetOpen\(false\)\}/);
  assert.match(sheet, /detailsDialogRef\.current\?\.close\(\)/);
  assert.match(sheet, /aria-label="Agent details"/);
  assert.match(sheet, /max-h-none/);
  assert.match(sheet, /max-w-none/);
  assert.match(sheet, /border-0/);
  assert.doesNotMatch(sheet, /fixed inset-0 z-50/);
});

test("every message shows its time, and one still in flight says so", () => {
  const bubble = chat.slice(
    chat.indexOf("function MessageBubble("),
    chat.indexOf("const ACTIVITY_ICONS"),
  );
  assert.doesNotMatch(bubble, /group-hover\/msg:opacity-100/);
  assert.doesNotMatch(bubble, /opacity-0/);
  assert.match(bubble, /<time\s+dateTime=\{message\.createdAt\}/);
  assert.match(bubble, /pending \? \(\s*<span>Sending/);
  assert.match(
    chat,
    /pending=\{sending && item\.id\.startsWith\("optimistic-"\)\}/,
  );
});

test("the draft mirror ref is set synchronously, so two fast switches cannot cross", () => {
  const selectAgent = chat.slice(
    chat.indexOf("const selectAgent = useCallback("),
    chat.indexOf("const agentParam = searchParams?."),
  );
  assert.match(selectAgent, /draftRef\.current = restored/);
  const composerChange = chat.slice(
    chat.indexOf("const handleComposerChange ="),
    chat.indexOf("const pickMention"),
  );
  assert.match(composerChange, /draftRef\.current = value/);
});

test("a restored draft does not disable the agent-cycle shortcut", () => {
  const selectAgent = chat.slice(
    chat.indexOf("const selectAgent = useCallback("),
    chat.indexOf("const agentParam = searchParams?."),
  );
  assert.match(selectAgent, /restoredDraftRef\.current = restored/);
  assert.match(
    chat,
    /draftRef\.current\.trim\(\) !== ""\s*&&\s*draftRef\.current !== restoredDraftRef\.current/,
  );
});
