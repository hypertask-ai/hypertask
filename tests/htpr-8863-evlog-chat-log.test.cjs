const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const load = createJiti(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });
const flagDefinition = load(path.join(root, "src/lib/flags/definitions/htpr-8863-evlog-chat-log.ts"));
const requestLog = load(path.join(root, "src/lib/ai/chatStream/requestLogEvent.ts"));

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

test("the logging trial ships behind its own flag, on for everyone so a day can be measured", () => {
  assert.equal(flagDefinition.HTPR_8863_EVLOG_CHAT_LOG_FLAG, "htpr-8863-evlog-chat-log");
  assert.equal(flagDefinition.default.key, "htpr-8863-evlog-chat-log");
  assert.equal(flagDefinition.default.defaultMode, "EVERYONE");
  assert.equal(flagDefinition.default.releaseRisk.risk, "small");
  assert.ok(flagDefinition.default.releaseRisk.reason.length > 20);
});

test("a successful turn becomes one event with the request story and no error", () => {
  const event = requestLog.buildAiChatRequestEvent(turn);
  assert.equal(event.outcome, "ok");
  assert.equal(event.requestId, turn.requestId);
  assert.equal(event.durationMs, 1234);
  assert.equal(event.path, "/api/ai/chat/stream");
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

test("a turn with no project, ticket or agent leaves those keys out", () => {
  const event = requestLog.buildAiChatRequestEvent({
    ...turn,
    projectId: null,
    taskId: null,
  });
  assert.equal(Object.hasOwn(event, "project"), false);
  assert.equal(Object.hasOwn(event, "ticket"), false);
  assert.equal(Object.hasOwn(event, "agent"), false);
});

test("a cancelled turn is a plain event, not an error", () => {
  const event = requestLog.buildAiChatRequestEvent({
    ...turn,
    outcome: "cancelled",
    error: undefined,
  });
  assert.equal(event.outcome, "cancelled");
  assert.equal(event.error, undefined);
});

test("a failed turn carries the reason and the next step", () => {
  const event = requestLog.buildAiChatRequestEvent({
    ...turn,
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
  assert.match(story.message, /401 Unauthorized/);
});

test("a refused team key and a dead database each get their own next step", () => {
  const forced = new Error("Team key forced");
  forced.name = "ForcedTeamKeyError";
  assert.match(requestLog.aiChatFailureStory(forced).fix, /team AI key/);

  const prisma = new Error("Connection pool exhausted");
  prisma.name = "PrismaClientKnownRequestError";
  const prismaStory = requestLog.aiChatFailureStory(prisma);
  assert.match(prismaStory.why, /database call/);
  assert.match(prismaStory.fix, /database health/);
});

test("an allowance failure names the allowance as the cause", () => {
  const allowance = new Error("Included AI allowance used up for this month.");
  allowance.name = "SharedAiAllowanceExceededError";
  allowance.periodKey = "2026-11";
  const story = requestLog.aiChatFailureStory(allowance, "anthropic");
  assert.match(story.why, /included AI allowance/);
  assert.match(story.fix, /Raise the team AI allowance/);
});

test("an empty failure still says what to do next", () => {
  const story = requestLog.aiChatFailureStory(undefined);
  assert.ok(story.message.length > 0);
  assert.ok(story.why.length > 0);
  assert.ok(story.fix.length > 0);
});

test("a bare key with no header around it is redacted too", () => {
  const story = requestLog.aiChatFailureStory(
    new Error("custom endpoint replied 401 for key sk-live-9f8e7d6c5b4a7c3d1e2f"),
  );
  assert.equal(story.message.includes("sk-live-9f8e7d6c5b4a7c3d1e2f"), false);
  assert.match(story.message, /\[redacted\]/);
  const longOpaque = requestLog.aiChatFailureStory(
    new Error("token Zj8kQ2mNp0rS4tU6vW8xY1zA3bC5dE7fG9hJ declined"),
  );
  assert.equal(longOpaque.message.includes("Zj8kQ2mNp0rS4tU6vW8xY1zA3bC5dE7fG9hJ"), false);
  assert.match(longOpaque.message, /declined/);
});

test("the line never carries keys, emails or prompt text, and stays on one line", () => {
  const event = requestLog.buildAiChatRequestEvent({
    ...turn,
    outcome: "failed",
    error: new Error(
      "request to https://api.openai.com/v1/chat failed: Authorization: Bearer sk-live-9f8e7d6c5b4a owner@example.com",
    ),
  });
  const line = JSON.stringify(event);
  assert.equal(line.includes("sk-live-9f8e7d6c5b4a"), false);
  assert.equal(line.includes("owner@example.com"), false);
  assert.equal(line.includes("Bearer sk-live"), false);
  assert.equal(line.includes("\n"), false);
  assert.equal(Object.hasOwn(event, "message"), false);
  assert.equal(Object.hasOwn(event, "prompt"), false);
  assert.match(event.error.message, /\/v1\/chat/);
});
