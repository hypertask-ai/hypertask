const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
  cache: false,
});

const { mentionAuthorAgentId, notificationActorName } = jiti(
  path.join(root, "src/utils/controllers/notifications/actorDisplayName.ts"),
);
const { verbByType } = jiti(
  path.join(root, "src/utils/controllers/notifications/digestEvents.ts"),
);

const AGENT = "b02ef86d-dc07-4f30-b2f4-12ded8c31a30";

test("an agent's mention sentence names the agent, not its owner", () => {
  const agentComment = {
    fromAgent: { displayName: "Runner 2" },
    fromUser: { displayName: "Valentin Yeo" },
  };

  assert.equal(
    `${notificationActorName(agentComment)} ${verbByType.Mentioned}`,
    "Runner 2 mentioned you",
  );
});

test("a mention written by a person keeps the person's name", () => {
  const humanComment = {
    fromAgent: null,
    fromUser: { displayName: "Valentin Yeo" },
  };

  assert.equal(
    `${notificationActorName(humanComment)} ${verbByType.Mentioned}`,
    "Valentin Yeo mentioned you",
  );
});

test("a nameless actor falls back instead of printing nothing", () => {
  assert.equal(notificationActorName({}), "Someone");
  assert.equal(
    notificationActorName({ fromAgent: { displayName: "   " }, fromUser: null }),
    "Someone",
  );
  assert.equal(
    notificationActorName({ fromUser: { displayName: "  Valentin Yeo  " } }),
    "Valentin Yeo",
  );
});

test("stored comment authors take precedence over supplied agents", () => {
  assert.equal(mentionAuthorAgentId("another-agent", { agentId: AGENT }), AGENT);
  assert.equal(mentionAuthorAgentId(AGENT, { agentId: null }), null);
  assert.equal(mentionAuthorAgentId(AGENT, null), AGENT);
  assert.equal(mentionAuthorAgentId(undefined, { agentId: AGENT }), AGENT);
  assert.equal(mentionAuthorAgentId(undefined, null), null);
});
