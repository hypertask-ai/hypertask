// HTPR-6099: after a page reload, the agent chat kept requiring a manual
// scroll to reach the newest message. Root cause: the auto-follow effect
// gated every scroll behind "the user hasn't scrolled away" -- but on a
// session's very first content paint (right after a reload) that scroll
// state can be mis-measured before the container has real content, latching
// it stuck "scrolled away" forever, since nothing else can ever clear it
// without a manual scroll from the user.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const { shouldAutoScrollToBottom, agentChatExtraRowsRevision } = createJiti(
  __filename,
  { interopDefault: true },
)(path.join(__dirname, "..", "src/lib/agents/chatActivityFeed.ts"));

test("a session's first content always scrolls to bottom, even if scroll state was mismeasured as scrolled-away", () => {
  assert.equal(
    shouldAutoScrollToBottom({
      feedChanged: true,
      isFirstContent: true,
      userScrolledAway: true,
    }),
    true,
  );
});

test("later updates respect a genuine user scroll-up and do not yank the view down", () => {
  assert.equal(
    shouldAutoScrollToBottom({
      feedChanged: true,
      isFirstContent: false,
      userScrolledAway: true,
    }),
    false,
  );
});

test("later updates still auto-follow when the user is at the bottom", () => {
  assert.equal(
    shouldAutoScrollToBottom({
      feedChanged: true,
      isFirstContent: false,
      userScrolledAway: false,
    }),
    true,
  );
});

test("an unchanged feed never triggers a scroll", () => {
  assert.equal(
    shouldAutoScrollToBottom({
      feedChanged: false,
      isFirstContent: true,
      userScrolledAway: false,
    }),
    false,
  );
});

// HTPR-6291: the queued-follow-up strip and the "is working" typing row
// render inside the same scroll container as the feed but aren't part of it
// (mergeAgentChatFeed only knows about real messages and activity events),
// so a queued send or the typing row appearing grew the container with no
// scroll to follow it. agentChatExtraRowsRevision feeds that content into
// the same feedChanged check shouldAutoScrollToBottom already gates on.
test("a new queued message changes the revision", () => {
  assert.notEqual(
    agentChatExtraRowsRevision({
      queuedMessageIds: [],
      queuedRowsVisible: true,
      typingRowVisible: false,
    }),
    agentChatExtraRowsRevision({
      queuedMessageIds: ["queued-1"],
      queuedRowsVisible: true,
      typingRowVisible: false,
    }),
  );
});

test("the typing row appearing changes the revision", () => {
  assert.notEqual(
    agentChatExtraRowsRevision({
      queuedMessageIds: [],
      queuedRowsVisible: true,
      typingRowVisible: false,
    }),
    agentChatExtraRowsRevision({
      queuedMessageIds: [],
      queuedRowsVisible: true,
      typingRowVisible: true,
    }),
  );
});

test("queued ids are ignored while the queued strip isn't rendered", () => {
  assert.equal(
    agentChatExtraRowsRevision({
      queuedMessageIds: [],
      queuedRowsVisible: false,
      typingRowVisible: false,
    }),
    agentChatExtraRowsRevision({
      queuedMessageIds: ["queued-1"],
      queuedRowsVisible: false,
      typingRowVisible: false,
    }),
  );
});

const source = fs.readFileSync(
  path.join(__dirname, "..", "src/app/agents/chat/AgentChatClient.tsx"),
  "utf8",
);

test("the auto-follow effect also watches the queued/typing revision", () => {
  const start = source.indexOf("shouldAutoScrollToBottom({");
  const end = source.indexOf("handleMessageListScroll();", start);
  assert.ok(start !== -1 && end !== -1, "expected to find the auto-follow effect");
  const effectDeclaration = source.slice(start, source.indexOf("}, [", end) + 200);
  assert.match(
    effectDeclaration,
    /\[visibleFeedRevision, activeFeedFilter, extraRowsRevision\]/,
    "the effect must re-run when the queued/typing revision changes, or a " +
      "queued send / typing row never triggers the auto-scroll",
  );
});

test("the auto-follow effect scrolls instantly, not smoothly", () => {
  const start = source.indexOf("shouldAutoScrollToBottom({");
  const end = source.indexOf("handleMessageListScroll();", start);
  assert.ok(start !== -1 && end !== -1, "expected to find the auto-follow effect");
  const effectBody = source.slice(start, end);
  assert.match(effectBody, /scrollMessagesToBottom\("auto"\)/);
  assert.doesNotMatch(
    effectBody,
    /scrollMessagesToBottom\("smooth"\)/,
    "the auto-follow branch must not use the animated scroll: it would leave " +
      "the next scrollTop read stale (see shouldAutoScrollToBottom's doc comment)",
  );
});

test("the manual jump-to-bottom button still scrolls smoothly", () => {
  assert.match(
    source,
    /onClick=\{\(\) => scrollMessagesToBottom\("smooth"\)\}/,
    "user-triggered scroll can keep the smooth animation",
  );
});
