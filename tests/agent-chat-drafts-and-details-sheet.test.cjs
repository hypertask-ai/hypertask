// HTPR-6005 QA regressions: unsent composer text used to vanish when the user
// switched agents or reloaded, the mobile "Agent details" sheet trapped
// neither focus nor Escape, and a message showed no time until hovered.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const chat = fs.readFileSync(
  path.join(root, "src/app/agents/chat/AgentChatClient.tsx"),
  "utf8",
);

// The helper is plain TypeScript with no imports, so stripping the type
// annotations is enough to exercise the real logic here.
function loadDrafts(store) {
  const src = fs
    .readFileSync(path.join(root, "src/lib/agents/chatDrafts.ts"), "utf8")
    .replace(/^export /gm, "")
    .replace(/: (string|number|void|Storage \| null)\b/g, "")
    .replace(/\bwindow\b/g, "fakeWindow");
  const fakeWindow = store === null ? undefined : { localStorage: store };
  // eslint-disable-next-line no-new-func
  return new Function(
    "fakeWindow",
    `${src}; return { readDraft, writeDraft, clearDraft };`,
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

  // Switching agents must never surface another agent's unsent text...
  assert.equal(readDraft(6, "agent-b"), "");
  // ...and a second account on the same browser must never see it either.
  assert.equal(readDraft(7, "agent-a"), "");
});

test("an emptied composer clears the stored draft instead of leaving a ghost", () => {
  const store = fakeStorage();
  const { readDraft, writeDraft, clearDraft } = loadDrafts(store);

  writeDraft(6, "agent-a", "typed then sent");
  writeDraft(6, "agent-a", "   ");
  assert.equal(readDraft(6, "agent-a"), "");
  assert.equal(store.map.size, 0, "whitespace-only draft must remove the key");

  writeDraft(6, "agent-a", "again");
  clearDraft(6, "agent-a");
  assert.equal(store.map.size, 0);
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
    chat.indexOf("// Honor ?agent=<slug>"),
  );
  // The outgoing id has to be read before selectedIdRef is reassigned, or the
  // draft is filed under the agent being switched to.
  const leavingAt = selectAgent.indexOf("const leaving = selectedIdRef.current");
  const reassignAt = selectAgent.indexOf("selectedIdRef.current = agent.id");
  assert.ok(leavingAt > -1 && reassignAt > leavingAt);
  assert.match(
    selectAgent,
    /writeDraft\(currentUser\.id, leaving, draftRef\.current\)/,
  );
  assert.match(selectAgent, /setDraft\(readDraft\(currentUser\.id, agent\.id\)\)/);
  assert.doesNotMatch(selectAgent, /setDraft\(""\)/);
  // The same callback is the reload path (the ?agent= effect calls it), so it
  // must not be re-created on every keystroke by depending on `draft`.
  assert.match(selectAgent, /\[router, openAgentSession, isMbl, currentUser\.id\]/);
});

test("the mobile details sheet is a native modal dialog, so Escape and focus work", () => {
  const sheet = chat.slice(
    chat.indexOf("const detailsSheetShown ="),
    chat.indexOf("const closeCreateAgent ="),
  );
  assert.match(sheet, /<dialog/);
  assert.match(sheet, /el\.showModal\(\)/);
  // close() is what fires onClose, which restores focus to the trigger and
  // syncs the open state back; unmounting the element instead would skip it.
  assert.match(sheet, /onClose=\{\(\) => setDetailsSheetOpen\(false\)\}/);
  assert.match(sheet, /detailsDialogRef\.current\?\.close\(\)/);
  assert.match(sheet, /aria-label="Agent details"/);
  // The UA stylesheet centres and borders a dialog; without these it renders
  // as a small framed box instead of a full-height right-edge sheet.
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
