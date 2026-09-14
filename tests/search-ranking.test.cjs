const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const {
  isStrongLexicalHit,
  parseTicketSearchQuery,
  rankAndGroupHits,
  resolveContextProjectId,
  shouldKeepRankedHit,
  tokenize,
} = jiti(path.join(root, "src/utils/controllers/search/rankHits.ts"));

const inboxIcon = {
  ticketNumber: "HTPR-6365",
  title:
    "Mobile task view shows the blue inbox icon on tasks that are not in the inbox",
  descriptionText: "",
  projectId: 15,
  uniqueIndex: 6365,
};

const unrelatedBilling = {
  ticketNumber: "HTPR-100",
  title: "Update billing embargo dates",
  descriptionText: "The search for invoices is elsewhere",
  projectId: 15,
  uniqueIndex: 100,
};

const inneInbox = {
  ticketNumber: "INNE-1367",
  title: "Inbox icon colour on the mobile task view",
  descriptionText: "",
  projectId: 339,
  uniqueIndex: 1367,
};

test("search bar against unrelated titles returns no strong hits", () => {
  const ranked = rankAndGroupHits(
    [unrelatedBilling, { ...inboxIcon, title: "Fix the calendar header" }],
    "search bar",
    15
  );
  assert.deepEqual(ranked, []);
});

test("inbox icon ranks the matching ticket first", () => {
  const ranked = rankAndGroupHits(
    [unrelatedBilling, inboxIcon, inneInbox],
    "inbox icon",
    null
  );
  assert.equal(ranked[0].ticketNumber, "HTPR-6365");
  assert.equal(ranked.length, 2);
});

test("a ticket-number query pins that ticket first even on another board", () => {
  const mentionOnInne = {
    ticketNumber: "INNE-9",
    title: "Follow up on HTPR-6365",
    descriptionText: "",
    projectId: 339,
    uniqueIndex: 9,
  };
  const ranked = rankAndGroupHits(
    [mentionOnInne, inboxIcon, unrelatedBilling],
    "HTPR-6365",
    339
  );
  assert.equal(ranked[0].ticketNumber, "HTPR-6365");
  assert.equal(ranked[0].searchGroup, "other");
  assert.equal(ranked[1].ticketNumber, "INNE-9");
  assert.equal(ranked[1].searchGroup, "current-board");
});

test("bare ticket numbers use the same parser as retrieval", () => {
  assert.deepEqual(parseTicketSearchQuery("6365"), {
    prefix: null,
    uniqueIndex: 6365,
    normalizedQuery: "6365",
  });
  const ranked = rankAndGroupHits([inboxIcon, unrelatedBilling], "6365", null);
  assert.equal(ranked[0].ticketNumber, "HTPR-6365");
});

test("from the inne board, inne matches come first and board 15 is the second group", () => {
  const ranked = rankAndGroupHits(
    [inboxIcon, inneInbox],
    "inbox icon",
    339
  );
  assert.equal(ranked[0].ticketNumber, "INNE-1367");
  assert.equal(ranked[0].searchGroup, "current-board");
  assert.equal(ranked[1].ticketNumber, "HTPR-6365");
  assert.equal(ranked[1].searchGroup, "other");
});

test("bar does not match embargo and missing text fields do not throw", () => {
  assert.equal(
    isStrongLexicalHit(
      { ticketNumber: "HTPR-1", title: "Update billing embargo dates", projectId: 15 },
      "search bar"
    ),
    false
  );
  assert.equal(
    isStrongLexicalHit({ ticketNumber: "", projectId: 15 }, "inbox icon"),
    false
  );
  assert.deepEqual(tokenize("Inbox icon!"), ["inbox", "icon"]);
});

test("words split across title and comment still count as a strong hit", () => {
  assert.equal(
    isStrongLexicalHit(
      {
        ticketNumber: "HTPR-2",
        title: "Fix the inbox row",
        commentText: "The icon stays blue",
        projectId: 15,
      },
      "inbox icon"
    ),
    true
  );
});

test("non-ASCII words tokenize as whole words, not substrings", () => {
  assert.ok(tokenize("收件箱 图标").includes("收件"));
  assert.equal(
    isStrongLexicalHit(
      { ticketNumber: "HTPR-3", title: "收件箱图标颜色", projectId: 15 },
      "收件箱 图标"
    ),
    true
  );
  assert.equal(
    isStrongLexicalHit(
      { ticketNumber: "HTPR-4", title: "caféteria hours", projectId: 15 },
      "café"
    ),
    false
  );
});

test("an archived title match beats an open comment-only mention", () => {
  const thisTicket = {
    ticketNumber: "HTPR-6372",
    title: "Search ranking returns unrelated tickets for plain queries",
    commentText:
      "inbox icon returns HTPR-6365 first; GET /search?searchTerm=inbox+icon",
    projectId: 15,
    uniqueIndex: 6372,
    status: "Normal",
  };
  const ranked = rankAndGroupHits(
    [thisTicket, { ...inboxIcon, status: "Archive" }],
    "inbox icon",
    15
  );
  assert.equal(ranked[0].ticketNumber, "HTPR-6365");
  assert.equal(ranked[1].ticketNumber, "HTPR-6372");
});

test("a ticket-number query pins an archived ticket ahead of an open mention", () => {
  const mention = {
    ticketNumber: "HTPR-6372",
    title: "Search ranking returns unrelated tickets",
    descriptionText: "Acceptance: HTPR-6365 first",
    projectId: 15,
    uniqueIndex: 6372,
    status: "Normal",
  };
  const ranked = rankAndGroupHits(
    [mention, { ...inboxIcon, status: "Archive" }],
    "HTPR-6365",
    15
  );
  assert.equal(ranked[0].ticketNumber, "HTPR-6365");
  assert.equal(ranked[1].ticketNumber, "HTPR-6372");
});

test("default open search keeps archived exact and title hits, not comment-only", () => {
  const archivedTitle = { ...inboxIcon, status: "Archive" };
  const archivedComment = {
    ticketNumber: "HTPR-9",
    title: "Unrelated billing",
    commentText: "mentions the inbox icon in passing",
    projectId: 15,
    uniqueIndex: 9,
    status: "Archive",
  };
  assert.equal(shouldKeepRankedHit(archivedTitle, "inbox icon", "Normal"), true);
  assert.equal(shouldKeepRankedHit(archivedComment, "inbox icon", "Normal"), false);
  assert.equal(shouldKeepRankedHit(archivedTitle, "HTPR-6365", "Normal"), true);
  assert.equal(
    shouldKeepRankedHit(
      { ...inboxIcon, status: "Normal" },
      "inbox icon",
      "Archive"
    ),
    false
  );
});

test("open tickets stay ahead of archived tickets inside a board group", () => {
  const ranked = rankAndGroupHits(
    [
      { ...inneInbox, ticketNumber: "INNE-1", uniqueIndex: 1, status: "Archive" },
      { ...inneInbox, status: "Normal" },
    ],
    "inbox icon",
    339
  );
  assert.equal(ranked[0].ticketNumber, "INNE-1367");
  assert.equal(ranked[0].status, "Normal");
  assert.equal(ranked[1].ticketNumber, "INNE-1");
  assert.equal(ranked[1].status, "Archive");
});

test("a context board outside the searched set is ignored", () => {
  assert.equal(resolveContextProjectId(339, [15]), null);
  assert.equal(resolveContextProjectId(15, [15, 339]), 15);
  assert.equal(resolveContextProjectId("15", [15]), null);
});

test("a missing unique index is not an exact match for query 0", () => {
  const ranked = rankAndGroupHits(
    [{ ticketNumber: "HTPR-1", title: "Unrelated", projectId: 15, uniqueIndex: null }],
    "0",
    null
  );
  assert.deepEqual(ranked, []);
});

console.log("search ranking checks passed");
