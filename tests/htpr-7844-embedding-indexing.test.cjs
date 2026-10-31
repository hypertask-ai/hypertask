const test = require("node:test");
const assert = require("node:assert/strict");
const writes = [];
const queries = [];
const flagUsers = [];
const usage = [];
let flagOn = true;
const { loadModule } = require("./helpers/loadModule.cjs");
const stubs = {};
function stub(file, exports) {
  stubs["@/" + file.slice(4).replace(/\.ts$/, "")] = exports;
}
stub("src/lib/prisma.ts", { default: { team: { findUnique: async ({ where }) => ({
  aiKeyOnly: ["restricted", "opted-in"].includes(where.id),
  aiKeyOnlyPlatformServices: where.id === "opted-in",
  aiProviderSettings: null,
  googleAccount: { userId: 42 },
}) }, teamByokApiKey: { findMany: async () => [] }, project: { findUnique: async ({ where }) => ({ teamId: ({ 1: "allowed", 2: "restricted", 4: "opted-in", 5: "other-allowed" })[where.id] ?? null }) } } });
stub("src/lib/flags.ts", { isFeatureEnabled: async (_key, userId) => { flagUsers.push(userId); return flagOn; } });
stub("src/lib/turbopuffer.ts", {
  default: { namespace: () => ({ write: async (body) => { writes.push(body); return body; }, query: async (body) => { queries.push(body); return { rows: [] }; } }) },
  turbopufferNamespaces: { task: { name: "task" }, comment: { name: "comment" } },
});
stub("src/app/api/ai/_lib/aiUsage.ts", { logAiUsage: async (record) => { usage.push(record); } });
const { upsertTaskRowsToTurbopuffer, searchTasks, searchComments, embedTexts } = loadModule("src/utils/controllers/turbopuffer/turbopufferHelper.ts", stubs);

test("mixed-team upsert retains keywords and clears refused vectors", async () => {
  const previousFetch = global.fetch;
  const previousKey = process.env.TURBOPUFFER_EMBEDDINGS_API_KEY;
  const requests = [];
  process.env.TURBOPUFFER_EMBEDDINGS_API_KEY = "platform-test";
  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ data: [{ index: 0, embedding: Array(1536).fill(1) }] }) };
  };
  try {
    await upsertTaskRowsToTurbopuffer([
      { id: 1, teamId: "restricted", searchText: "private keyword" },
      { id: 2, teamId: "allowed", searchText: "public keyword" },
      { id: 3, projectId: 3, searchText: "teamless keyword" },
    ]);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].upsert_rows[0].searchText, "private keyword");
    assert.equal(writes[0].upsert_rows[0].vector, null);
    assert.equal(writes[0].upsert_rows[1].searchText, "public keyword");
    assert.deepEqual(writes[0].upsert_rows[1].vector, Array(1536).fill(1));
    assert.equal(writes[0].upsert_rows[2].searchText, "teamless keyword");
    assert.equal(writes[0].upsert_rows[2].vector, null);
    assert.deepEqual(requests.map((request) => request.input), [["public keyword"]]);
    assert.deepEqual(flagUsers, [42]);
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.TURBOPUFFER_EMBEDDINGS_API_KEY;
    else process.env.TURBOPUFFER_EMBEDDINGS_API_KEY = previousKey;
  }
});

for (const search of [searchTasks, searchComments]) {
  test(`${search.name} checks every team's funding before embedding`, async () => {
    const previousFetch = global.fetch;
    const previousKey = process.env.TURBOPUFFER_EMBEDDINGS_API_KEY;
    const requests = [];
    process.env.TURBOPUFFER_EMBEDDINGS_API_KEY = "platform-test";
    global.fetch = async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ data: [{ index: 0, embedding: Array(1536).fill(1) }] }) };
    };
    try {
      queries.length = 0;
      assert.deepEqual(await search({ searchQuery: "needle", projectIds: [1, 2], projectId: 99 }), []);
      assert.equal(requests.length, 0);
      assert.ok(queries.length > 0);
      assert.deepEqual(await search({ searchQuery: "needle", projectIds: [1, 3] }), []);
      assert.equal(requests.length, 0);
      assert.deepEqual(await search({ searchQuery: "needle", projectIds: [1] }), []);
      assert.equal(requests.length, 1);
      assert.deepEqual(requests[0].input, ["needle"]);
    } finally {
      global.fetch = previousFetch;
      if (previousKey === undefined) delete process.env.TURBOPUFFER_EMBEDDINGS_API_KEY;
      else process.env.TURBOPUFFER_EMBEDDINGS_API_KEY = previousKey;
    }
  });
}

for (const search of [searchTasks, searchComments]) {
  for (const enabled of [false, true]) {
    test(`${search.name} preserves mixed unrestricted search with flag ${enabled}`, async () => {
      const previousFetch = global.fetch;
      const previousKey = process.env.TURBOPUFFER_EMBEDDINGS_API_KEY;
      const previousFlag = flagOn;
      const requests = [];
      process.env.TURBOPUFFER_EMBEDDINGS_API_KEY = "platform-test";
      flagOn = enabled;
      global.fetch = async (_url, options) => {
        requests.push(JSON.parse(options.body));
        return { ok: true, json: async () => ({ data: [{ index: 0, embedding: Array(1536).fill(1) }] }) };
      };
      try {
        queries.length = 0;
        await search({ searchQuery: `mixed-unrestricted-${search.name}-${enabled}`, projectIds: [1, 5] });
        assert.equal(requests.length, 1);
        assert.ok(queries.some((query) => JSON.stringify(query).includes("ANN")));
        await search({ searchQuery: `mixed-refused-${search.name}-${enabled}`, projectIds: [1, 2] });
        assert.equal(requests.length, 1);
      } finally {
        global.fetch = previousFetch;
        flagOn = previousFlag;
        if (previousKey === undefined) delete process.env.TURBOPUFFER_EMBEDDINGS_API_KEY;
        else process.env.TURBOPUFFER_EMBEDDINGS_API_KEY = previousKey;
      }
    });
  }
}

test("embedding ownership survives deduplication and identifies each team", async () => {
  const previousFetch = global.fetch;
  const previousKey = process.env.TURBOPUFFER_EMBEDDINGS_API_KEY;
  const previousNow = Date.now;
  const requests = [];
  process.env.TURBOPUFFER_EMBEDDINGS_API_KEY = "platform-test";
  Date.now = () => 1000;
  global.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    await Promise.resolve();
    return { ok: true, json: async () => ({ data: [{ index: 0, embedding: Array(1536).fill(1) }], usage: { prompt_tokens: 3, total_tokens: 3 } }) };
  };
  try {
    usage.length = 0;
    await Promise.all([
      embedTexts(["same"], "opted-in"),
      embedTexts(["same"], "opted-in"),
      embedTexts(["same"], "allowed"),
    ]);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map((request) => request.body.input), [["same"], ["same"]]);
    assert.deepEqual(usage.sort((a, b) => a.teamId.localeCompare(b.teamId)), ["allowed", "opted-in"].map((teamId) => ({
      userId: null, teamId, provider: "gateway-embeddings", model: "openai/text-embedding-3-small", feature: "embeddings",
      outcome: "ok", inputTokens: 3, totalTokens: 3, costUsd: null, latencyMs: 0,
    })));
    await assert.rejects(() => embedTexts(["same"], "restricted"), { name: "TeamKeyOnlyRefusal" });
    assert.equal(requests.length, 2);
  } finally {
    global.fetch = previousFetch;
    Date.now = previousNow;
    if (previousKey === undefined) delete process.env.TURBOPUFFER_EMBEDDINGS_API_KEY;
    else process.env.TURBOPUFFER_EMBEDDINGS_API_KEY = previousKey;
  }
});

test("opted-in team searches retain semantic ranking and embedding attribution", async () => {
  const previousFetch = global.fetch;
  const previousKey = process.env.TURBOPUFFER_EMBEDDINGS_API_KEY;
  const requests = [];
  process.env.TURBOPUFFER_EMBEDDINGS_API_KEY = "platform-test";
  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ data: [{ index: 0, embedding: Array(1536).fill(1) }] }) };
  };
  try {
    usage.length = 0;
    await searchTasks({ searchQuery: "needle", projectIds: [4] });
    assert.equal(requests.length, 1);
    assert.equal(usage[0].teamId, "opted-in");
    await searchTasks({ searchQuery: "mixed-opted-in", projectIds: [1, 4] });
    assert.equal(requests.length, 2);
    assert.equal(usage[1].teamId, "allowed");
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.TURBOPUFFER_EMBEDDINGS_API_KEY;
    else process.env.TURBOPUFFER_EMBEDDINGS_API_KEY = previousKey;
  }
});

test("dictation uses the server-loaded team exception only while enabled", async () => {
  const previousFetch = global.fetch;
  const previousKey = process.env.DEEPGRAM_API_KEY;
  const requests = [];
  process.env.DEEPGRAM_API_KEY = "platform-deepgram";
  global.fetch = async (url, options) => {
    requests.push({ url, authorization: options.headers.Authorization });
    return { ok: true, json: async () => ({ results: { channels: [{ alternatives: [{ transcript: "hello" }] }] } }) };
  };
  try {
    const { transcribeWithDeepgram } = loadModule("src/lib/services/dictation/transcriptionProviders.ts", stubs);
    const audio = new Blob(["audio"], { type: "audio/webm" });
    assert.equal(await transcribeWithDeepgram(audio, { teamId: "opted-in" }), "hello");
    assert.equal(requests[0].authorization, "Token platform-deepgram");
    await assert.rejects(() => transcribeWithDeepgram(audio, { teamId: "restricted" }), { name: "TeamKeyOnlyRefusal" });
    flagOn = false;
    await assert.rejects(() => transcribeWithDeepgram(audio, { teamId: "opted-in" }), { name: "TeamKeyOnlyRefusal" });
    assert.equal(requests.length, 1);
  } finally {
    flagOn = true;
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.DEEPGRAM_API_KEY;
    else process.env.DEEPGRAM_API_KEY = previousKey;
  }
});

test("embedding retries retain team attribution", async () => {
  const previousFetch = global.fetch;
  const previousKey = process.env.TURBOPUFFER_EMBEDDINGS_API_KEY;
  const previousTimeout = global.setTimeout;
  let calls = 0;
  process.env.TURBOPUFFER_EMBEDDINGS_API_KEY = "platform-test";
  global.setTimeout = (callback) => { callback(); return 0; };
  global.fetch = async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 503, text: async () => "unavailable" };
    return { ok: true, json: async () => ({ data: [{ index: 0, embedding: Array(1536).fill(1) }] }) };
  };
  try {
    usage.length = 0;
    await embedTexts(["retry"], "opted-in");
    assert.equal(calls, 2);
    assert.deepEqual(usage.map(({ teamId, outcome }) => ({ teamId, outcome })), [
      { teamId: "opted-in", outcome: "failed" },
      { teamId: "opted-in", outcome: "ok" },
    ]);
  } finally {
    global.fetch = previousFetch;
    global.setTimeout = previousTimeout;
    if (previousKey === undefined) delete process.env.TURBOPUFFER_EMBEDDINGS_API_KEY;
    else process.env.TURBOPUFFER_EMBEDDINGS_API_KEY = previousKey;
  }
});

test("each embedding batch retains its team", async () => {
  const previousFetch = global.fetch;
  const previousKey = process.env.TURBOPUFFER_EMBEDDINGS_API_KEY;
  process.env.TURBOPUFFER_EMBEDDINGS_API_KEY = "platform-test";
  global.fetch = async (_url, options) => ({
    ok: true,
    json: async () => ({ data: JSON.parse(options.body).input.map((_, index) => ({ index, embedding: Array(1536).fill(1) })) }),
  });
  try {
    usage.length = 0;
    const result = await embedTexts(Array.from({ length: 65 }, (_, index) => `input ${index}`), "opted-in");
    assert.equal(result.length, 65);
    assert.deepEqual(usage.map(({ teamId, outcome }) => ({ teamId, outcome })), [
      { teamId: "opted-in", outcome: "ok" },
      { teamId: "opted-in", outcome: "ok" },
    ]);
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.TURBOPUFFER_EMBEDDINGS_API_KEY;
    else process.env.TURBOPUFFER_EMBEDDINGS_API_KEY = previousKey;
  }
});
