const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const createJiti = require("jiti");
const root = path.resolve(__dirname, "..");
const privacy = createJiti(__filename, { alias: { "@": path.join(root, "src") } })(path.join(root, "src/lib/tasks/waitingAgentPrivacy.ts"));
const secret = { id: "agent-private", displayName: "Secret helper", photoURL: null, userId: 6, visibility: "PRIVATE", members: [] };
const team = { id: "agent-team", displayName: "Shared helper", photoURL: null, userId: 6, visibility: "TEAM", members: [{ projectId: 15 }] };
const waiting = (data) => ({ type: "TaskWaitingOn", data });
const redact = (activity, agents, userId) => {
  const hidden = privacy.hiddenWaitingAgents(agents, userId, 15);
  return privacy.redactWaitingOnActivity(activity, hidden.hiddenIds, hidden.hiddenNames, userId);
};
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("private waiting names stay hidden from people who cannot see the agent", () => {
  const hidden = redact(waiting({ waitingOnDisplayName: "Secret helper", waitingOnAgentId: secret.id, fromUserId: 7 }), [secret, team], 9);
  assert.equal(hidden.data.waitingOnDisplayName, "Private agent");
  assert.equal(hidden.data.waitingOnAgentId, null);
  assert.equal(JSON.stringify(hidden).includes("Secret helper"), false);
  const listed = privacy.presentWaitingAgent({ id: 1, projectId: 15, waitingOnAgentId: secret.id }, new Map([[secret.id, secret]]), 9);
  assert.equal(listed.waitingOnAgentId, null);
  assert.equal(listed.waitingOnAgent, null);
  const owned = redact(waiting({ waitingOnDisplayName: "Secret helper", waitingOnAgentId: secret.id }), [secret], 6);
  assert.equal(owned.data.waitingOnDisplayName, "Secret helper");
  assert.equal(owned.data.waitingOnAgentId, secret.id);
  assert.equal(redact(waiting({ waitingOnDisplayName: "Shared helper", waitingOnAgentId: team.id }), [team], 9).data.waitingOnDisplayName, "Shared helper");
  assert.equal(redact(waiting({ waitingOnDisplayName: "Jacqueline Bolz" }), [secret], 9).data.waitingOnDisplayName, "Jacqueline Bolz");
  assert.equal(privacy.presentWaitingAgent({ id: 1, projectId: 15, waitingOnAgentId: secret.id }, new Map([[secret.id, secret]]), 6).waitingOnAgent.displayName, "Secret helper");
  const stored = waiting({ waitingOnDisplayName: "Secret helper", waitingOnAgentId: secret.id, waitingOnPrivate: true, waitingOnAgentOwnerId: 6 });
  assert.equal(redact(stored, [], 9).data.waitingOnDisplayName, "Private agent");
  assert.equal(redact(stored, [], 6).data.waitingOnDisplayName, "Secret helper");
  assert.equal(redact(waiting({ waitingOnDisplayName: "Secret helper" }), [], 9).data.waitingOnDisplayName, "Secret helper");
  assert.match(read("src/lib/agents/visibility.ts"), /waitingOnPrivate[\s\S]*DELETE FROM "Task_Summary"[\s\S]*#- '\{data,waitingOnPrivate\}'/);
  assert.match(read("src/lib/mcp/agents/ownedAgents.ts"), /visibility === "PRIVATE"[\s\S]*DELETE FROM "Task_Summary"/);
  for (const file of ["src/utils/controllers/taskDetail/load.ts", "src/utils/controllers/tasks/getSharedTask.ts", "src/app/api/ai/_lib/currentTaskContext.ts", "src/lib/mcp/operations/tasks/operation.ts", "src/app/api/ai/_lib/taskSummaries.ts"]) {
    assert.match(read(file), /scrubStoredTaskSummary|replaceConcealedNames/, file);
  }
  const comments = [{ activity: stored }];
  const summary = "Waiting on Secret helper for the export.";
  const swap = (ids, names, userId, rows = comments) => privacy.replaceConcealedNames(summary, privacy.concealedWaitingNames(rows, ids, names, userId));
  const member = privacy.hiddenWaitingAgents([secret], 9, 15);
  assert.equal(swap(member.hiddenIds, member.hiddenNames, 9), "Waiting on Private agent for the export.");
  assert.equal(swap(member.hiddenIds, member.hiddenNames, 6), summary);
  assert.equal(swap(new Set(), new Set(), 9), "Waiting on Private agent for the export.");
  assert.equal(swap(new Set(), new Set(), 9, [{ activity: waiting({ waitingOnDisplayName: "Secret helper" }) }]), summary);
});

test.after(() => { console.log("htpr-8981-private-name-hidden"); });
