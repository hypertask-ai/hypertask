const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const contract = load("src/lib/ai/skillOffers/contract.ts");

const INSTRUCTION = "Always put the ticket id next to the title";
const source = (index, session) => ({
  messageId: `message-${index}`,
  sessionId: `session-${session}`,
  content: `${INSTRUCTION}, not in the body.`,
});

function sources(count, sessions) {
  return Array.from({ length: count }, (_, index) => source(index, index % sessions));
}

function pattern(count, sessions) {
  return {
    key: "ticket-id-next-to-title",
    rule: "Put the ticket id next to the title, not in the body.",
    kind: "memory",
    quotes: Array.from({ length: count }, (_, index) => ({
      messageId: `message-${index}`,
      quote: `ticket id next to the title, not in the body`,
    })),
    session: sessions,
  };
}

test("the skill offer flag ships at Owner and QA with a rollback reason", () => {
  const { definitions } = require("./helpers/flag-files.cjs");
  const definition = definitions().find((flag) => flag.key === "htpr-7779-skill-offers");
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
  assert.match(definition.releaseRisk.reason, /Off hides the card/);
});

test("an offer needs five occurrences across three chats", () => {
  assert.equal(contract.verifySkillOfferPattern(pattern(4, 3), sources(4, 3)), null);
  assert.equal(contract.verifySkillOfferPattern(pattern(5, 2), sources(5, 2)), null);
  const verified = contract.verifySkillOfferPattern(pattern(5, 3), sources(5, 3));
  assert.equal(verified.occurrences, 5);
  assert.equal(verified.sessionCount, 3);
  assert.equal(verified.key, "ticket-id-next-to-title");
  assert.equal(verified.quotes.length, 5);
});

test("a quote the person never typed cannot carry the offer", () => {
  const invented = pattern(5, 3);
  invented.quotes = invented.quotes.map((quote, index) => index === 0
    ? { ...quote, quote: "put the ticket id in the body of every comment" }
    : quote);
  const verified = contract.verifySkillOfferPattern(invented, sources(5, 3));
  assert.equal(verified, null);
});

test("a quote pointing at another person's message is dropped", () => {
  const foreign = pattern(5, 3);
  foreign.quotes[0] = { messageId: "not-mine", quote: "ticket id next to the title" };
  assert.equal(contract.verifySkillOfferPattern(foreign, sources(5, 3)), null);
});

test("a skill offer without a draft is refused, a memory offer needs none", () => {
  const skill = { ...pattern(5, 3), kind: "skill" };
  assert.equal(contract.verifySkillOfferPattern(skill, sources(5, 3)), null);
  const drafted = {
    ...skill,
    draft: { slug: "ticket-id-title", name: "Ticket id in the title", description: null, argument_hint: null, body: "Read the ticket.\nPut the id next to the title." },
  };
  const verified = contract.verifySkillOfferPattern(drafted, sources(5, 3));
  assert.equal(verified.draft.slug, "ticket-id-title");
  assert.equal(contract.verifySkillOfferPattern(pattern(5, 3), sources(5, 3)).draft, null);
});

test("the offer link is the only card markup and carries one id", () => {
  const id = "6d1f2c8e-3b4a-4f2e-9c1d-2a5b7e9f0c33";
  const html = `<p>Done.</p>${contract.skillOfferLink(id)}`;
  const extracted = contract.extractSkillOfferIds(html);
  assert.deepEqual(extracted.ids, [id]);
  assert.equal(extracted.html.includes("/ai/skill-offer/"), false);
});

function fakeRedis() {
  const values = new Map();
  const hashes = new Map();
  return {
    values,
    hashes,
    set: async (key, value, ...args) => {
      if (args.includes("NX") && values.has(key)) return null;
      values.set(key, value);
      return "OK";
    },
    get: async (key) => values.get(key) ?? null,
    hincrby: async (key, field, increment) => {
      const hash = hashes.get(key) ?? new Map();
      const next = (hash.get(field) ?? 0) + increment;
      hash.set(field, next);
      hashes.set(key, hash);
      return next;
    },
  };
}

function storeHarness() {
  const redis = fakeRedis();
  const store = load("src/lib/ai/skillOffers/store.ts", { "@/lib/redis": { getRedis: async () => redis } });
  return { redis, store };
}

const verifiedOffer = () => contract.verifySkillOfferPattern(pattern(5, 3), sources(5, 3));

test("the same repeated instruction is offered once, even after a dismissal", async () => {
  const { store } = storeHarness();
  const offer = verifiedOffer();
  const first = await store.createSkillOffer({ userId: 985, projectId: 15, sessionId: "session-0", offer });
  assert.ok(first);
  const second = await store.createSkillOffer({ userId: 985, projectId: 15, sessionId: "session-1", offer });
  assert.equal(second, null);
  await store.decideSkillOffer({ userId: 985, id: first.id, decision: "dismissed" });
  const third = await store.createSkillOffer({ userId: 985, projectId: 15, sessionId: "session-2", offer });
  assert.equal(third, null);
});

test("dismissing logs one decision and keeps the offer out of another person's hands", async () => {
  const { redis, store } = storeHarness();
  const offer = verifiedOffer();
  const record = await store.createSkillOffer({ userId: 985, projectId: 15, sessionId: "session-0", offer });
  assert.equal(await store.loadSkillOffer(986, record.id), null);
  const dismissed = await store.decideSkillOffer({ userId: 985, id: record.id, decision: "dismissed" });
  assert.equal(dismissed.status, "dismissed");
  const again = await store.decideSkillOffer({ userId: 985, id: record.id, decision: "saved" });
  assert.equal(again.status, "dismissed");
  assert.equal(redis.hashes.get("ai-skill-offer:log:15").get("memory:dismissed"), 1);
  assert.equal(redis.hashes.get("ai-skill-offer:log:15").get("memory:saved"), undefined);
});

test("the offer scan runs at most once per board in its cooldown", async () => {
  const { store } = storeHarness();
  assert.equal(await store.claimSkillOfferScan(985, 15), true);
  assert.equal(await store.claimSkillOfferScan(985, 15), false);
  assert.equal(await store.claimSkillOfferScan(985, 16), true);
});

function offerHarness({ enabled = true, claim = true, offer = verifiedOffer() } = {}) {
  const calls = [];
  const offerModule = load("src/lib/ai/skillOffers/offer.ts", {
    "@/lib/flags": { isFeatureEnabled: async (flag, userId) => { calls.push(["flag", flag, userId]); return enabled; } },
    "@/lib/prisma": { default: { project: { findUnique: async () => ({ teamId: "team-1" }) } } },
    "./store": {
      claimSkillOfferScan: async () => { calls.push(["scan"]); return claim; },
      createSkillOffer: async ({ offer: created }) => { calls.push(["create", created.key]); return { ...created, id: "6d1f2c8e-3b4a-4f2e-9c1d-2a5b7e9f0c33", userId: 985, projectId: 15, sessionId: "session-0", createdAt: "2026-11-08T00:00:00.000Z", status: "pending" }; },
    },
    "./detect": {
      loadInstructionSources: async () => { calls.push(["sources"]); return sources(5, 3); },
      detectRepeatedInstruction: async () => { calls.push(["detect"]); return offer; },
    },
  });
  return { calls, offerModule };
}

test("the chat offer stays off when the flag is off, in an agent chat, or with no board", async () => {
  const off = offerHarness({ enabled: false });
  assert.equal(await off.offerModule.maybeOfferRepeatedInstruction({ userId: 985, projectId: 15, sessionId: "session-0" }), null);
  assert.deepEqual(off.calls.filter(([kind]) => kind === "scan"), []);

  const agent = offerHarness();
  assert.equal(await agent.offerModule.maybeOfferRepeatedInstruction({ userId: 985, projectId: 15, sessionId: "session-0", actingAgentId: "agent-1" }), null);

  const noBoard = offerHarness();
  assert.equal(await noBoard.offerModule.maybeOfferRepeatedInstruction({ userId: 985, projectId: null, sessionId: "session-0" }), null);
});

test("a detected repetition returns the card link once and nothing when it was already offered", async () => {
  const ready = offerHarness();
  const link = await ready.offerModule.maybeOfferRepeatedInstruction({ userId: 985, projectId: 15, sessionId: "session-0" });
  assert.match(link, /\/ai\/skill-offer\/6d1f2c8e-3b4a-4f2e-9c1d-2a5b7e9f0c33/);

  const cooling = offerHarness({ claim: false });
  assert.equal(await cooling.offerModule.maybeOfferRepeatedInstruction({ userId: 985, projectId: 15, sessionId: "session-0" }), null);
  assert.deepEqual(cooling.calls.filter(([kind]) => kind === "detect"), []);
});

test("a failing detection never breaks the chat turn", async () => {
  const broken = load("src/lib/ai/skillOffers/offer.ts", {
    "@/lib/flags": { isFeatureEnabled: async () => true },
    "@/lib/prisma": { default: {} },
    "./store": { claimSkillOfferScan: async () => true, createSkillOffer: async () => null },
    "./detect": { loadInstructionSources: async () => { throw new Error("database down"); }, detectRepeatedInstruction: async () => null },
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(await broken.maybeOfferRepeatedInstruction({ userId: 985, projectId: 15, sessionId: "session-0" }), null);
  } finally {
    console.error = originalError;
  }
});
