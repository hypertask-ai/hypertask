const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const covered = [
  "src/hooks/MultiPages/AIChat/aiChatSend.ts",
  "src/hooks/MultiPages/AIChat/useAiChatSessions.ts",
  "src/lib/aiChat/sessionMessageQueue.ts",
  "src/lib/aiChat/queuedMessageOrder.ts",
  "src/app/api/mcp/chat/pending/route.ts",
  "verification/formal/checks.json",
  "verification/formal/chat-send-queue/ChatSendQueue.tla",
  "verification/formal/chat-send-queue/ChatSendQueue.cfg",
  "verification/formal/chat-send-queue/Bug7785.cfg",
  "verification/formal/chat-send-queue/Bug7767.cfg",
  "verification/formal/chat-send-queue/Bug7794.cfg",
  "verification/formal/chat-send-queue/Bug9111.cfg",
  "verification/formal/chat-send-queue/repro.cjs",
  ".claude/skills/formal-verification/SKILL.md",
];

test("the chat send queue model covers the files its record names", () => {
  for (const file of covered) {
    assert.ok(existsSync(path.join(root, file)), `${file} is named in the record and missing`);
  }
});

test("every recorded bug variant still expects the property it broke to fail", () => {
  const manifest = require(path.join(root, "verification/formal/checks.json"));
  assert.ok(manifest.checks["chat-send-queue"].properties.every((property) => property.expect === "holds"));
  for (const variant of ["7785", "7767", "7794", "9111"]) {
    const properties = manifest.checks[`chat-send-queue-${variant}`].properties;
    assert.ok(properties.some((property) => property.expect === "violated"), `chat-send-queue-${variant} lost its violation`);
  }
});

test("the current queue model holds and every past bug variant breaks it", () => {
  const checked = spawnSync(
    process.execPath,
    ["scripts/formal-verification/run.mjs", "chat-send-queue", "chat-send-queue-7785", "chat-send-queue-7767", "chat-send-queue-7794", "chat-send-queue-9111"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(checked.status, 0, `${checked.stdout}\n${checked.stderr}`);
  assert.match(
    checked.stdout,
    /formal-verification: ok chat-send-queue matches its record .*NoQueuedMessageLost holds, FailedSendKeepsQueued holds, ChatSwitchKeepsQueue holds, QueueOrderKept holds, StoppedReleasesSend holds, StoppedStreamCloses holds, ReplyEndReleasesSend holds, AcquisitionBounded holds, AcquisitionNotReplayed holds/,
  );
  assert.match(
    checked.stdout,
    /formal-verification: ok chat-send-queue-7785 matches its record .*FailedSendKeepsQueued violated \(recorded finding\), QueueOrderKept violated \(recorded finding\)/,
  );
  assert.match(
    checked.stdout,
    /formal-verification: ok chat-send-queue-7767 matches its record .*ChatSwitchKeepsQueue violated \(recorded finding\)/,
  );
  assert.match(
    checked.stdout,
    /formal-verification: ok chat-send-queue-7794 matches its record .*StoppedReleasesSend violated \(recorded finding\), StoppedStreamCloses violated \(recorded finding\)/,
  );
  assert.match(
    checked.stdout,
    /formal-verification: ok chat-send-queue-9111 matches its record .*AcquisitionBounded violated \(recorded finding\)/,
  );
});
