const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

function createFakeRedis() {
  const sets = new Map();
  const strings = new Map();
  return {
    calls: [],
    async zadd(key, score, member) {
      this.calls.push(["zadd", key, score, member]);
      const entries = sets.get(key) ?? [];
      entries.push({ score, member });
      sets.set(key, entries);
      return 1;
    },
    async zremrangebyscore(key, min, max) {
      this.calls.push(["zremrangebyscore", key, min, max]);
      const low = min === "-inf" ? -Infinity : Number(min);
      const high = max === "+inf" ? Infinity : Number(max);
      const entries = sets.get(key) ?? [];
      const kept = entries.filter(
        (entry) => !(entry.score >= low && entry.score <= high),
      );
      sets.set(key, kept);
      return entries.length - kept.length;
    },
    async eval(script, keyCount, key, arg) {
      this.calls.push(["eval", key, arg]);
      if (!script.includes("claimed <=")) throw new Error("unexpected script");
      const claimed = strings.get(key);
      if (claimed !== undefined && claimed <= arg) {
        strings.delete(key);
        return 1;
      }
      return 0;
    },
    async zrangebyscore(key, min, max) {
      this.calls.push(["zrangebyscore", key, min, max]);
      return (sets.get(key) ?? [])
        .filter((entry) => entry.score >= min && entry.score <= max)
        .map((entry) => entry.member);
    },
    async expire(key, ttl) {
      this.calls.push(["expire", key, ttl]);
      return 1;
    },
    async set(key, value, expiryMode, ttl, condition) {
      this.calls.push(["set", key, value, expiryMode, ttl, condition]);
      if (strings.has(key)) return null;
      strings.set(key, value);
      return "OK";
    },
    async del(key) {
      this.calls.push(["del", key]);
      strings.delete(key);
      return 1;
    },
    has(key) {
      return strings.has(key);
    },
  };
}

// One module instance for the whole file: jiti caches resolved modules, and
// the stubs below are mutable so each test can reset its own state.
const state = {
  redis: createFakeRedis(),
  comments: [],
  task: { id: 38547, userId: 6 },
  captured: [],
};

stubModule("src/lib/redis.ts", { getRedis: async () => state.redis });
stubModule("src/lib/prisma.ts", {
  default: {
    task: { findFirst: async () => state.task },
    user: { findUnique: async () => ({ displayName: "Valentin Yeo" }) },
  },
});
process.env.VERCEL_ENV = "production";
stubModule("src/lib/flags.ts", {
  FEATURE_FLAG_OWNER_USER_ID: 6,
  FEATURE_FLAG_TICKET_PROJECT_ID: 15,
});
stubModule("src/utils/controllers/comments/createCommentService.ts", {
  createCommentService: async (params) => {
    state.comments.push(params);
    return { id: 1 };
  },
});

const jiti = createJiti(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const observability = jiti(
  path.join(root, "src/lib/telemetry/aiChatObservability.ts"),
);

function reset(task = { id: 38547, userId: 6 }) {
  state.redis = createFakeRedis();
  state.comments = [];
  state.captured = [];
  state.task = task;
}

const baseTurn = {
  userId: 6,
  model: "gpt-5.5",
  provider: "openai",
  traceId: "11111111-1111-4111-8111-111111111111",
  outcome: "ok",
  latencyMs: 1200,
};

test("window math counts failures and p95 and ignores cancelled turns", () => {
  const metrics = observability.evaluateAiChatTurnWindow([
    "a|1000|ok",
    "b|2000|failed",
    "c|900000|cancelled",
    "d|3000|ok",
  ]);
  assert.equal(metrics.total, 3);
  assert.equal(metrics.failed, 1);
  assert.ok(Math.abs(metrics.errorRate - 1 / 3) < 1e-9);
  // Nearest-rank p95 over [1000, 2000, 3000] is the slowest turn.
  assert.equal(metrics.p95LatencyMs, 3000);
});

test("thresholds breach on error rate or slow p95, and an empty window never breaches", () => {
  assert.equal(
    observability.aiChatTurnWindowBreached({
      total: 100,
      failed: 6,
      errorRate: 0.06,
      p95LatencyMs: 1000,
    }),
    true,
  );
  assert.equal(
    observability.aiChatTurnWindowBreached({
      total: 100,
      failed: 0,
      errorRate: 0,
      p95LatencyMs: 20001,
    }),
    true,
  );
  assert.equal(
    observability.aiChatTurnWindowBreached({
      total: 0,
      failed: 0,
      errorRate: 0,
      p95LatencyMs: 0,
    }),
    false,
  );
});

test("a turn is recorded once and trimmed to the window", async () => {
  reset();
  const redis = state.redis;
  const metrics = await observability.recordAiChatTurn(
    { ...baseTurn, latencyMs: 4000, inputTokens: 11, outputTokens: 7 },
    1_000_000,
  );
  assert.equal(metrics.total, 1);
  const zadd = redis.calls.find((call) => call[0] === "zadd");
  assert.match(zadd[3], /^[0-9a-f-]{36}\|4000\|ok$/);
  const trimmed = redis.calls.find((call) => call[0] === "zremrangebyscore");
  assert.equal(trimmed[3], 1_000_000 - observability.AI_CHAT_TURN_WINDOW_MS);
  assert.equal(state.comments.length, 0);
});

test("the captured generation carries no chat text and tags the right user", () => {
  const capture = observability.buildAiChatTurnCapture(
    { ...baseTurn, inputTokens: 11, outputTokens: 7, latencyMs: 4000 },
    "production",
  );
  assert.equal(capture.event, "$ai_generation");
  assert.equal(capture.distinctId, "6");
  assert.equal(capture.properties.$ai_model, "gpt-5.5");
  assert.equal(capture.properties.$ai_provider, "openai");
  assert.equal(capture.properties.$ai_trace_id, baseTurn.traceId);
  assert.equal(capture.properties.$ai_input_tokens, 11);
  assert.equal(capture.properties.$ai_output_tokens, 7);
  assert.equal(capture.properties.$ai_latency, 4);
  assert.equal(capture.properties.$ai_http_status, 200);
  assert.equal(capture.properties.ht_user_id, 6);
  assert.equal(capture.properties.ht_outcome, "ok");
  // No prompt or reply body is ever part of the event.
  assert.deepEqual(
    Object.keys(capture.properties).filter(
      (key) => key === "$ai_input" || key === "$ai_output_choices",
    ),
    [],
  );

  const failed = observability.buildAiChatTurnCapture(
    { ...baseTurn, outcome: "failed", error: new Error("boom") },
    "production",
  );
  assert.equal(failed.properties.$ai_http_status, 500);
  assert.equal(failed.properties.$ai_is_error, true);
  assert.match(failed.properties.$ai_error, /boom/);

  const cancelled = observability.buildAiChatTurnCapture(
    { ...baseTurn, outcome: "cancelled" },
    "production",
  );
  assert.equal(cancelled.properties.$ai_http_status, 0);
  assert.equal("$ai_error" in cancelled.properties, false);
});

test("a recovery snapshot cannot delete a claim made after it", async () => {
  reset();
  // A breach claims at 1_000_500; a concurrent healthy snapshot taken at
  // 1_000_000 must leave that newer claim alone.
  await observability.recordAiChatTurn(
    { ...baseTurn, outcome: "failed", latencyMs: 1000 },
    1_000_500,
  );
  assert.equal(state.comments.length, 1);
  await observability.recordAiChatTurn({ ...baseTurn, outcome: "ok" }, 1_000_000);
  assert.equal(state.redis.has("ai:chat-turn-alert:production"), true);
  await observability.recordAiChatTurn(
    { ...baseTurn, outcome: "failed", latencyMs: 1000 },
    1_000_600,
  );
  assert.equal(state.comments.length, 1, "one ongoing problem is one comment");
});

test("a failed turn redacts secrets out of the captured error line", () => {
  const redacted = observability.redactAiCaptureProperties({
    $ai_model: "gpt-5.5",
    $ai_error: JSON.stringify({
      message: "Upstream refused: Authorization: Bearer sk-live-abc123",
      stack: "Error: at fetch (https://api.openai.com/v1?key=sk-live-abc123)",
    }),
  });
  assert.ok(!redacted.$ai_error.includes("sk-live-abc123"));
  assert.match(redacted.$ai_error, /redacted/);
  // Non-error properties are left exactly as the SDK produced them.
  assert.equal(redacted.$ai_model, "gpt-5.5");
});

test("one breach posts one comment and later breaches stay quiet until it recovers", async () => {
  reset();
  const redis = state.redis;

  await observability.recordAiChatTurn(
    { ...baseTurn, outcome: "failed", latencyMs: 1000 },
    1_000_000,
  );
  assert.equal(state.comments.length, 1);
  assert.match(state.comments[0].text, /AI Chat is unhealthy/);
  assert.equal(state.comments[0].creatorId, 6);
  assert.equal(state.comments[0].taskId, 38547);
  assert.ok(!state.comments[0].text.includes("<script"));

  await observability.recordAiChatTurn(
    { ...baseTurn, outcome: "failed", latencyMs: 1000 },
    1_001_000,
  );
  assert.equal(state.comments.length, 1, "one ongoing problem is one comment");

  // Once the failures age out of the 15-minute window the incident is over,
  // which clears the claim so the next one alerts again.
  const recovered = 1_000_000 + 16 * 60 * 1000;
  await observability.recordAiChatTurn({ ...baseTurn, outcome: "ok" }, recovered);
  assert.equal(redis.has("ai:chat-turn-alert:production"), false);
  await observability.recordAiChatTurn(
    { ...baseTurn, outcome: "failed", latencyMs: 1000 },
    recovered + 1000,
  );
  assert.equal(state.comments.length, 2);
});

test("a failed alert comment releases the claim so the next turn retries", async () => {
  reset(null);
  await observability.recordAiChatTurn(
    { ...baseTurn, outcome: "failed", latencyMs: 1000 },
    1_000_000,
  );
  assert.equal(state.comments.length, 0);
  assert.equal(state.redis.has("ai:chat-turn-alert:production"), false);
});

test("recording survives a Redis failure without throwing", async () => {
  reset();
  state.redis.zadd = async () => {
    throw new Error("redis down");
  };
  const metrics = await observability.recordAiChatTurn(baseTurn, 1_000_000);
  assert.equal(metrics, null);
});
