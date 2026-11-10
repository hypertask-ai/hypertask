const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const createJiti = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
});
const privacy = jiti(path.join(root, "src/lib/tasks/waitingAgentPrivacy.ts"));

const secretId = "agent-private";
const secret = {
  id: secretId,
  displayName: "Secret helper",
  photoURL: null,
  userId: 6,
  visibility: "PRIVATE",
  members: [{ projectId: 15 }],
};
const team = {
  id: "agent-team",
  displayName: "Shared helper",
  photoURL: null,
  userId: 6,
  visibility: "TEAM",
  members: [{ projectId: 15 }],
};

const waiting = (data) => ({ type: "TaskWaitingOn", data });

test("a board member who cannot see a private agent gets no name or id", () => {
  const hidden = privacy.hiddenWaitingAgents([secret, team], 9, 15);
  const activity = privacy.redactWaitingOnActivity(
    waiting({ waitingOnDisplayName: "Secret helper", waitingOnAgentId: secretId, fromUserId: 7 }),
    hidden.hiddenIds,
    hidden.hiddenNames,
  );
  assert.equal(activity.data.waitingOnDisplayName, "Private agent");
  assert.equal(activity.data.waitingOnAgentId, null);
  assert.equal(JSON.stringify(activity).includes("Secret helper"), false);

  const listed = privacy.presentWaitingAgent(
    { id: 1, projectId: 15, waitingOnAgentId: secretId },
    new Map([[secretId, secret]]),
    9,
  );
  assert.equal(listed.waitingOnAgentId, null);
  assert.equal(listed.waitingOnAgent, null);
});

test("the agent owner still sees the private name, and a person wait stays a person", () => {
  const hidden = privacy.hiddenWaitingAgents([secret, team], 6, 15);
  const owned = privacy.redactWaitingOnActivity(
    waiting({ waitingOnDisplayName: "Secret helper", waitingOnAgentId: secretId }),
    hidden.hiddenIds,
    hidden.hiddenNames,
  );
  assert.equal(owned.data.waitingOnDisplayName, "Secret helper");
  assert.equal(owned.data.waitingOnAgentId, secretId);

  const teammate = privacy.redactWaitingOnActivity(
    waiting({ waitingOnDisplayName: "Shared helper", waitingOnAgentId: team.id }),
    privacy.hiddenWaitingAgents([team], 9, 15).hiddenIds,
    privacy.hiddenWaitingAgents([team], 9, 15).hiddenNames,
  );
  assert.equal(teammate.data.waitingOnDisplayName, "Shared helper");

  const person = privacy.redactWaitingOnActivity(
    waiting({ waitingOnDisplayName: "Jacqueline Bolz" }),
    hidden.hiddenIds,
    hidden.hiddenNames,
  );
  assert.equal(person.data.waitingOnDisplayName, "Jacqueline Bolz");
  assert.equal(person.data.waitingOnAgentId, undefined);

  const listed = privacy.presentWaitingAgent(
    { id: 1, projectId: 15, waitingOnAgentId: secretId },
    new Map([[secretId, secret]]),
    6,
  );
  assert.equal(listed.waitingOnAgent.displayName, "Secret helper");
});

test("an old activity row with only the private name is hidden from other members", () => {
  const hidden = privacy.hiddenWaitingAgents([secret], 9, 15);
  const activity = privacy.redactWaitingOnActivity(
    waiting({ waitingOnDisplayName: "Secret helper" }),
    hidden.hiddenIds,
    hidden.hiddenNames,
  );
  assert.equal(activity.data.waitingOnDisplayName, "Private agent");
  assert.equal(activity.data.waitingOnAgentId, null);
});

test("comment reads, board lists, and public shares all use the same hide", () => {
  const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
  const load = read("src/utils/controllers/taskDetail/load.ts");
  assert.equal(load.includes("visibleWaitingOnActivity"), true);
  assert.equal(read("src/utils/controllers/projects/getBoardTasks.ts").includes("currentUserId ?? userId"), true);
  assert.equal(read("src/lib/mcp/operations/comments/operation.ts").includes("withPublicWaitingActivities"), true);
  assert.equal(read("src/lib/ai/tools/getCommentsForTask.ts").includes("withPublicWaitingActivities"), true);
  assert.equal(read("src/utils/controllers/tasks/getSharedTask.ts").includes("visibleWaitingOnActivity"), true);
  assert.equal(read("src/lib/tasks/setWaitingOn.ts").includes("waitingOnAgentId: waitingAgent.id"), true);
  const sql = read("src/lib/tasks/waitingOnActivitySql.ts");
  assert.equal(sql.includes("Private agent") || sql.includes("PRIVATE_AGENT_DISPLAY_NAME"), true);
  assert.equal(sql.includes("waitingOnDisplayName"), true);
});

test.after(() => {
  console.log("htpr-8981-private-name-hidden");
});
