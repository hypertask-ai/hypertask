const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const contract = load("src/lib/ai/skillOffers/contract.ts");

const sources = Array.from({ length: 5 }, (_, index) => ({
  messageId: `message-${index}`,
  sessionId: `session-${index % 3}`,
  content: "Always put the ticket id next to the title, not in the body.",
}));
const offer = contract.verifySkillOfferPattern(
  {
    key: "ticket-id-next-to-title",
    rule: "Put the ticket id next to the title.",
    kind: "memory",
    quotes: Array.from({ length: 5 }, (_, index) => ({
      messageId: `message-${index}`,
      quote: "ticket id next to the title, not in the body",
    })),
  },
  sources,
);

function offerHarness({ claim = true, detected = offer, failSources = false } = {}) {
  const calls = [];
  const offers = load("src/lib/ai/skillOffers/offer.ts", {
    "@/lib/prisma": { default: { project: { findUnique: async () => ({ teamId: "team-1" }) } } },
    "./store": {
      claimSkillOfferScan: async () => { calls.push(["scan"]); return claim; },
      createSkillOffer: async ({ offer: created }) => {
        calls.push(["create", created.key]);
        return { ...created, id: "6d1f2c8e-3b4a-4f2e-9c1d-2a5b7e9f0c33", userId: 985, projectId: 15, sessionId: "session-0", createdAt: "2026-11-08T00:00:00.000Z", status: "pending" };
      },
    },
    "./detect": {
      loadInstructionSources: async () => {
        if (failSources) throw new Error("database down");
        calls.push(["sources"]);
        return sources;
      },
      detectRepeatedInstruction: async () => { calls.push(["detect"]); return detected; },
    },
  });
  return { calls, maybeOffer: offers.maybeOfferRepeatedInstruction };
}

test("no board, no chat session or an agent chat never reaches the scan", async () => {
  const noBoard = offerHarness();
  assert.equal(await noBoard.maybeOffer({ userId: 985, projectId: null, sessionId: "session-0" }), null);
  const noSession = offerHarness();
  assert.equal(await noSession.maybeOffer({ userId: 985, projectId: 15, sessionId: null }), null);
  const agent = offerHarness();
  assert.equal(await agent.maybeOffer({ userId: 985, projectId: 15, sessionId: "session-0", actingAgentId: "agent-1" }), null);
  assert.deepEqual([...noBoard.calls, ...noSession.calls, ...agent.calls], []);
});

test("a detected repetition returns the card link once and nothing while cooling down", async () => {
  const ready = offerHarness();
  assert.match(
    await ready.maybeOffer({ userId: 985, projectId: 15, sessionId: "session-0" }),
    /\/ai\/skill-offer\/6d1f2c8e-3b4a-4f2e-9c1d-2a5b7e9f0c33/,
  );

  const cooling = offerHarness({ claim: false });
  assert.equal(await cooling.maybeOffer({ userId: 985, projectId: 15, sessionId: "session-0" }), null);
  assert.deepEqual(cooling.calls.filter(([kind]) => kind === "detect"), []);
});

test("nothing under the threshold and nothing already offered returns no card", async () => {
  const quiet = offerHarness({ detected: null });
  assert.equal(await quiet.maybeOffer({ userId: 985, projectId: 15, sessionId: "session-0" }), null);
  assert.deepEqual(quiet.calls.filter(([kind]) => kind === "create"), []);
});

test("a failing scan never breaks the chat turn", async () => {
  const broken = offerHarness({ failSources: true });
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(await broken.maybeOffer({ userId: 985, projectId: 15, sessionId: "session-0" }), null);
  } finally {
    console.error = originalError;
  }
});
