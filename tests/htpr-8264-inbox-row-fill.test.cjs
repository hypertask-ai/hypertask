const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const { buildInboxRowFillParts, clipInboxPreview, INBOX_ROW_FILL_FALLBACK_TEXT } = loadModule("src/lib/inbox/inboxRowFill.ts");

const source = (overrides = {}) => ({
  commentText: "",
  commentAuthor: "",
  commentId: null,
  latestCommentText: "",
  latestCommentAuthor: "",
  descriptionText: "",
  title: "Redesign AI chat chips after ticket creation",
  reason: "",
  ...overrides,
});

test("inbox row fill flag is an Everyone improvement", () => {
  const { default: flag, HTPR_8264_INBOX_ROW_FILL_FLAG: key } = loadModule("src/lib/flags/definitions/htpr-8264-inbox-row-fill.ts");
  assert.equal(key, "htpr-8264-inbox-row-fill");
  assert.equal(flag.key, key);
  assert.equal(flag.kind, "improvement");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
  assert.equal(flag.releaseRisk.highRisk, undefined);
});

test("the row drops the fixed sender and title columns only when the flag is on", () => {
  const row = read("src/components/notifications/NotificationRow.tsx");
  assert.match(row, /const rowFill = useFlag\(HTPR_8264_INBOX_ROW_FILL_FLAG\)/);
  assert.match(row, /rowFill \? 'md:shrink-0 md:min-w-0 md:max-w-\[180px\]' : 'md:w-\[15%\] md:min-w-\[15%\] md:max-w-\[15%\] md:shrink-0'/);
  assert.match(row, /rowFill \? "md:flex-1" : "md:w-\[40%\]"/);
  assert.match(row, /rowFill \? "md:space-x-4" : "md:space-x-8"/);
  assert.match(row, /const flipMentionHierarchy = !rowFill && notification.type === "Mentioned"/);
  assert.match(row, /rowFill\s*\?\s*"flex-1 min-w-0 truncate flex-column"/);
});

test("a reminder row fills with its reason, the latest human comment and the description", () => {
  const parts = buildInboxRowFillParts(source({
    reason: "Task Reminder",
    latestCommentText: "chips should match the Kanban tags, square, no colour fill",
    latestCommentAuthor: "Valentin Yeo",
    descriptionText: "After a ticket is created the chips change.",
  }));
  assert.deepEqual(parts.map((part) => part.kind), ["reason", "comment", "description"]);
  assert.equal(parts[0].text, "Task Reminder");
  assert.equal(parts[1].author, "Valentin Yeo");
});

test("a mention row leads with its author and never shows the same comment twice", () => {
  const parts = buildInboxRowFillParts(source({
    commentId: 44,
    commentText: "cc @Valentin Yeo can you sign off",
    commentAuthor: "Mohsin",
    reason: "Mentioned in",
    latestCommentText: "cc @Valentin Yeo can you sign off",
    latestCommentAuthor: "Mohsin",
  }));
  assert.deepEqual(parts.map((part) => part.kind), ["comment"]);
  assert.equal(parts[0].author, "Mohsin");
});

test("a row with a reason but no text says so instead of leaving a gap", () => {
  const parts = buildInboxRowFillParts(source({ reason: "Task Reminder" }));
  assert.deepEqual(parts.map((part) => part.kind), ["reason", "empty"]);
  assert.equal(parts[1].text, INBOX_ROW_FILL_FALLBACK_TEXT);
});

test("a row with no text at all shows nothing", () => {
  assert.deepEqual(buildInboxRowFillParts(source()), []);
});

test("a description that repeats the title is left out", () => {
  const parts = buildInboxRowFillParts(source({ descriptionText: "Redesign AI chat chips after ticket creation", reason: "Task Reminder" }));
  assert.deepEqual(parts.map((part) => part.kind), ["reason"]);
});

test("long text is cut at a whole word, then three dots", () => {
  const long = "word ".repeat(120).trim();
  const clipped = clipInboxPreview(long);
  assert.ok(clipped.endsWith("..."));
  assert.ok(clipped.length < long.length);
  assert.ok(clipped.startsWith("word word"));
  assert.doesNotMatch(clipped, /wor\.\.\.$/);
  assert.equal(clipInboxPreview("  short   text  "), "short text");
});

test("the preview keeps one line and the tags and date stay outside it", () => {
  const row = read("src/components/notifications/NotificationRow.tsx");
  assert.match(row, /className="truncate line-clamp-1 xs:max-w-\[92vw\] md:max-w-full xs:whitespace-pre-wrap md:whitespace-nowrap"/);
  assert.match(row, /md:min-w-\[62px\] md:shrink-0/);
});

test("the inbox list sends the latest human comment and description for the row, behind the flag", () => {
  const controller = read("src/utils/controllers/notifications/getAll.ts");
  assert.match(controller, /if \(withCachedDescription && await isFeatureEnabled\(HTPR_8264_INBOX_ROW_FILL_FLAG, userId\)\)/);
  assert.match(controller, /return withLatestHumanComments\(rows, client\)/);
  assert.match(controller, /select: \{ taskId: true, text: true, creator: \{ select: \{ displayName: true \} \} \}/);
  assert.match(controller, /\.\.\.\(includeCachedDescription \? \{ description_: \{ select: \{ content: true \} \} \} : \{\}\)/);
});
