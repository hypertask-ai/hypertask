const assert = require("node:assert/strict");
const fs = require("node:fs");
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
    beforeRecoveryEval: null,
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
    async eval(script, keyCount, ...params) {
      const keys = params.slice(0, keyCount);
      const args = params.slice(keyCount);
      const key = keys[0];
      this.calls.push(["eval", ...keys, ...args]);
      if (script.includes("local existing")) {
        const existing = strings.get(key);
        if (existing === undefined) {
          strings.delete(keys[1]);
          strings.set(key, args[0]);
          return 1;
        }
        if (strings.has(keys[1])) {
          const claimedAt =
            Number(existing) > Number(args[0]) ? existing : args[0];
          strings.set(key, claimedAt);
          strings.set(keys[1], claimedAt);
        }
        return 0;
      }
      if (script.includes("if not claimed or")) {
        const claimed = strings.get(key);
        if (claimed === undefined || Number(claimed) === Number(args[0])) {
          strings.set(key, args[0]);
          strings.set(keys[1], args[0]);
          return 1;
        }
        return 0;
      }
      if (!script.includes("ZRANGEBYSCORE")) {
        throw new Error("unexpected script");
      }
      if (this.beforeRecoveryEval) {
        const hook = this.beforeRecoveryEval;
        this.beforeRecoveryEval = null;
        await hook();
      }
      const members = (sets.get(keys[1]) ?? [])
        .filter(
          (entry) => entry.score >= Number(args[0]) && entry.score <= Number(args[1]),
        )
        .map((entry) => entry.member);
      const metrics = observability.evaluateAiChatTurnWindow(members);
      if (
        metrics.errorRate > Number(args[2]) ||
        metrics.p95LatencyMs > Number(args[3])
      ) {
        return 0;
      }
      const claimed = strings.get(key);
      if (claimed !== undefined && Number(claimed) < Number(args[1])) {
        strings.delete(key);
        strings.delete(keys[2]);
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
    value(key) {
      return strings.get(key);
    },
  };
}

// One module instance for the whole file: jiti caches resolved modules, and
// the stubs below are mutable so each test can reset its own state.
const state = {
  redis: createFakeRedis(),
  comments: [],
  commentError: null,
  commitBeforeCommentError: false,
  task: { id: 38547, userId: 6 },
  taskError: null,
};

stubModule("src/lib/redis.ts", { getRedis: async () => state.redis });
stubModule("src/lib/prisma.ts", {
  default: {
    task: {
      findFirst: async () => {
        if (state.taskError) throw state.taskError;
        return state.task;
      },
    },
    comment: {
      findFirst: async ({ where }) =>
        state.comments.find(
          (comment) =>
            comment.taskId === where.taskId &&
            comment.creatorId === where.creatorId &&
            comment.text.includes(where.text.contains),
        ) ?? null,
    },
    user: { findUnique: async () => ({ displayName: "Valentin Yeo" }) },
  },
});
process.env.VERCEL_ENV = "production";
delete process.env.POSTHOG_SERVER_PROJECT_TOKEN;
delete process.env.POSTHOG_SERVER_HOST;
delete process.env.POSTHOG_SERVER_PROJECT_ID;
delete process.env.POSTHOG_UI_HOST;
stubModule("src/lib/flags.ts", {
  FEATURE_FLAG_OWNER_USER_ID: 6,
  FEATURE_FLAG_TICKET_PROJECT_ID: 15,
});
stubModule("src/utils/controllers/comments/createCommentService.ts", {
  createCommentService: async (params) => {
    if (state.commitBeforeCommentError) state.comments.push(params);
    if (state.commentError) throw state.commentError;
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
  state.commentError = null;
  state.commitBeforeCommentError = false;
  state.task = task;
  state.taskError = null;
}

const baseTurn = {
  userId: 6,
  model: "gpt-5.5",
  provider: "openai",
  traceId: "11111111-1111-4111-8111-111111111111",
  outcome: "ok",
  latencyMs: 1200,
};

test("the stream records routed and empty-reply terminal outcomes", () => {
  const stream = fs.readFileSync(
    path.join(root, "src/app/api/ai/chat/stream/route.ts"),
    "utf8",
  );
  assert.match(
    stream,
    /observedAgentId = routedAgent\.id;[\s\S]*?recordTurnOutcome\(\s*fleet\.success \? "ok" : "failed"/,
  );
  assert.match(
    stream,
    /emptyCompletionError \?\? "AI generation returned no visible reply"/,
  );
  assert.doesNotMatch(
    stream,
    /if \(finishReason === "error"\) recordTurnOutcome\("failed"\)/,
  );
  assert.match(
    stream,
    /if \(retryText\) \{\s*generationFinishedWithError = false;/,
  );
});

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

test("a recovery snapshot cannot delete a claim refreshed after it", async () => {
  reset();
  await observability.recordAiChatTurn(
    { ...baseTurn, outcome: "failed", latencyMs: 1000 },
    1,
  );
  assert.equal(state.comments.length, 1);
  // A newer breach must advance the claim even though it posts no second comment.
  await observability.recordAiChatTurn(
    { ...baseTurn, outcome: "failed", latencyMs: 1000 },
    1_000_000,
  );
  assert.equal(state.comments.length, 1);
  // This snapshot has aged past the first breach but precedes the second one.
  // It must not clear the claim refreshed by that concurrent newer breach.
  await observability.recordAiChatTurn({ ...baseTurn, outcome: "ok" }, 950_000);
  assert.equal(state.redis.has("ai:chat-turn-alert:production"), true);
});

test("atomic recovery keeps a claim when a delayed failure enters the window", async () => {
  reset();
  const redis = state.redis;
  await observability.recordAiChatTurn(
    { ...baseTurn, outcome: "failed" },
    1,
  );
  redis.beforeRecoveryEval = async () => {
    await redis.zadd(
      "ai:chat-turns:production",
      1_000_000,
      "delayed|1000|failed",
    );
  };
  await observability.recordAiChatTurn(baseTurn, 1_000_000);
  assert.equal(redis.has("ai:chat-turn-alert:production"), true);
});

test("an older breach cannot regress a newer claim timestamp", async () => {
  reset();
  const redis = state.redis;
  await observability.recordAiChatTurn(
    { ...baseTurn, outcome: "failed" },
    1,
  );
  await observability.recordAiChatTurn(
    { ...baseTurn, outcome: "failed" },
    1_000_000,
  );
  await observability.recordAiChatTurn(
    { ...baseTurn, outcome: "failed" },
    500_000,
  );
  assert.equal(redis.value("ai:chat-turn-alert:production"), "1000000");
});

test("a healthy snapshot cannot delete a claim from the same millisecond", async () => {
  reset();
  await state.redis.set(
    "ai:chat-turn-alert:production",
    "1000000",
    "EX",
    900,
    "NX",
  );
  await observability.recordAiChatTurn(baseTurn, 1_000_000);
  assert.equal(state.redis.has("ai:chat-turn-alert:production"), true);
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
  assert.equal(redis.has("ai:chat-turn-alert-delivered:production"), true);
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
  assert.equal(redis.has("ai:chat-turn-alert-delivered:production"), false);
  await observability.recordAiChatTurn(
    { ...baseTurn, outcome: "failed", latencyMs: 1000 },
    recovered + 1000,
  );
  assert.equal(state.comments.length, 2);
});

test("a missing alert ticket keeps only a bounded pending claim", async () => {
  reset(null);
  await observability.recordAiChatTurn(
    { ...baseTurn, outcome: "failed", latencyMs: 1000 },
    1_000_000,
  );
  assert.equal(state.comments.length, 0);
  assert.equal(state.redis.has("ai:chat-turn-alert:production"), true);
  assert.equal(
    state.redis.has("ai:chat-turn-alert-delivered:production"),
    false,
  );
});

test("a transient alert-ticket lookup failure releases the claim", async () => {
  reset();
  state.taskError = new Error("database unavailable");
  await observability.recordAiChatTurn(
    { ...baseTurn, outcome: "failed", latencyMs: 1000 },
    1_000_000,
  );
  assert.equal(state.comments.length, 0);
  assert.equal(state.redis.has("ai:chat-turn-alert:production"), false);
});

test("a latency-only breach says latency is the problem", async () => {
  reset();
  await observability.recordAiChatTurn(
    { ...baseTurn, latencyMs: 21_000 },
    1_000_000,
  );
  assert.match(state.comments[0].text, /slowest 5% took 21\.0s/);
  assert.doesNotMatch(state.comments[0].text, /0 of 1 turns failed/);
});

test("a failed alert comment releases the claim so the next turn retries", async () => {
  reset();
  state.commentError = new Error("comment unavailable");
  await observability.recordAiChatTurn(
    { ...baseTurn, outcome: "failed", latencyMs: 1000 },
    1_000_000,
  );
  assert.equal(state.comments.length, 0);
  assert.equal(state.redis.has("ai:chat-turn-alert:production"), false);
});

test("a prior incident cannot reconcile a failed current delivery", async () => {
  reset();
  state.comments.push({
    text: "<p><strong>AI Chat is unhealthy: old incident</strong></p><p>Incident: <code>old-incident</code></p>",
    creatorId: 6,
    taskId: 38547,
  });
  state.commentError = new Error("comment unavailable");
  await observability.recordAiChatTurn(
    { ...baseTurn, outcome: "failed", latencyMs: 1000 },
    1_000_000,
  );
  assert.equal(state.comments.length, 1);
  assert.equal(state.redis.has("ai:chat-turn-alert:production"), false);
});

test("a post-commit delivery error keeps the claim and avoids a duplicate", async () => {
  reset();
  state.commitBeforeCommentError = true;
  state.commentError = new Error("realtime unavailable after commit");
  await observability.recordAiChatTurn(
    { ...baseTurn, outcome: "failed", latencyMs: 1000 },
    Date.now(),
  );
  assert.equal(state.comments.length, 1);
  assert.equal(state.redis.has("ai:chat-turn-alert:production"), true);
});

test("recording survives a Redis failure without throwing", async () => {
  reset();
  state.redis.zadd = async () => {
    throw new Error("redis down");
  };
  const metrics = await observability.recordAiChatTurn(baseTurn, 1_000_000);
  assert.equal(metrics, null);
});
