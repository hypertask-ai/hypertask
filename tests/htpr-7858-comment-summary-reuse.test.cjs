const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { loadModule: load } = require("./helpers/loadModule.cjs");

const flag = "htpr-7858-comment-summary-reuse";
const digest = (text) => createHash("sha256").update(text).digest("hex");

function fixture({ enabled = true, finishReason = "stop", output = "Saved summary", duringGeneration } = {}) {
  const stored = {
    id: 44, text: "word ".repeat(240), summary: null, summaryTextHash: null,
    activity: null, creatorId: 985, agentId: null,
    task: { id: 91, userId: 985, projectId: 7283,
      project: { teamId: "qa-team", team: { aiProviderSettings: {} } } },
  };
  let calls = 0;
  const writes = [];
  const summary = load("src/app/api/ai/_lib/commentSummaries.ts", {
    "@/app/api/ai/_lib/allowanceRefusal": { warnIfAllowanceRefused: () => null },
    "@/lib/flags/definitions/htpr-7716-allowance-fallbacks": { HTPR_7716_ALLOWANCE_FALLBACKS_FLAG: "htpr-7716-allowance-fallbacks" },
    "@/lib/net/downloadWithoutBrotli": {},
    "@/app/api/ai/_lib/modelProvider": {
      resolveAiModel: () => ({}), configureAiModelUsage() {}, providerOptionsForAiModel: () => ({}),
    },
    "@/app/api/ai/_lib/byokKeys": {
      getAiDefaultModelContext: async () => ({ haiku55Enabled: false }),
      getTeamGatewayApiKey: async () => null,
    },
    "@/lib/ai/prompts/registry": { renderPrompt: (_key, fallback) => fallback },
    ai: { generateText: async () => {
      calls++;
      duringGeneration?.(stored);
      return { text: output, finishReason };
    } },
    "@/app/api/ai/_lib/taskContent": { convertHtmlToText: (text) => text.trim() },
    "@/app/api/ai/_lib/systemModelLadder": { resolveSystemModel: () => ({ model: "test-model", provider: "gateway" }) },
    "@/app/api/ai/_lib/allowanceError": { findSharedAiAllowanceError: () => null },
    "@/lib/prisma": { __esModule: true, default: { comment: {
      findUnique: async () => ({ ...stored }),
      updateMany: async (write) => {
        writes.push(write);
        if (write.where.text !== stored.text) return { count: 0 };
        Object.assign(stored, write.data);
        return { count: 1 };
      },
    } } },
    "@/lib/flags": {
      HTPR_7858_COMMENT_SUMMARY_REUSE_FLAG: flag,
      isFeatureEnabled: async (key) => key === flag && enabled,
    },
  });
  const { default: handler } = load("src/pages/api/queues/FAST/generateCommentSummaryQueue.ts", {
    "@/lib/qstash": { withQstashSignature: (handler) => handler },
    "@/app/api/ai/_lib/commentSummaries": summary,
  });
  async function run() {
    const response = {
      statusCode: null, body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await handler({ body: { commentId: 44 } }, response);
    return { status: response.statusCode, body: response.body };
  }
  return { run, stored, writes, get calls() { return calls; } };
}

test("queue replay keeps the saved summary without a second provider call", async () => {
  const f = fixture();
  assert.deepEqual(await f.run(), { status: 200, body: { ok: true } });
  assert.equal(f.stored.summary, "Saved summary");
  assert.equal(f.stored.summaryTextHash, digest(f.stored.text));
  assert.deepEqual(await f.run(), { status: 200, body: { ok: true } });
  assert.equal(f.calls, 1);
  assert.equal(f.writes.length, 1);
});

test("edited text and a cleared or legacy summary are generated again", async () => {
  const f = fixture();
  await f.run();
  f.stored.text += "changed";
  assert.deepEqual(await f.run(), { status: 200, body: { ok: true } });
  assert.equal(f.calls, 2);
  assert.equal(f.stored.summaryTextHash, digest(f.stored.text));
  f.stored.summary = null;
  await f.run();
  assert.equal(f.stored.summary, "Saved summary");
  assert.equal(f.calls, 3);
  f.stored.summaryTextHash = null;
  await f.run();
  assert.equal(f.stored.summaryTextHash, digest(f.stored.text));
  assert.equal(f.calls, 4);
});

test("flag Off retains regeneration, even for an existing matching fingerprint", async () => {
  const f = fixture({ enabled: false });
  f.stored.summary = "Previous summary";
  f.stored.summaryTextHash = digest(f.stored.text);
  await f.run();
  assert.deepEqual(await f.run(), { status: 200, body: { ok: true } });
  assert.equal(f.calls, 2);
  assert.equal(f.stored.summary, "Saved summary");
  assert.deepEqual(f.writes[0].data, { summary: "Saved summary", summaryTextHash: digest(f.stored.text) });
});

test("short and activity comments clear old summaries before checking reuse", async () => {
  for (const activity of [null, { type: "thought" }]) {
    const f = fixture();
    if (activity === null) f.stored.text = "short";
    f.stored.activity = activity;
    f.stored.summary = "Stale summary";
    f.stored.summaryTextHash = digest(f.stored.text);
    assert.deepEqual(await f.run(), { status: 200, body: { skipped: true } });
    assert.equal(f.stored.summary, null);
    assert.equal(f.calls, 0);
  }
});

test("empty and truncated results never mark the input as successfully summarized", async () => {
  for (const options of [{ output: " " }, { finishReason: "length" }]) {
    const f = fixture(options);
    f.stored.summary = "Previous summary";
    assert.deepEqual(await f.run(), { status: 200, body: { skipped: true } });
    await f.run();
    assert.equal(f.calls, 2);
    assert.equal(f.stored.summary, "Previous summary");
    assert.equal(f.stored.summaryTextHash, null);
  }
});

test("an edit during generation cannot save a stale summary or its fingerprint", async () => {
  const f = fixture({ duringGeneration: (stored) => { stored.text += "edited"; } });
  assert.deepEqual(await f.run(), { status: 200, body: { skipped: true } });
  assert.equal(f.calls, 1);
  assert.equal(f.stored.summary, null);
  assert.equal(f.stored.summaryTextHash, null);
});
