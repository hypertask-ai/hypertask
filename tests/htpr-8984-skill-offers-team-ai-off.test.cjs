const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const contract = load("src/lib/ai/skillOffers/contract.ts");

const sources = Array.from({ length: contract.SKILL_OFFER_MIN_OCCURRENCES }, (_, index) => ({
  messageId: `message-${index}`,
  sessionId: `session-${index % 3}`,
  content: "Always put the ticket id next to the title, not in the body.",
}));
const offer = contract.verifySkillOfferPattern(
  {
    key: "ticket-id-next-to-title",
    rule: "Put the ticket id next to the title.",
    kind: "memory",
    quotes: Array.from({ length: contract.SKILL_OFFER_MIN_OCCURRENCES }, (_, index) => ({
      messageId: `message-${index}`,
      quote: "ticket id next to the title, not in the body",
    })),
  },
  sources,
);

function harness({ boardSettings = undefined, enabled = true } = {}) {
  const calls = [];
  const offers = load("src/lib/ai/skillOffers/offer.ts", {
    "@/lib/flags": { isFeatureEnabled: async () => enabled },
    "@/lib/prisma": {
      default: {
        project: {
          findUnique: async () => {
            calls.push(["project"]);
            return { teamId: "team-1", team: { aiProviderSettings: boardSettings } };
          },
        },
      },
    },
    "./store": {
      claimSkillOfferScan: async () => {
        calls.push(["scan"]);
        return true;
      },
      createSkillOffer: async ({ offer: created }) => {
        calls.push(["create"]);
        return {
          ...created,
          id: "6d1f2c8e-3b4a-4f2e-9c1d-2a5b7e9f0c33",
          userId: 985,
          projectId: 15,
          sessionId: "session-0",
          createdAt: "2026-11-08T00:00:00.000Z",
          status: "pending",
        };
      },
    },
    "./detect": {
      loadInstructionSources: async () => {
        calls.push(["sources"]);
        return sources;
      },
      detectRepeatedInstruction: async () => {
        calls.push(["detect"]);
        return offer;
      },
    },
  });
  return { calls, maybeOffer: offers.maybeOfferRepeatedInstruction };
}

const ai = (aiChat) => ({ featureToggles: { aiChat } });
const ran = (calls) => calls.map(([kind]) => kind).filter((kind) => kind !== "project");

test("a board team with AI chat off never reads a chat message or calls the model", async () => {
  const off = harness({ boardSettings: ai(false) });
  assert.equal(await off.maybeOffer({ userId: 985, projectId: 15, sessionId: "session-0" }), null);
  assert.deepEqual(ran(off.calls), []);
});

test("the chat's own team opt-out also stops the scan", async () => {
  const off = harness({ boardSettings: ai(true) });
  assert.equal(
    await off.maybeOffer({ userId: 985, projectId: 15, sessionId: "session-0", teamAiSettings: ai(false) }),
    null,
  );
  assert.deepEqual(ran(off.calls), []);
});

test("AI chat on for both the board team and the chat team still offers", async () => {
  const on = harness({ boardSettings: ai(true) });
  assert.match(
    await on.maybeOffer({
      userId: 985,
      projectId: 15,
      sessionId: "session-0",
      teamAiSettings: ai(true),
    }),
    /\/ai\/skill-offer\/6d1f2c8e-3b4a-4f2e-9c1d-2a5b7e9f0c33/,
  );
  assert.deepEqual(ran(on.calls), ["sources", "scan", "detect", "create"]);
});

test("a personal board with no team settings is not blocked", async () => {
  const personal = harness();
  assert.match(
    await personal.maybeOffer({ userId: 985, projectId: 15, sessionId: "session-0" }),
    /\/ai\/skill-offer\/6d1f2c8e-3b4a-4f2e-9c1d-2a5b7e9f0c33/,
  );
  assert.deepEqual(ran(personal.calls), ["sources", "scan", "detect", "create"]);
});
