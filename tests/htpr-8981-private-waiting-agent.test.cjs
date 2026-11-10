const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const createJiti = require("jiti");

const root = path.resolve(__dirname, "..");
const privacy = createJiti(__filename, { alias: { "@": path.join(root, "src") } })(
  path.join(root, "src/lib/tasks/waitingAgentPrivacy.ts"),
);
const secret = {
  id: "agent-private", displayName: "Secret helper", photoURL: null, userId: 6, visibility: "PRIVATE", members: [],
};
const team = {
  id: "agent-team", displayName: "Shared helper", photoURL: null, userId: 6, visibility: "TEAM", members: [{ projectId: 15 }],
};
const waiting = (data) => ({ type: "TaskWaitingOn", data });
const redact = (activity, agents, userId) => {
  const hidden = privacy.hiddenWaitingAgents(agents, userId, 15);
  return privacy.redactWaitingOnActivity(activity, hidden.hiddenIds, hidden.hiddenNames, userId);
};

test("a board member who cannot see a private agent gets no name or id", () => {
  const activity = redact(waiting({ waitingOnDisplayName: "Secret helper", waitingOnAgentId: secret.id, fromUserId: 7 }), [secret, team], 9);
  assert.equal(activity.data.waitingOnDisplayName, "Private agent");
  assert.equal(activity.data.waitingOnAgentId, null);
  assert.equal(JSON.stringify(activity).includes("Secret helper"), false);
  const listed = privacy.presentWaitingAgent({ id: 1, projectId: 15, waitingOnAgentId: secret.id }, new Map([[secret.id, secret]]), 9);
  assert.equal(listed.waitingOnAgentId, null);
  assert.equal(listed.waitingOnAgent, null);
});

test("the owner still sees the name, a teammate sees a team agent, and a person stays a person", () => {
  const owned = redact(waiting({ waitingOnDisplayName: "Secret helper", waitingOnAgentId: secret.id }), [secret], 6);
  assert.equal(owned.data.waitingOnDisplayName, "Secret helper");
  assert.equal(owned.data.waitingOnAgentId, secret.id);
  const teammate = redact(waiting({ waitingOnDisplayName: "Shared helper", waitingOnAgentId: team.id }), [team], 9);
  assert.equal(teammate.data.waitingOnDisplayName, "Shared helper");
  const person = redact(waiting({ waitingOnDisplayName: "Jacqueline Bolz" }), [secret], 9);
  assert.equal(person.data.waitingOnDisplayName, "Jacqueline Bolz");
  const listed = privacy.presentWaitingAgent({ id: 1, projectId: 15, waitingOnAgentId: secret.id }, new Map([[secret.id, secret]]), 6);
  assert.equal(listed.waitingOnAgent.displayName, "Secret helper");
});

test("a deleted private agent stays hidden, and a person with the same name does not", () => {
  const stored = waiting({ waitingOnDisplayName: "Secret helper", waitingOnAgentId: secret.id, waitingOnPrivate: true, waitingOnAgentOwnerId: 6 });
  assert.equal(redact(stored, [], 9).data.waitingOnDisplayName, "Private agent");
  assert.equal(redact(stored, [], 6).data.waitingOnDisplayName, "Secret helper");
  assert.equal(redact(waiting({ waitingOnDisplayName: "Secret helper" }), [], 9).data.waitingOnDisplayName, "Secret helper");
});

test("making an agent private or deleting it stamps waits that already name that agent", () => {
  const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
  const visibility = read("src/lib/agents/visibility.ts");
  const owned = read("src/lib/mcp/agents/ownedAgents.ts");
  assert.equal(visibility.includes("waitingOnPrivate"), true);
  assert.equal(visibility.includes("#- '{data,waitingOnPrivate}'"), true);
  assert.equal(visibility.includes('DELETE FROM "Task_Summary"'), true);
  assert.equal(owned.includes('visibility === "PRIVATE"'), true);
  assert.equal(owned.includes('DELETE FROM "Task_Summary"'), true);
  for (const file of [
    "src/utils/controllers/taskDetail/load.ts",
    "src/utils/controllers/tasks/getSharedTask.ts",
    "src/app/api/ai/_lib/currentTaskContext.ts",
    "src/lib/mcp/operations/tasks/operation.ts",
    "src/app/api/ai/_lib/taskSummaries.ts",
  ]) assert.equal(read(file).includes("scrubStoredTaskSummary") || read(file).includes("replaceConcealedNames"), true, file);
});

test("a stored summary hides a private waiting name, and the owner still sees it", () => {
  const comments = [{ activity: waiting({ waitingOnDisplayName: "Secret helper", waitingOnAgentId: secret.id, waitingOnPrivate: true, waitingOnAgentOwnerId: 6 }) }];
  const hidden = privacy.hiddenWaitingAgents([secret], 9, 15);
  const summary = "Waiting on Secret helper for the export.";
  assert.equal(privacy.replaceConcealedNames(summary, privacy.concealedWaitingNames(comments, hidden.hiddenIds, hidden.hiddenNames, 9)), "Waiting on Private agent for the export.");
  assert.equal(privacy.replaceConcealedNames(summary, privacy.concealedWaitingNames(comments, hidden.hiddenIds, hidden.hiddenNames, 6)), summary);
  assert.equal(privacy.replaceConcealedNames(summary, privacy.concealedWaitingNames(comments, new Set(), new Set(), 9)), "Waiting on Private agent for the export.");
  assert.equal(privacy.replaceConcealedNames(summary, privacy.concealedWaitingNames([{ activity: waiting({ waitingOnDisplayName: "Secret helper" }) }], new Set(), new Set(), 9)), summary);
});

test.after(() => {
  console.log("htpr-8981-private-name-hidden");
});
