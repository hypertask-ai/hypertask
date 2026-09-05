// HTPR-6099: after a page reload, the agent chat used to require a manual
// scroll to reach the newest message. Root cause: the auto-follow effect
// scrolled with behavior "smooth", then synchronously re-measured scrollTop
// before the animation had moved it, so it could latch showScrollToBottom
// to true and skip the next auto-scroll (e.g. when messages then activity
// load back-to-back right after a reload), leaving the view short of the
// bottom with no correction.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "..", "src/app/agents/chat/AgentChatClient.tsx"),
  "utf8",
);

test("the feed auto-follow effect scrolls instantly, not smoothly", () => {
  const match = source.match(
    /if \(changed && !showScrollToBottom\) scrollMessagesToBottom\("(\w+)"\);/,
  );
  assert.ok(match, "expected to find the auto-follow scroll call");
  assert.equal(
    match[1],
    "auto",
    "auto-follow scroll must be instant so the very next scrollTop read is accurate",
  );
});

test("the manual jump-to-bottom button still scrolls smoothly", () => {
  assert.match(
    source,
    /onClick=\{\(\) => scrollMessagesToBottom\("smooth"\)\}/,
    "user-triggered scroll can keep the smooth animation",
  );
});
