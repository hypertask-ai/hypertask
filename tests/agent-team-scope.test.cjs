const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(
  path.join(root, "tests/agent-team-scope-entry.cjs"),
  {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  },
);

const { canAttachAgentToTeam, getAgentTeamId } = jiti(
  path.join(root, "src/utils/controllers/agents/teamScope.ts"),
);
const { getAllCommands } = jiti(
  path.join(root, "src/components/Modals/commands/HTC/AllCommands.ts"),
);

test("an unassigned agent can join its first team", () => {
  assert.equal(canAttachAgentToTeam([], "team-a"), true);
  assert.equal(canAttachAgentToTeam([null], "team-a"), true);
});

test("an agent can join more boards in the same team", () => {
  assert.equal(canAttachAgentToTeam(["team-a", "team-a"], "team-a"), true);
});

test("an agent cannot cross the team boundary", () => {
  assert.equal(canAttachAgentToTeam(["team-a"], "team-b"), false);
  assert.equal(
    canAttachAgentToTeam(["team-a", "team-b"], "team-a"),
    false,
  );
});

test("legacy cross-team agents resolve to one deterministic team", () => {
  assert.equal(getAgentTeamId([null, "team-a", "team-b"]), "team-a");
  assert.equal(getAgentTeamId([null]), null);
});

test("Ctrl+K exposes every scoped people section", () => {
  const commands = getAllCommands({ context: "Others" }).flatMap(
    (group) => group.commandLists,
  );
  const commandByPayload = new Map(
    commands.map((command) => [command.payload, command]),
  );

  for (const section of ["team-agents", "board-members", "board-agents"]) {
    assert.ok(commandByPayload.has(section), `${section} command is missing`);
  }
});
