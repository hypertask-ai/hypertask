const assert = require("node:assert/strict");
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

test.after(() => {
  console.log("htpr-8981-private-name-hidden");
});
