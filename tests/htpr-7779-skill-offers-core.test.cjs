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

function pattern(count) {
  return {
    key: "ticket-id-next-to-title",
    rule: "Put the ticket id next to the title, not in the body.",
    kind: "memory",
    quotes: Array.from({ length: count }, (_, index) => ({
      messageId: `message-${index}`,
      quote: "ticket id next to the title, not in the body",
    })),
  };
}

test("an offer needs five occurrences across three chats", () => {
  assert.equal(contract.verifySkillOfferPattern(pattern(4), sources(4, 3)), null);
  assert.equal(contract.verifySkillOfferPattern(pattern(5), sources(5, 2)), null);
  const verified = contract.verifySkillOfferPattern(pattern(5), sources(5, 3));
  assert.equal(verified.occurrences, 5);
  assert.equal(verified.sessionCount, 3);
  assert.equal(verified.key, "ticket-id-next-to-title");
  assert.equal(verified.quotes.length, 5);
});

test("a quote the person never typed, or another person's message, cannot carry the offer", () => {
  const invented = pattern(5);
  invented.quotes[0] = { ...invented.quotes[0], quote: "put the ticket id in the body of every comment" };
  assert.equal(contract.verifySkillOfferPattern(invented, sources(5, 3)), null);
  const foreign = pattern(5);
  foreign.quotes[0] = { messageId: "not-mine", quote: "ticket id next to the title" };
  assert.equal(contract.verifySkillOfferPattern(foreign, sources(5, 3)), null);
});

test("a skill offer without a draft is refused, a memory offer needs none", () => {
  const skill = { ...pattern(5), kind: "skill" };
  assert.equal(contract.verifySkillOfferPattern(skill, sources(5, 3)), null);
  const drafted = {
    ...skill,
    draft: { slug: "ticket-id-title", name: "Ticket id in the title", description: null, argumentHint: null, body: "Read the ticket.\nPut the id next to the title." },
  };
  assert.equal(contract.verifySkillOfferPattern(drafted, sources(5, 3)).draft.slug, "ticket-id-title");
  assert.equal(contract.verifySkillOfferPattern(pattern(5), sources(5, 3)).draft, null);
});

test("the offer link is the only card markup and carries one id", () => {
  const id = "6d1f2c8e-3b4a-4f2e-9c1d-2a5b7e9f0c33";
  const extracted = contract.extractSkillOfferIds(`<p>Done.</p>${contract.skillOfferLink(id)}`);
  assert.deepEqual(extracted.ids, [id]);
  assert.equal(extracted.html.includes("/ai/skill-offer/"), false);
});

function fakeRedis() {
  const values = new Map();
  const hashes = new Map();
  return {
    hashes,
    set: async (key, value, ...args) => {
      if (args.includes("NX") && values.has(key)) return null;
      values.set(key, value);
      return "OK";
    },
    get: async (key) => values.get(key) ?? null,
    del: async (key) => { values.delete(key); return 1; },
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

const verifiedOffer = () => contract.verifySkillOfferPattern(pattern(5), sources(5, 3));

test("the same repeated instruction is offered once, even after a dismissal", async () => {
  const { store } = storeHarness();
  const offer = verifiedOffer();
  const first = await store.createSkillOffer({ userId: 985, projectId: 15, sessionId: "session-0", offer });
  assert.ok(first);
  assert.equal(await store.createSkillOffer({ userId: 985, projectId: 15, sessionId: "session-1", offer }), null);
  await store.decideSkillOffer({ userId: 985, id: first.id, decision: "dismissed" });
  assert.equal(await store.createSkillOffer({ userId: 985, projectId: 15, sessionId: "session-2", offer }), null);
});

test("dismissing logs one decision and keeps the offer to its owner", async () => {
  const { redis, store } = storeHarness();
  const record = await store.createSkillOffer({ userId: 985, projectId: 15, sessionId: "session-0", offer: verifiedOffer() });
  assert.equal(await store.loadSkillOffer(986, record.id), null);
  assert.equal((await store.decideSkillOffer({ userId: 985, id: record.id, decision: "dismissed" })).status, "dismissed");
  assert.equal((await store.decideSkillOffer({ userId: 985, id: record.id, decision: "saved" })).status, "dismissed");
  assert.equal(redis.hashes.get("ai-skill-offer:log:15").get("memory:dismissed"), 1);
  assert.equal(redis.hashes.get("ai-skill-offer:log:15").get("memory:saved"), undefined);
});

test("two decisions at once record one decision, never two", async () => {
  const { redis, store } = storeHarness();
  const record = await store.createSkillOffer({ userId: 985, projectId: 15, sessionId: "session-0", offer: verifiedOffer() });
  const results = await Promise.allSettled([
    store.decideSkillOffer({ userId: 985, id: record.id, decision: "dismissed" }),
    store.decideSkillOffer({ userId: 985, id: record.id, decision: "saved" }),
  ]);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const counts = [...(redis.hashes.get("ai-skill-offer:log:15")?.values() ?? [])];
  assert.deepEqual(counts, [1]);
});

test("the offer scan runs at most once per board in its cooldown", async () => {
  const { store } = storeHarness();
  assert.equal(await store.claimSkillOfferScan(985, 15), true);
  assert.equal(await store.claimSkillOfferScan(985, 15), false);
  assert.equal(await store.claimSkillOfferScan(985, 16), true);
});
