import assert from "node:assert/strict";

async function main() {
  const { sortRosterByActivity } = await import(
    "@/app/agents/chat/rosterSort"
  );

  const chattyButNoBoardPost = {
    displayName: "Ada",
    lastPostedAt: null,
    lastChatMessageAt: "2026-09-08T12:00:00.000Z",
  };
  const boardPosterNoChat = {
    displayName: "Bea",
    lastPostedAt: "2026-09-08T13:00:00.000Z",
    lastChatMessageAt: null,
  };

  // Flag off: unchanged pre-HTPR-6283 behavior, ranked by board post only.
  const flagOff = sortRosterByActivity(
    [chattyButNoBoardPost, boardPosterNoChat],
    false,
  );
  assert.deepEqual(
    flagOff.map((a) => a.displayName),
    ["Bea", "Ada"],
  );

  // Flag on: a real chat message outranks a board post, even an older one
  // vs. a more recent board comment (the bug HTPR-6283 fixes).
  const flagOn = sortRosterByActivity(
    [chattyButNoBoardPost, boardPosterNoChat],
    true,
  );
  assert.deepEqual(
    flagOn.map((a) => a.displayName),
    ["Ada", "Bea"],
  );

  // Tiebreak by name when both are equal (including both null).
  const tied = sortRosterByActivity(
    [
      { displayName: "Zed", lastChatMessageAt: null, lastPostedAt: null },
      { displayName: "Amy", lastChatMessageAt: null, lastPostedAt: null },
    ],
    true,
  );
  assert.deepEqual(
    tied.map((a) => a.displayName),
    ["Amy", "Zed"],
  );

  console.log("agent-chat-roster-sort.test.ts: all assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
