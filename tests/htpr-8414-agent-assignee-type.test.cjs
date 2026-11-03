const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/htpr-8414-agent-assignee-type.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { mapTaskAssignee } = jiti(path.join(root, "src/lib/mcp/tasks/mappers.ts"));

const owner = { id: 6, email: "owner@example.com", displayName: "Board Owner" };
const visibleAgent = {
  id: "1a6dd89d-5fff-4c1b-9610-0a4270a7f2c7",
  userId: 6,
  visibility: "PRIVATE",
  members: [],
  displayName: "Runner 2",
};

test("an agent assignment reads as that agent, not as the owner account", () => {
  const mapped = mapTaskAssignee({ user: owner, agent: visibleAgent }, 6, 15);
  assert.equal(mapped.type, "agent");
  assert.equal(mapped.displayName, "Runner 2");
  assert.equal(mapped.agentId, visibleAgent.id);
  assert.equal(mapped.agent.id, visibleAgent.id);
  assert.equal(mapped.email, "");
  assert.notEqual(mapped.email, owner.email);
});

test("a person assignment keeps its id, email and name", () => {
  const mapped = mapTaskAssignee({ user: owner }, 6, 15);
  assert.equal(mapped.type, "person");
  assert.equal(mapped.id, 6);
  assert.equal(mapped.email, owner.email);
  assert.equal(mapped.displayName, "Board Owner");
  assert.equal(mapped.agentId, undefined);
  assert.equal(mapped.agent, undefined);
});

test("an agent the reader cannot see is still left out", () => {
  const mapped = mapTaskAssignee(
    {
      user: owner,
      agent: { id: "hidden", userId: 999, visibility: "PRIVATE", members: [], displayName: "Ghost" },
    },
    6,
    15
  );
  assert.equal(mapped, undefined);
});
