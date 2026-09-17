const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const load = (relativePath) =>
  createJiti(path.join(root, "tests/agent-rooms-policy-entry.cjs"), {
    alias: { "@": path.join(root, "src") },
    interopDefault: true,
  })(path.join(root, relativePath));

const {
  AGENT_ROOM_BOT_TURN_LIMIT,
  AGENT_ROOM_DAILY_TURN_BUDGET,
  mentionedRoomAgents,
  nextRoomBotDepth,
  roomBudgetWindow,
} = load("src/lib/agents/roomPolicy.ts");

const agents = [
  { id: "product", displayName: "Product Bot" },
  { id: "dev-1", displayName: "Dev 1" },
  { id: "dev-2", displayName: "Dev 2" },
  { id: "qa-1", displayName: "QA 1" },
];

test("room policy addresses board agents by full display name without echoing the author", () => {
  assert.deepEqual(
    mentionedRoomAgents("Dev 2, please check this with QA 1.", agents, "product"),
    ["dev-2", "qa-1"],
  );
  assert.deepEqual(
    mentionedRoomAgents("Product Bot has this", agents, "product"),
    [],
  );
  assert.deepEqual(mentionedRoomAgents("developer 2", agents, null), []);
});

test("room policy caps a bot exchange after three bot turns", () => {
  assert.equal(AGENT_ROOM_BOT_TURN_LIMIT, 3);
  assert.equal(nextRoomBotDepth(0), 1);
  assert.equal(nextRoomBotDepth(2), 3);
  assert.equal(nextRoomBotDepth(3), null);
});

test("room policy exposes a finite daily budget and a UTC budget window", () => {
  assert.ok(AGENT_ROOM_DAILY_TURN_BUDGET > 0);
  const { start, end } = roomBudgetWindow(new Date("2026-09-18T23:59:59.000Z"));
  assert.equal(start.toISOString(), "2026-09-18T00:00:00.000Z");
  assert.equal(end.toISOString(), "2026-09-19T00:00:00.000Z");
});
