const { readAgentChatSource } = require("./helpers/agent-chat-source.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const { shouldAutoScrollToBottom, agentChatExtraRowsRevision } = createJiti(__filename, {
  interopDefault: true,
})(path.join(__dirname, "..", "src/lib/agents/chatActivityFeed.ts"));

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

const source = readAgentChatSource();

test("the auto-follow effect also watches the queued/typing revision", () => {
  const start = source.indexOf("shouldAutoScrollToBottom({");
  const end = source.indexOf("handleMessageListScroll();", start);
  assert.ok(start !== -1 && end !== -1, "expected to find the auto-follow effect");
  const effectDeclaration = source.slice(start, source.indexOf("}, [", end) + 200);
  assert.match(
    effectDeclaration,
    /\[visibleFeedRevision, activeFeedFilter, extraRowsRevision, embedded\?\.active\]/,
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
