// HTPR-6284. An @agent mention in the AI chat sidebar routes the whole turn to
// that fleet agent. These tests pin the three pieces that make that safe: only
// a clean single mention routes, the fleet bridge contract is validated before
// its answer reaches the chat, and assistant persistence cannot misattribute a
// reply to an agent that did not write it.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
  cache: false,
});

const { extractMentionedAgentIds, decideAgentMentionRouting } = jiti(
  path.join(root, "src/app/api/ai/chat/stream/agentMention.ts"),
);
const { askFleetAgent, FLEET_ASK_MAX_ANSWER_LENGTH } = jiti(
  path.join(root, "src/app/api/ai/chat/stream/fleetAsk.ts"),
);
const { persistAssistantMessage } = jiti(
  path.join(root, "src/app/api/ai/chat/stream/persistAssistantMessage.ts"),
);

test("extractMentionedAgentIds keeps first-mention order and dedupes", () => {
  const contextList = [
    { type: "task", id: 12 },
    { type: "agent", id: " agent-b " },
    { type: "name", id: 6 },
    { type: "agent", id: "agent-a" },
    { type: "agent", id: "agent-b" },
    { type: "agent", id: "" },
    { type: "agent" },
    { type: "agent", id: 42 },
    "not-an-object",
  ];
  assert.deepEqual(extractMentionedAgentIds(contextList), [
    "agent-b",
    "agent-a",
  ]);
  assert.deepEqual(extractMentionedAgentIds(null), []);
  assert.deepEqual(extractMentionedAgentIds("nope"), []);
});

test("decideAgentMentionRouting routes only a clean single mention", () => {
  const base = {
    routingEnabled: true,
    mentionedAgentIds: ["agent-1"],
    hasAttachments: false,
    hasBoardContext: true,
    hasActingAgent: false,
  };
  assert.deepEqual(decideAgentMentionRouting(base), {
    route: true,
    agentId: "agent-1",
  });

  const cases = [
    [{ ...base, routingEnabled: false }, "flag-off"],
    [{ ...base, mentionedAgentIds: [] }, "no-mention"],
    [{ ...base, mentionedAgentIds: ["a", "b"] }, "multiple-mentions"],
    [{ ...base, hasAttachments: true }, "attachments"],
    [{ ...base, hasBoardContext: false }, "no-board-context"],
    [{ ...base, hasActingAgent: true }, "native-agent-session"],
  ];
  for (const [input, reason] of cases) {
    const decision = decideAgentMentionRouting(input);
    assert.equal(decision.route, false, reason);
    assert.equal(decision.reason, reason);
  }
});

test("askFleetAgent validates the bridge response", async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  try {
    delete process.env.AGENT_FLEET_ASK_URL;
    const unconfigured = await askFleetAgent({
      agentId: "agent-1",
      question: "hi",
      context: { boardId: 15 },
    });
    assert.deepEqual(unconfigured, {
      success: false,
      error: "Agent bridge is not configured.",
    });

    process.env.AGENT_FLEET_ASK_URL = "http://bridge.internal/ask";
    process.env.AGENT_FLEET_ASK_SECRET = "s3cret";

    global.fetch = async (url, options) => {
      global.lastFleetAsk = { url, options };
      return { ok: true, json: async () => ({ success: true, answer: " 42 " }) };
    };
    const success = await askFleetAgent({
      agentId: "agent-1",
      question: "q",
      context: { boardId: 15, taskId: 3, requesterName: "Valentin" },
    });
    assert.deepEqual(success, { success: true, answer: "42" });
    const sent = JSON.parse(global.lastFleetAsk.options.body);
    assert.deepEqual(sent, {
      agentId: "agent-1",
      question: "q",
      context: { boardId: 15, taskId: 3, requesterName: "Valentin" },
    });
    assert.equal(
      global.lastFleetAsk.options.headers["x-fleet-ask-secret"],
      "s3cret",
    );

    global.fetch = async () => ({ ok: false, json: async () => ({}) });
    assert.equal(
      (await askFleetAgent({ agentId: "a", question: "q", context: { boardId: 1 } }))
        .error,
      "The agent request failed.",
    );

    global.fetch = async () => ({
      ok: true,
      json: async () => ({ success: true, answer: "   " }),
    });
    assert.equal(
      (await askFleetAgent({ agentId: "a", question: "q", context: { boardId: 1 } }))
        .error,
      "The agent returned a malformed response.",
    );

    global.fetch = async () => ({
      ok: true,
      json: async () => ({ success: false }),
    });
    assert.equal(
      (await askFleetAgent({ agentId: "a", question: "q", context: { boardId: 1 } }))
        .error,
      "The agent returned a malformed response.",
    );

    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        success: true,
        answer: "x".repeat(FLEET_ASK_MAX_ANSWER_LENGTH + 1),
      }),
    });
    assert.equal(
      (await askFleetAgent({ agentId: "a", question: "q", context: { boardId: 1 } }))
        .error,
      "The agent returned a response that was too large to deliver.",
    );

    global.fetch = async () => {
      throw Object.assign(new Error("boom"), { name: "AbortError" });
    };
    assert.equal(
      (await askFleetAgent({ agentId: "a", question: "q", context: { boardId: 1 } }))
        .error,
      "The agent did not respond in time.",
    );
  } finally {
    process.env = originalEnv;
    global.fetch = originalFetch;
    delete global.lastFleetAsk;
  }
});

test("persistAssistantMessage attribution is tri-state", async () => {
  const linkify = async (content) => content;

  function buildDb({ sessionAgentId }) {
    const created = [];
    return {
      created,
      chatSession: {
        findFirst: async () => ({ id: "session-1", agentId: sessionAgentId }),
        update: async () => {},
      },
      chatMessage: {
        createMany: async ({ data }) => {
          created.push(...data);
          return { count: 1 };
        },
        findFirst: async () => null,
      },
    };
  }

  // Plain AI chat, no override: stays unattributed.
  const plainDb = buildDb({ sessionAgentId: null });
  await persistAssistantMessage({
    db: plainDb,
    messageId: "m1",
    sessionId: "session-1",
    userId: 6,
    content: "hello",
    linkify,
  });
  assert.equal(plainDb.created[0].authorAgentId, null);

  // Native agent session, no override: session agent attribution (unchanged).
  const nativeDb = buildDb({ sessionAgentId: "native-agent" });
  await persistAssistantMessage({
    db: nativeDb,
    messageId: "m2",
    sessionId: "session-1",
    userId: 6,
    content: "hello",
    linkify,
  });
  assert.equal(nativeDb.created[0].authorAgentId, "native-agent");

  // Routed @mention turn: explicit agent id wins, even in a plain session.
  const routedDb = buildDb({ sessionAgentId: null });
  await persistAssistantMessage({
    db: routedDb,
    messageId: "m3",
    sessionId: "session-1",
    userId: 6,
    content: "hello",
    linkify,
    authorAgentId: "fleet-agent",
  });
  assert.equal(routedDb.created[0].authorAgentId, "fleet-agent");

  // Failure sentence in a native agent session: explicit null stays null.
  const failureDb = buildDb({ sessionAgentId: "native-agent" });
  await persistAssistantMessage({
    db: failureDb,
    messageId: "m4",
    sessionId: "session-1",
    userId: 6,
    content: "Agent could not be reached just now.",
    linkify,
    authorAgentId: null,
  });
  assert.equal(failureDb.created[0].authorAgentId, null);
});
