const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const load = createJiti(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });
const flagDefinition = load(path.join(root, "src/lib/flags/definitions/htpr-8863-evlog-chat-log.ts"));
const requestLog = load(path.join(root, "src/lib/ai/chatStream/requestLogEvent.ts"));

const input = {
  requestId: "6f1c2a9e-0000-4000-8000-000000000000",
  userId: 42,
  projectId: 15,
  taskId: 8863,
  agentId: null,
  model: "claude-haiku-4-5",
  provider: "anthropic",
  outcome: "ok",
  durationMs: 1234,
  inputTokens: 900,
  outputTokens: 120,
};

test("one evlog line per AI chat turn ships behind its own flag", () => {
  assert.equal(flagDefinition.HTPR_8863_EVLOG_CHAT_LOG_FLAG, "htpr-8863-evlog-chat-log");
  assert.equal(flagDefinition.default.key, "htpr-8863-evlog-chat-log");
  assert.equal(flagDefinition.default.defaultMode, "EVERYONE");
  assert.equal(flagDefinition.default.releaseRisk.risk, "small");
  assert.ok(flagDefinition.default.releaseRisk.reason.length > 20);
});

test("a successful turn is one event with the request story and no error", () => {
  const event = requestLog.buildAiChatRequestEvent(input);
  assert.equal(event.outcome, "ok");
  assert.equal(event.requestId, input.requestId);
  assert.equal(event.durationMs, 1234);
  assert.deepEqual(event.ai, {
    model: "claude-haiku-4-5",
    provider: "anthropic",
    inputTokens: 900,
    outputTokens: 120,
  });
  assert.deepEqual(event.user, { id: 42 });
  assert.deepEqual(event.project, { id: 15 });
  assert.deepEqual(event.ticket, { id: 8863 });
  assert.equal(event.error, undefined);
  assert.equal(event.agent, undefined);
});

test("a failed turn carries the reason and the next step", () => {
  const event = requestLog.buildAiChatRequestEvent({
    ...input,
    outcome: "failed",
    error: new Error("The turn ran past its deadline"),
  });
  assert.equal(event.outcome, "failed");
  assert.equal(event.error.name, "Error");
  assert.match(event.error.why, /time limit/);
  assert.match(event.error.fix, /smaller question/);
});

test("a provider key rejection tells the reader where to fix the key", () => {
  const rejected = new Error("401 Unauthorized");
  rejected.name = "AiProviderAuthenticationError";
  const story = requestLog.aiChatFailureStory(rejected, "byok:openai");
  assert.match(story.why, /rejected the key/);
  assert.match(story.fix, /bring your own key/);
});

test("an allowance failure names the allowance as the cause", () => {
  const allowance = new Error("Included AI allowance used up for this month.");
  allowance.name = "SharedAiAllowanceExceededError";
  allowance.periodKey = "2026-11";
  const story = requestLog.aiChatFailureStory(allowance, "anthropic");
  assert.match(story.why, /included AI allowance/);
  assert.match(story.fix, /Raise the team AI allowance/);
});

test("the log line never carries keys, emails or prompt text", () => {
  const event = requestLog.buildAiChatRequestEvent({
    ...input,
    outcome: "failed",
    error: new Error(
      "request to https://api.openai.com/v1/chat failed: Authorization: Bearer sk-live-9f8e7d6c5b4a owner@example.com",
    ),
  });
  const line = JSON.stringify(event);
  assert.equal(line.includes("sk-live-9f8e7d6c5b4a"), false);
  assert.equal(line.includes("owner@example.com"), false);
  assert.equal(line.includes("Bearer sk-live"), false);
  assert.equal(line.includes("sk-live"), false);
  assert.equal(Object.hasOwn(event, "message"), false);
  assert.equal(Object.hasOwn(event, "prompt"), false);
  assert.equal(line.includes("\n"), false);
});

test("the chat stream writes one request log per turn and drops the scattered error lines", () => {
  const source = fs.readFileSync(path.join(root, "src/lib/ai/chatStream/runStream.ts"), "utf8");
  assert.equal(source.split("writeAiChatRequestLog({").length - 1, 1);
  assert.match(source, /isFeatureEnabled\(\s*HTPR_8863_EVLOG_CHAT_LOG_FLAG,\s*dbUser\.id,?\s*\)/);
  assert.match(source, /if \(!state\.requestLogEnabled && !includedAllowanceError/);
  assert.match(source, /userFacingErrorMessage\(error, "stream-handler", nameOwnKey \? ownKeyProvider : undefined, state\.requestLogEnabled\)/);
  const errors = fs.readFileSync(path.join(root, "src/lib/ai/chatStream/errors.ts"), "utf8");
  assert.match(errors, /quiet = false,/);
  assert.match(errors, /if \(!quiet\) console\.error\(`\[ai\/chat\/stream\] \$\{stage\} user-facing error`/);
  const emitter = fs.readFileSync(path.join(root, "src/lib/ai/chatStream/requestLog.ts"), "utf8");
  assert.match(emitter, /createLogger\(/);
  assert.match(emitter, /log\.emit\(/);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.match(pkg.dependencies.evlog, /^\^2\./);
});
