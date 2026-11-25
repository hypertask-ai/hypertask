const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const covered = [
  "src/hooks/MultiPages/AIChat/aiChatSend.ts",
  "src/hooks/MultiPages/AIChat/useAiChatAttachments.ts",
  "src/hooks/MultiPages/AIChat/useAiChatSessions.ts",
  "src/lib/aiChat/sessionMessageQueue.ts",
  "src/lib/aiChat/queuedMessageOrder.ts",
  "src/app/api/ai-chat/add-message/route.ts",
  "src/app/api/mcp/chat/pending/route.ts",
  "verification/formal/checks.json",
  "verification/formal/chat-send-queue/ChatSendQueue.tla",
  "verification/formal/chat-send-queue/ChatSendQueue.cfg",
  "verification/formal/chat-send-queue/BugLookupRace.cfg",
  "verification/formal/chat-send-queue/Bug7785.cfg",
  "tests/htpr-9617-chat-order-postgres.test.cjs",
  "verification/formal/chat-send-queue/Bug7767.cfg",
  "verification/formal/chat-send-queue/Bug7794.cfg",
  "verification/formal/chat-send-queue/Bug9111.cfg",
  "verification/formal/chat-send-queue/Bug9111Replay.cfg",
  "verification/formal/chat-send-queue/repro.cjs",
  ".claude/skills/formal-verification/SKILL.md",
];

const variants = ["lookup-race", "7785", "7767", "7794", "9111", "9111-replay"];

test("the chat send queue model covers the files its record names", () => {
  for (const file of covered) {
    assert.ok(existsSync(path.join(root, file)), `${file} is named in the record and missing`);
  }
});

test("every recorded bug variant still expects the property it broke to fail", () => {
  const manifest = require(path.join(root, "verification/formal/checks.json"));
  const properties = manifest.checks["chat-send-queue"].properties;
  assert.ok(properties.every((property) => property.expect === "holds"));
  for (const variant of variants) {
    const properties = manifest.checks[`chat-send-queue-${variant}`].properties;
    assert.ok(properties.some((property) => property.expect === "violated"), `chat-send-queue-${variant} lost its violation`);
  }
});

test("the fixed queue model passes and every bug replay still breaks its recorded property", () => {
  const checked = spawnSync(
    process.execPath,
    ["scripts/formal-verification/run.mjs", "chat-send-queue", ...variants.map((variant) => `chat-send-queue-${variant}`)],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(checked.status, 0, `${checked.stdout}\n${checked.stderr}`);
  assert.match(
    checked.stdout,
    /formal-verification: ok chat-send-queue matches its record .*MessageConserved holds, DoneNotQueued holds, FailedSendKeepsQueued holds, ChatSwitchKeepsQueue holds, QueueOrderKept holds, QueuedStoredBeforeReply holds, StoppedReleasesSend holds, StoppedStreamCloses holds, ReplyEndReleasesSend holds, AcquisitionWindowKept holds, AcquisitionRetried holds, AcquisitionAttemptsBounded holds, AcquisitionNotReplayed holds/,
  );
  assert.match(
    checked.stdout,
    /formal-verification: ok chat-send-queue-lookup-race matches its record .*QueuedStoredBeforeReply violated \(recorded finding\)/,
  );
  assert.match(
    checked.stdout,
    /formal-verification: ok chat-send-queue-7785 matches its record .*QueuedStoredBeforeReply violated \(recorded finding\)/,
  );
  assert.match(
    checked.stdout,
    /formal-verification: ok chat-send-queue-7767 matches its record .*MessageConserved violated \(recorded finding\), ChatSwitchKeepsQueue violated \(recorded finding\), FailedSendKeepsQueued violated \(recorded finding\), QueueOrderKept violated \(recorded finding\)/,
  );
  assert.match(
    checked.stdout,
    /formal-verification: ok chat-send-queue-7794 matches its record .*StoppedReleasesSend violated \(recorded finding\), StoppedStreamCloses violated \(recorded finding\)/,
  );
  assert.match(
    checked.stdout,
    /formal-verification: ok chat-send-queue-9111 matches its record .*AcquisitionWindowKept violated \(recorded finding\), AcquisitionRetried violated \(recorded finding\)/,
  );
  assert.match(
    checked.stdout,
    /formal-verification: ok chat-send-queue-9111-replay matches its record .*AcquisitionNotReplayed violated \(recorded finding\)/,
  );
});

test("the repro drives the real queue through the recorded traces", () => {
  const repro = spawnSync(process.execPath, ["verification/formal/chat-send-queue/repro.cjs"], { cwd: root, encoding: "utf8" });
  assert.equal(repro.status, 0, `${repro.stdout}\n${repro.stderr}`);
  assert.match(repro.stdout, /"afterFailure": \[\s*"one",\s*"two"\s*\]/);
  assert.match(repro.stdout, /"preFixBefore": false/);
  const race = JSON.parse(repro.stdout).lookupInsertBugReplay;
  assert.equal(race.lookupMissed, true);
  assert.equal(race.before, false);
  assert.ok(new Date(race.queuedCreatedAt) > new Date(race.replyCreatedAt));
});
