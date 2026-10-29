const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

function fixture({ accessible = true, member = true, success = true } = {}) {
  const calls = [];
  const { routeAgentMention } = load("src/lib/ai/chatStream/fleetTurn.ts", {
    "@/lib/ai/chatStream/request": {},
    "@/lib/prisma": { default: {} },
    "@/lib/flags/keys": {},
    "@/lib/flags": { isFeatureEnabled: async () => { throw new Error("Retired flag read"); } },
    "@/app/api/ai/chat/stream/streamLease": {},
    "@/app/api/ai/_lib/heartbeatExecution": {},
    "@/app/api/ai/chat/stream/persistAssistantMessage": {
      persistAssistantMessage: async (input) => { calls.push(["persist", input]); return true; },
    },
    "@/utils/controllers/comments/linkifyTicketRefs": { linkifyTicketRefs: (text) => text },
    "@/utils/controllers/agents/boardMembers": {
      getAccessibleAgentBoard: async (...args) => { calls.push(["access", ...args]); return accessible; },
      getBoardAgentMembers: async () => member ? [{ agent: { id: "agent-1", displayName: "QA Agent" } }] : [],
    },
    "@/app/api/ai/chat/stream/fleetAsk": {
      askFleetAgent: async (input) => { calls.push(["ask", input]); return success ? { success: true, answer: "Answer <safe>" } : { success: false, error: "unavailable" }; },
    },
  });
  const body = { message: "hello", default_context: { project_id: 7049 }, session_id: "session", assistant_message_id: "reply", context_list: [{ type: "agent", id: "agent-1" }] };
  const state = {
    body, dbUser: { id: 985, displayName: "QA" }, providerAbort: new AbortController(),
    send: (...args) => calls.push(["send", ...args]),
    finish: (...args) => calls.push(["finish", ...args]),
    recordTurnOutcome: (...args) => calls.push(["outcome", ...args]),
  };
  return { calls, body, state, routeAgentMention };
}

test("released mention dispatch asks an accessible member without reading a rollout flag", async () => {
  const f = fixture();
  assert.equal(await f.routeAgentMention(f.state, f.body), true);
  assert.deepEqual(f.calls.find(([name]) => name === "access"), ["access", 7049, 985]);
  assert.equal(f.calls.find(([name]) => name === "ask")[1].agentId, "agent-1");
  const saved = f.calls.find(([name]) => name === "persist")[1];
  assert.equal(saved.authorAgentId, "agent-1");
  assert.equal(saved.content, "<p>Answer &lt;safe&gt;</p>");
  assert.deepEqual(f.calls.at(-1), ["finish", "complete", { user_message_persisted: undefined, assistant_persisted: true }]);
});

for (const options of [{ accessible: false }, { member: false }]) {
  test(`mention dispatch refuses inaccessible agents: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    assert.equal(await f.routeAgentMention(f.state, f.body), false);
    assert.equal(f.calls.some(([name]) => name === "ask" || name === "persist"), false);
  });
}

for (const change of [{ context_list: [] }, { context_list: [{ type: "agent", id: "a" }, { type: "agent", id: "b" }] }, { attachments: [{}] }, { default_context: {} }]) {
  test(`ordinary chat falls through without contacting an agent: ${JSON.stringify(change)}`, async () => {
    const f = fixture();
    Object.assign(f.body, change);
    assert.equal(await f.routeAgentMention(f.state, f.body), false);
    assert.deepEqual(f.calls, []);
  });
}

test("an acting agent session is not rerouted", async () => {
  const f = fixture();
  f.state.actingAgent = { id: "native" };
  assert.equal(await f.routeAgentMention(f.state, f.body), false);
  assert.deepEqual(f.calls, []);
});

test("failed agent replies never attribute assistant text to the agent", async () => {
  const f = fixture({ success: false });
  assert.equal(await f.routeAgentMention(f.state, f.body), true);
  assert.equal(f.calls.find(([name]) => name === "persist")[1].authorAgentId, null);
  assert.equal(f.calls.some(([name, event]) => name === "send" && event === "agent"), false);
});
