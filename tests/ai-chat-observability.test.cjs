const assert = require("node:assert/strict");
const fs = require("./helpers/chat-stream-source.cjs");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
delete process.env.POSTHOG_SERVER_PROJECT_TOKEN;
delete process.env.POSTHOG_SERVER_HOST;
delete process.env.POSTHOG_SERVER_PROJECT_ID;
delete process.env.POSTHOG_UI_HOST;

const jiti = createJiti(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const observability = jiti(
  path.join(root, "src/lib/telemetry/aiChatObservability.ts"),
);

const baseTurn = {
  userId: 6,
  model: "gpt-5.5",
  provider: "openai",
  traceId: "11111111-1111-4111-8111-111111111111",
  outcome: "ok",
  latencyMs: 4000,
  inputTokens: 11,
  outputTokens: 7,
};

test("the stream records routed and terminal turn outcomes", () => {
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
  assert.match(
    stream,
    /let observedModel = selected\.resolvedModelId/,
  );
  assert.match(
    stream,
    /onFinish: async \(\{ usage, finishReason \}\)[\s\S]*?generationFinishedWithError = finishReason === "error";[\s\S]*?else if \(generationFinishedWithError\) \{\s*recordTurnOutcome\("failed"/,
  );
  assert.match(stream, /waitUntil\(observation\)/);
});

test("the generation event contains tracking fields but no chat bodies", () => {
  const capture = observability.buildAiChatTurnCapture(baseTurn, "production");

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
  assert.deepEqual(
    Object.keys(capture.properties).filter(
      (key) => key === "$ai_input" || key === "$ai_output_choices",
    ),
    [],
  );
});

test("generation events carry team allowance properties", () => {
  const capture = observability.buildAiChatTurnCapture(
    { ...baseTurn, teamId: "team_1", teamAllowanceUsd: 40, teamAllowanceUsedUsd: 12.5 },
    "production",
  );
  assert.equal(capture.properties.ht_team_id, "team_1");
  assert.equal(capture.properties.ht_team_ai_allowance_usd, 40);
  assert.equal(capture.properties.ht_team_ai_used_usd, 12.5);
});

test("generation events default missing team allowance properties to null", () => {
  const capture = observability.buildAiChatTurnCapture(baseTurn, "production");
  assert.equal(capture.properties.ht_team_id, null);
  assert.equal(capture.properties.ht_team_ai_allowance_usd, null);
  assert.equal(capture.properties.ht_team_ai_used_usd, null);
});

test("usage tracing passes the team allowance snapshot into generation capture", () => {
  const source = fs.readFileSync(
    path.join(root, "src/app/api/ai/_lib/modelProvider.ts"),
    "utf8",
  );
  assert.match(source, /const observation = \(async \(\) => \{[\s\S]*?teamAllowanceSnapshot\(row\.teamId\)/);
  assert.match(source, /recordAiChatTurn\(\{[\s\S]*?teamId: row\.teamId,[\s\S]*?teamAllowanceUsd: allowanceSnapshot\?\.allowanceUsd \?\? null,[\s\S]*?teamAllowanceUsedUsd: allowanceSnapshot\?\.usedUsd \?\? null/);
});

test("failed and cancelled turns carry the correct outcomes", () => {
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
  assert.equal(cancelled.properties.ht_outcome, "cancelled");
  assert.equal("$ai_error" in cancelled.properties, false);
});

test("failed turn errors are redacted before capture", () => {
  const redacted = observability.redactAiCaptureProperties({
    $ai_model: "gpt-5.5",
    $ai_error: JSON.stringify({
      message: "Upstream refused: Authorization: Bearer sk-live-abc123",
      stack: "Error: at fetch (https://api.openai.com/v1?key=sk-live-abc123)",
    }),
  });

  assert.ok(!redacted.$ai_error.includes("sk-live-abc123"));
  assert.match(redacted.$ai_error, /redacted/);
  assert.equal(redacted.$ai_model, "gpt-5.5");
});

test("the release contains no automatic Manager alert machinery", () => {
  const source = fs.readFileSync(
    path.join(root, "src/lib/telemetry/aiChatObservability.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /getRedis|createCommentService|AI Chat is unhealthy/);
  assert.doesNotMatch(source, /CLAIM_ALERT|RECOVER_CLAIM|TURN_WINDOW/);
});
