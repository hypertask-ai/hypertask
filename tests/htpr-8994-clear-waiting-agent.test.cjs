const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const { applyWaitingOnWrite } = load("src/lib/waitingOn.ts", {});

const agent = { id: "agent-1", displayName: "HT Product Lead", photoURL: null };

test("a clear that nulls the agent id drops the leftover agent name", () => {
  const task = {
    id: 1,
    waitingOnUserId: null,
    waitingOnAgentId: agent.id,
    waitingOnAgent: agent,
    waitingOnSetById: 6,
    waitingOnSetAt: "2026-11-10T12:00:00.000Z",
  };
  const cleared = applyWaitingOnWrite(task, {
    waitingOnUserId: null,
    waitingOnSetById: null,
    waitingOnSetAt: null,
    waitingOnAgentId: null,
  });
  assert.equal(cleared.waitingOnAgent, null);
  assert.equal(cleared.waitingOnAgentId, null);
  assert.equal(cleared.waitingOnUserId, null);
  assert.equal(task.waitingOnAgent, agent);
});

test("a plain spread of that same clear leaves the agent name", () => {
  const task = { waitingOnAgentId: agent.id, waitingOnAgent: agent };
  const fields = { waitingOnUserId: null, waitingOnAgentId: null, waitingOnSetAt: null };
  const spread = { ...task, ...fields };
  assert.equal(spread.waitingOnAgent, agent);
  assert.equal(applyWaitingOnWrite(task, fields).waitingOnAgent, null);
});

test("a write that omits the agent id keeps the current agent", () => {
  const task = { waitingOnAgentId: agent.id, waitingOnAgent: agent, waitingOnUserId: 6 };
  const next = applyWaitingOnWrite(task, { waitingOnUserId: 7, waitingOnSetById: 8, waitingOnSetAt: "2026-11-10T12:00:00.000Z" });
  assert.equal(next.waitingOnAgent, agent);
  assert.equal(next.waitingOnUserId, 7);
});

test("setting another agent id does not blank a supplied agent", () => {
  const nextAgent = { id: "agent-2", displayName: "Runner 6", photoURL: null };
  const task = { waitingOnAgentId: agent.id, waitingOnAgent: agent };
  const next = applyWaitingOnWrite(task, { waitingOnAgentId: nextAgent.id, waitingOnAgent: nextAgent, waitingOnUserId: null });
  assert.equal(next.waitingOnAgent, nextAgent);
  console.log("waiting-agent-clear ok");
});
