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

  const sorted = sortRosterByActivity(
    [chattyButNoBoardPost, boardPosterNoChat],
  );
  assert.deepEqual(
    sorted.map((a) => a.displayName),
    ["Ada", "Bea"],
  );

  const tied = sortRosterByActivity(
    [
      { displayName: "Zed", lastChatMessageAt: null, lastPostedAt: null },
      { displayName: "Amy", lastChatMessageAt: null, lastPostedAt: null },
    ],
  );
  assert.deepEqual(
    tied.map((a) => a.displayName),
    ["Amy", "Zed"],
  );

  const afterSend = bumpRosterChatRecency(
    [chattyButNoBoardPost, boardPosterNoChat],
    "bea",
    "2026-09-08T14:00:00.000Z",
  );
  assert.ok(afterSend);
  assert.deepEqual(
    sortRosterByActivity(afterSend).map((a) => a.displayName),
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
