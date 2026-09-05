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

const { shouldAutoScrollToBottom } = createJiti(__filename, {
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

const source = fs.readFileSync(
  path.join(__dirname, "..", "src/app/agents/chat/AgentChatClient.tsx"),
  "utf8",
);

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
