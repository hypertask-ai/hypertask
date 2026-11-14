const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const load = createJiti(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });
const flagDefinition = load(path.join(root, "src/lib/flags/definitions/htpr-8863-evlog-chat-log.ts"));
const requestLog = load(path.join(root, "src/lib/ai/chatStream/requestLogEvent.ts"));
const errors = load(path.join(root, "src/lib/ai/chatStream/errors.ts"));
const writer = load(path.join(root, "src/lib/ai/chatStream/requestLog.ts"));

const turn = {
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

function named(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

test("the trial flag is on for everyone and evlog stays outside the compiler", () => {
  assert.equal(flagDefinition.default.key, "htpr-8863-evlog-chat-log");
  assert.equal(flagDefinition.default.kind, "improvement");
  assert.equal(flagDefinition.default.defaultMode, "EVERYONE");
  const source = fs.readFileSync(path.join(root, "next.config.js"), "utf8");
  const match = source.match(/serverExternalPackages:\s*\[([\s\S]*?)\]/);
  const names = [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
  assert.deepEqual(names, [
    "isomorphic-dompurify", "jsdom", "pusher", "aws-sdk",
    "stripe", "posthog-node", "@modelcontextprotocol/sdk", "mcp-handler",
    "evlog",
  ]);
});

test("a successful turn is one event and a failure names the next step", () => {
  const ok = requestLog.buildAiChatRequestEvent(turn);
  assert.equal(ok.outcome, "ok");
  assert.equal(ok.path, "/api/ai/chat/stream");
  assert.deepEqual(ok.ai, {
    model: "claude-haiku-4-5",
    provider: "anthropic",
    inputTokens: 900,
    outputTokens: 120,
  });
  assert.equal(ok.error, undefined);
  const bare = requestLog.buildAiChatRequestEvent({ ...turn, projectId: null, taskId: null, outcome: "cancelled" });
  assert.equal(bare.outcome, "cancelled");
  assert.equal(Object.hasOwn(bare, "project"), false);
  assert.equal(Object.hasOwn(bare, "error"), false);
  const cases = [
    [new Error("The turn ran past its deadline"), /time limit/, /smaller question/],
    [named("AiProviderAuthenticationError", "401 Unauthorized"), /rejected the key/, /bring your own key/],
    [named("ForcedTeamKeyError", "Team key forced"), /shared key/, /team AI key/],
    [named("PrismaClientKnownRequestError", "Connection pool exhausted"), /database call/, /database health/],
    [named("SharedAiAllowanceExceededError", "Included AI allowance used up."), /included AI allowance/, /Raise the team AI allowance/],
    [undefined, /stopped unexpectedly/, /Ask again/],
  ];
  for (const [error, why, fix] of cases) {
    const story = requestLog.aiChatFailureStory(error, "byok:openai");
    assert.match(story.why, why);
    assert.match(story.fix, fix);
    assert.ok(story.message.length > 0);
  }
});

test("the line drops keys and emails, carries no prompt field, and stays quiet only when the trial is on", () => {
  const event = requestLog.buildAiChatRequestEvent({
    ...turn,
    outcome: "failed",
    error: new Error("Bearer sk-live-9f8e7d6c5b4a owner@example.com key sk-live-9f8e7d6c5b4a7c3d1e2f token Zj8kQ2mNp0rS4tU6vW8xY1zA3bC5dE7fG9hJ"),
  });
  const line = JSON.stringify(event);
  for (const hidden of ["sk-live-9f8e7d6c5b4a", "owner@example.com", "Zj8kQ2mNp0rS4tU6vW8xY1zA3bC5dE7fG9hJ"]) {
    assert.equal(line.includes(hidden), false, hidden);
  }
  assert.equal(line.includes("\n"), false);
  assert.equal(Object.hasOwn(event, "prompt"), false);
  assert.equal(Object.hasOwn(event, "message"), false);
  assert.match(event.error.why, /.+/);
  assert.match(event.error.fix, /.+/);
  const failure = new Error("Anthropic overloaded_error");
  const calls = [];
  const original = console.error;
  console.error = (...args) => calls.push(args);
  try {
    assert.equal(errors.userFacingErrorMessage(failure, "model-stream").includes("try again"), true);
    assert.equal(calls.length, 1);
    calls.length = 0;
    const quiet = errors.userFacingErrorMessage(failure, "model-stream", undefined, true);
    assert.equal(quiet, "Sorry, something went wrong while generating a response. Please try again.");
    assert.equal(calls.length, 0);
  } finally {
    console.error = original;
  }
});

test("provider errors cannot copy private text into any logged error field", () => {
  const privateText = "Private acquisition plans for the Northwind deal";
  for (const error of [new Error(privateText), privateText, named(privateText, privateText), named(`Prisma${privateText}`, privateText), named("TimeoutError", `timeout: ${privateText}`)]) {
    const event = requestLog.buildAiChatRequestEvent({ ...turn, outcome: "failed", error });
    assert.equal(JSON.stringify(event).includes(privateText), false);
    assert.match(event.error.why, /.+/);
    assert.match(event.error.fix, /.+/);
  }
});

test("evlog writes one JSON line and keeps the token counts", async () => {
  const calls = [];
  const original = { error: console.error, warn: console.warn, info: console.info, log: console.log };
  for (const level of Object.keys(original)) console[level] = (...args) => calls.push(args);
  try {
    await writer.writeAiChatRequestLog({
      ...turn,
      outcome: "failed",
      error: new Error("Authorization: Bearer sk-live-9f8e7d6c5b4a owner@example.com"),
    });
  } finally {
    Object.assign(console, original);
  }
  const lines = calls.map((args) => args.filter((arg) => typeof arg === "string").join("")).filter((line) => line.includes("ai_chat_request"));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].includes("\n"), false);
  const event = JSON.parse(lines[0]);
  assert.equal(event.event, "ai_chat_request");
  assert.equal(event.level, "error");
  assert.equal(event.ai.inputTokens, 900);
  assert.equal(event.ai.outputTokens, 120);
  assert.match(event.error.why, /.+/);
  assert.match(event.error.fix, /.+/);
  assert.equal(JSON.stringify(event).includes("sk-live-9f8e7d6c5b4a"), false);
  assert.equal(JSON.stringify(event).includes("owner@example.com"), false);
});
