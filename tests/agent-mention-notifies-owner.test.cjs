const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/agent-mention-jiti-${++jitiEntryId}.cjs`),
    { interopDefault: true, alias: { "@": path.join(root, "src") } },
  );
  return jiti(path.join(root, relativePath));
}


const { shouldSkipMentionRecipient } = loadTs(
  "src/utils/controllers/comments/mentionRecipients.ts",
);

const OWNER = 6;
const OTHER = 7;
const HYPERAI = 332;
const AGENT = "2a66c548-ef2c-4d06-8728-407c5e8ec938";

test("an agent mentioning its own owner notifies them", () => {
  assert.equal(
    shouldSkipMentionRecipient({
      userId: OWNER,
      mentionedBy: OWNER,
      hyperAiId: HYPERAI,
      fromAgentId: AGENT,
    }),
    false,
  );
});

test("a human still does not notify themselves", () => {
  assert.equal(
    shouldSkipMentionRecipient({
      userId: OWNER,
      mentionedBy: OWNER,
      hyperAiId: HYPERAI,
      fromAgentId: null,
    }),
    true,
  );
  assert.equal(
    shouldSkipMentionRecipient({
      userId: OWNER,
      mentionedBy: OWNER,
      hyperAiId: HYPERAI,
      fromAgentId: undefined,
    }),
    true,
  );
});

test("mentioning someone else always notifies them", () => {
  for (const fromAgentId of [null, AGENT]) {
    assert.equal(
      shouldSkipMentionRecipient({
        userId: OTHER,
        mentionedBy: OWNER,
        hyperAiId: HYPERAI,
        fromAgentId,
      }),
      false,
      `other user must be notified (fromAgentId=${fromAgentId})`,
    );
  }
});

test("HyperAI is never notified, agent or not", () => {
  for (const fromAgentId of [null, AGENT]) {
    assert.equal(
      shouldSkipMentionRecipient({
        userId: HYPERAI,
        mentionedBy: OWNER,
        hyperAiId: HYPERAI,
        fromAgentId,
      }),
      true,
    );
  }
});
