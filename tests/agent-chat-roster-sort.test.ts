import assert from "node:assert/strict";

async function main() {
  const { bumpRosterChatRecency, sortRosterByActivity } = await import(
    "@/app/agents/chat/rosterSort"
  );

  const chattyButNoBoardPost = {
    id: "ada",
    displayName: "Ada",
    lastPostedAt: null,
    lastChatMessageAt: "2026-09-08T12:00:00.000Z",
  };
  const boardPosterNoChat = {
    id: "bea",
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

  // Send-path bump: after chatting with Bea, she outranks Ada without a reload.
  const afterSend = bumpRosterChatRecency(
    [chattyButNoBoardPost, boardPosterNoChat],
    "bea",
    "2026-09-08T14:00:00.000Z",
  );
  assert.ok(afterSend);
  assert.deepEqual(
    sortRosterByActivity(afterSend, true).map((a) => a.displayName),
    ["Bea", "Ada"],
  );
  assert.equal(
    afterSend.find((a) => a.id === "ada")?.lastChatMessageAt,
    "2026-09-08T12:00:00.000Z",
  );

  console.log("agent-chat-roster-sort.test.ts: all assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
