const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const jitiModule = require("jiti");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const jiti = jitiModule.createJiti
  ? jitiModule.createJiti(__filename, {
      alias: { "@": path.join(root, "src") },
      interopDefault: true,
      moduleCache: false,
    })
  : jitiModule(__filename, {
      alias: { "@": path.join(root, "src") },
      interopDefault: true,
      cache: false,
    });

const {
  decideHeartbeatRecovery,
  heartbeatAllowanceNoticeId,
  heartbeatExecutionIds,
  heartbeatRecoveryAllowsNewClaim,
} = jiti(path.join(root, "src/app/api/ai/_lib/heartbeatExecution.ts"));
const { agentMessageMarker, decodeAgentMessage, encodeAgentMessage } = jiti(
  path.join(root, "src/lib/nativeAgent/agentMessageEnvelope.ts"),
);
const {
  decideDurableReservationRecovery,
  decodeHeartbeatTurnMessage,
  encodeHeartbeatTurnMessage,
  isNotificationInHeartbeatWindow,
  streamStoppedOnSpentAllowance,
} = jiti(path.join(root, "src/lib/nativeAgent/heartbeatTurnEnvelope.ts"));
const { aiAllowancePeriod, SHARED_AI_ALLOWANCE_EXCEEDED_MESSAGE } = jiti(
  path.join(root, "src/lib/aiAllowancePolicy.ts"),
);
const { deliverAgentMessageNotification } = jiti(
  path.join(
    root,
    "src/app/api/cron/native-agent-heartbeat/agentMessageDelivery.ts",
  ),
);

const baseRecovery = {
  mutationStarted: false,
  notificationDelivered: false,
  replyExists: false,
  stale: false,
};

test("recovery retries only executions proven to be pre-mutation", () => {
  assert.equal(
    decideHeartbeatRecovery({ ...baseRecovery, status: "reserved" }),
    "wait",
  );
  assert.equal(
    decideHeartbeatRecovery({
      ...baseRecovery,
      status: "reserved",
      stale: true,
    }),
    "restore",
  );
  assert.equal(
    decideHeartbeatRecovery({ ...baseRecovery, status: "failed" }),
    "restore",
  );
  assert.equal(
    decideHeartbeatRecovery({
      ...baseRecovery,
      status: "failed",
      mutationStarted: true,
    }),
    "block",
  );
  assert.equal(
    decideHeartbeatRecovery({ ...baseRecovery, status: "running" }),
    "wait",
  );
  assert.equal(
    decideHeartbeatRecovery({
      ...baseRecovery,
      status: "running",
      stale: true,
    }),
    "restore",
  );
  assert.equal(
    decideHeartbeatRecovery({
      ...baseRecovery,
      status: "running",
      stale: true,
      mutationStarted: true,
    }),
    "block",
  );
  assert.equal(
    decideHeartbeatRecovery({ ...baseRecovery, status: "uncertain" }),
    "block",
  );
  assert.equal(
    decideHeartbeatRecovery({
      ...baseRecovery,
      status: "failed",
      mutationStarted: true,
      replyExists: true,
    }),
    "deliver",
  );
  assert.equal(
    decideHeartbeatRecovery({
      ...baseRecovery,
      status: "needs_reconciliation",
    }),
    "block",
  );
});

test("terminal reconciliation releases the cursor for newer inbox work", () => {
  assert.equal(
    decideHeartbeatRecovery({
      ...baseRecovery,
      status: "needs_reconciliation",
      mutationStarted: true,
      notificationDelivered: true,
    }),
    "advance",
  );
  assert.equal(heartbeatRecoveryAllowsNewClaim("reconciled"), true);
  assert.equal(heartbeatRecoveryAllowsNewClaim("clear"), true);
  assert.equal(heartbeatRecoveryAllowsNewClaim("pending"), false);
  assert.equal(heartbeatRecoveryAllowsNewClaim("restored"), false);
  assert.equal(heartbeatRecoveryAllowsNewClaim("delivered"), false);
  assert.equal(
    decideHeartbeatRecovery({
      ...baseRecovery,
      status: "completed",
      replyExists: true,
      notificationDelivered: true,
    }),
    "advance",
  );
});

test("one agent claim deterministically reuses its execution and message ids", () => {
  const claimedAt = new Date("2026-08-11T10:00:00.000Z");
  const first = heartbeatExecutionIds("agent-1", claimedAt);
  const replay = heartbeatExecutionIds("agent-1", claimedAt);
  const next = heartbeatExecutionIds(
    "agent-1",
    new Date("2026-08-11T10:01:00.000Z"),
  );

  assert.deepEqual(first, replay);
  assert.notDeepEqual(first, next);
  for (const id of Object.values(first)) {
    assert.match(
      id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  }
});

test("a crash after cursor claim leaves a durable reservation that restores the item", () => {
  const metadata = {
    version: 1,
    executionId: "11111111-1111-5111-8111-111111111111",
    agentId: "agent-1",
    claimedAt: "2026-08-11T10:00:00.000Z",
    scanWatermark: "2026-08-11T10:00:00.000Z",
    previousHeartbeatAt: "2026-08-11T09:55:00.000Z",
  };
  const encoded = encodeHeartbeatTurnMessage("Check the inbox.", metadata);

  assert.deepEqual(decodeHeartbeatTurnMessage(encoded), {
    prompt: "Check the inbox.",
    metadata,
  });
  assert.equal(
    decideDurableReservationRecovery({ streamStarted: false, stale: false }),
    "wait",
  );
  assert.equal(
    decideDurableReservationRecovery({ streamStarted: false, stale: true }),
    "restore",
  );
  assert.equal(
    decideDurableReservationRecovery({ streamStarted: true, stale: true }),
    "reconcile",
  );
});

test("scan high-water includes each boundary item exactly once", () => {
  const previous = "2026-08-11T09:59:00.000Z";
  const watermark = "2026-08-11T10:00:00.000Z";
  const duringScan = "2026-08-11T10:00:00.001Z";

  assert.equal(
    isNotificationInHeartbeatWindow(previous, previous, watermark),
    false,
  );
  assert.equal(
    isNotificationInHeartbeatWindow(
      "2026-08-11T09:59:00.001Z",
      previous,
      watermark,
    ),
    true,
  );
  assert.equal(
    isNotificationInHeartbeatWindow(watermark, previous, watermark),
    true,
  );
  assert.equal(
    isNotificationInHeartbeatWindow(duringScan, previous, watermark),
    false,
  );
  assert.equal(
    isNotificationInHeartbeatWindow(
      duringScan,
      watermark,
      "2026-08-11T10:01:00.000Z",
    ),
    true,
  );
});

test("AgentMessage envelopes carry a durable outbox key without leaking into the UI", () => {
  const assistantMessageId = "11111111-1111-5111-8111-111111111111";
  const content = "<p>Finished the board sweep.</p>";
  const encoded = encodeAgentMessage(assistantMessageId, content);

  assert.ok(encoded.startsWith(agentMessageMarker(assistantMessageId)));
  assert.equal(decodeAgentMessage(encoded), content);
  assert.equal(decodeAgentMessage("Legacy reply"), "Legacy reply");
});

test("notification delivery is idempotent after an insert/acknowledgement crash", async () => {
  const assistantMessageId = "11111111-1111-5111-8111-111111111111";
  let storedMessage = null;
  let creates = 0;
  const db = {
    notification: {
      findFirst: async ({ where }) =>
        storedMessage?.startsWith(where.message.startsWith) ? { id: 9 } : null,
      create: async ({ data }) => {
        creates += 1;
        storedMessage = data.message;
        return { id: 9 };
      },
    },
    $transaction: async (callback) => callback(db),
  };
  const redis = {
    set: async () => "OK",
    eval: async () => 1,
  };
  const args = {
    db,
    assistantMessageId,
    userId: 6,
    agentId: "agent-1",
    content: "<p>Finished.</p>",
    redisClient: redis,
  };

  assert.equal(await deliverAgentMessageNotification(args), "created");
  // Simulates a retry after the process died before acknowledging delivery.
  assert.equal(await deliverAgentMessageNotification(args), "existing");
  assert.equal(creates, 1);
  assert.equal(decodeAgentMessage(storedMessage), "<p>Finished.</p>");
});

test("a spent team allowance notifies the owner once a month, not once a tick", async () => {
  // The cron retries this agent every tick until the allowance resets, so the
  // notice id must collapse every one of those attempts onto a single inbox
  // item, while still allowing a fresh notice next month.
  const august = heartbeatAllowanceNoticeId("agent-1", "2026-08");
  const september = heartbeatAllowanceNoticeId("agent-1", "2026-09");
  const otherAgent = heartbeatAllowanceNoticeId("agent-2", "2026-08");

  assert.equal(heartbeatAllowanceNoticeId("agent-1", "2026-08"), august);
  assert.notEqual(august, september);
  assert.notEqual(august, otherAgent);
  // decodeAgentMessage slices the marker at a fixed 36 characters, so a
  // non-UUID id would leak the raw envelope into the inbox row.
  assert.match(
    august,
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );

  let storedMessage = null;
  let creates = 0;
  const db = {
    notification: {
      findFirst: async ({ where }) =>
        storedMessage?.startsWith(where.message.startsWith) ? { id: 4 } : null,
      create: async ({ data }) => {
        creates += 1;
        storedMessage = data.message;
        return { id: 4 };
      },
    },
    $transaction: async (callback) => callback(db),
  };
  const args = {
    db,
    assistantMessageId: august,
    userId: 6,
    agentId: "agent-1",
    content: "<p>Paused: allowance spent.</p>",
    redisClient: { set: async () => "OK", eval: async () => 1 },
  };

  assert.equal(await deliverAgentMessageNotification(args), "created");
  assert.equal(await deliverAgentMessageNotification(args), "existing");
  assert.equal(creates, 1);
});

test("only a real allowance stop counts, not an agent quoting one", () => {
  const frame = (event, data) =>
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  // The engine's own period rides along, so the notice is deduplicated against
  // the month that actually rejected rather than any local clock.
  assert.deepEqual(
    streamStoppedOnSpentAllowance(
      frame("error", {
        content: SHARED_AI_ALLOWANCE_EXCEEDED_MESSAGE,
        allowancePeriod: "2026-09",
        toolsExecuted: false,
      }),
    ),
    { periodKey: "2026-09" },
  );
  // A stop streamed by a deployment without the field still registers, and the
  // caller falls back to its claim period.
  assert.deepEqual(
    streamStoppedOnSpentAllowance(
      frame("error", { content: SHARED_AI_ALLOWANCE_EXCEEDED_MESSAGE }),
    ),
    { periodKey: null },
  );

  // An inbox item can ask the agent to explain why it stopped, so the model can
  // stream this sentence verbatim as ordinary content. Treating that as a real
  // stop would forge a "your agent is paused" notice while it works fine.
  assert.equal(
    streamStoppedOnSpentAllowance(
      frame("content", { content: SHARED_AI_ALLOWANCE_EXCEEDED_MESSAGE }) +
        frame("done", { status: "complete" }),
    ),
    null,
  );

  // Content is JSON-escaped, so a model cannot forge the event line above it.
  assert.equal(
    streamStoppedOnSpentAllowance(
      frame("content", {
        content: `event: error\ndata: {"content":"${SHARED_AI_ALLOWANCE_EXCEEDED_MESSAGE}"}`,
      }),
    ),
    null,
  );

  // Any other failure is a normal retry, not an allowance stop.
  assert.equal(
    streamStoppedOnSpentAllowance(
      frame("error", { content: "Sorry, something went wrong." }),
    ),
    null,
  );
  assert.equal(streamStoppedOnSpentAllowance(""), null);
  assert.equal(
    streamStoppedOnSpentAllowance("event: error\ndata: not-json\n\n"),
    null,
  );
});

test("the allowance notice is keyed to the month that actually rejected", () => {
  // A turn can be claimed before UTC rollover and rejected after it. Keying the
  // notice off either local clock then picks the wrong month, which both
  // duplicates the notice and consumes an id the other month still needs. The
  // engine's own period is the only key that survives the boundary.
  const claimedAt = new Date("2026-08-31T23:59:59.000Z");
  assert.equal(aiAllowancePeriod(claimedAt).key, "2026-08");

  const rejectedIn = "2026-09";
  assert.equal(
    heartbeatAllowanceNoticeId("agent-1", rejectedIn),
    heartbeatAllowanceNoticeId("agent-1", rejectedIn),
  );
  assert.notEqual(
    heartbeatAllowanceNoticeId("agent-1", rejectedIn),
    heartbeatAllowanceNoticeId("agent-1", aiAllowancePeriod(claimedAt).key),
  );

  const heartbeat = read("src/app/api/cron/native-agent-heartbeat/route.ts");
  // The engine's period wins; the claim period is only the legacy fallback.
  assert.match(
    heartbeat,
    /allowanceStop\.periodKey \?\? aiAllowancePeriod\(claimedAt\)\.key/,
  );
  // A courtesy notice must never cost the turn: if delivery throws, the claim
  // restore below it still has to run.
  assert.match(heartbeat, /\)\.catch\(\(error\) => \{/);
  const noticeIndex = heartbeat.indexOf("streamStoppedOnSpentAllowance(streamBody)");
  const restoreIndex = heartbeat.indexOf("safe stream failure restored for retry");
  assert.ok(noticeIndex > 0 && restoreIndex > noticeIndex);
});

test("the allowance error carries the period it was rejected against", () => {
  const allowance = read("src/app/api/ai/_lib/sharedAllowance.ts");
  const stream = read("src/app/api/ai/chat/stream/route.ts");

  // Without this the cron has nothing authoritative to deduplicate on.
  assert.match(allowance, /new SharedAiAllowanceExceededError\(month\.key\)/);
  assert.match(allowance, /readonly periodKey: string;/);
  assert.match(stream, /allowancePeriod: periodKey/);
  // Both streamed error exits must carry it, or the stop that happens to take
  // the other path silently loses its period.
  assert.equal(
    (stream.match(/\.\.\.userFacingErrorDetails\(error\)/g) ?? []).length,
    2,
  );
});

test("agent chat turns bill the team under the agent's own name", () => {
  const stream = read("src/app/api/ai/chat/stream/route.ts");
  // The three spending paths of one chat turn are the main answer, its
  // empty-completion retry, and the thread-title call. Each must name the
  // acting agent, or the team is charged for work nobody can trace back.
  // The trailing comma keeps this to object properties on a spend call, so
  // the agent id passed to the BYOK key lookup is not miscounted as a spend.
  const attributed =
    stream.match(/agentId: actingAgent\?\.id \?\? null,/g) ?? [];
  assert.equal(
    attributed.length,
    3,
    "every AI spend on an agent session must record which agent spent it",
  );
  // The title call receives its attribution through usageContext, so the type
  // has to carry the field or the value is silently dropped.
  assert.match(read("src/app/api/ai/chat/stream/route.ts"), /agentId\?: string \| null;/);
});

test("heartbeat integration keeps timeout recovery, outbox delivery, and click routing safe", () => {
  const heartbeat = read("src/app/api/cron/native-agent-heartbeat/route.ts");
  const stream = read("src/app/api/ai/chat/stream/route.ts");
  const auth = read("src/app/api/ai/_lib/cronServiceAuth.ts");
  const agentInbox = read(
    "src/utils/controllers/notifications/getStructuredInboxForAgent.ts",
  );
  const inbox = read("src/components/notifications/inboxSplit/index.tsx");
  const row = read("src/components/notifications/NotificationRow.tsx");

  assert.match(heartbeat, /reserveHeartbeatExecution/);
  assert.match(heartbeat, /recoverPriorExecution/);
  assert.match(heartbeat, /deliverCompletedExecution/);
  assert.match(
    heartbeat,
    /stream timed out; awaiting durable result`[\s\S]*?\);\s*continue;/,
  );
  assert.match(heartbeat, /findDurableHeartbeatMessages/);
  assert.match(heartbeat, /durable execution record missing; turn not replayed/);
  assert.match(heartbeat, /deliverReconciliationNotice/);
  assert.match(heartbeat, /heartbeatRecoveryAllowsNewClaim\(recovery\)/);
  assert.match(
    heartbeat,
    /prisma\.\$transaction\([\s\S]*transaction\.chatMessage\.create[\s\S]*transaction\.agent\.updateMany/,
  );
  assert.match(heartbeat, /isDelivered: false/);
  assert.match(heartbeat, /SELECT CURRENT_TIMESTAMP AS "databaseNow"/);
  assert.match(heartbeat, /isNotificationInHeartbeatWindow/);
  assert.doesNotMatch(heartbeat, /randomUUID/);
  assert.match(
    stream,
    /await recordToolStart\?\.\(name\);[\s\S]*execute\(\.\.\.args\)/,
  );
  assert.match(stream, /markHeartbeatMutationStarted/);
  assert.match(stream, /completeHeartbeatExecution/);
  assert.match(stream, /boundedNotifications/);
  assert.match(stream, /heartbeatTurn\.scanWatermark/);
  assert.match(agentInbox, /createdAt:[\s\S]*gt: window\.after[\s\S]*lte: window\.through/);
  const durableStart = stream.indexOf("data: { isDelivered: true }");
  const modelStart = stream.indexOf("const result = streamText", durableStart);
  assert.ok(durableStart >= 0 && modelStart > durableStart);
  assert.match(auth, /verifyHeartbeatExecutionReservation/);

  const clickTarget = inbox.indexOf(
    "const clickTarget = notification ?? selectedInbox",
  );
  const invitation = inbox.indexOf('clickTarget.type === "Invited"');
  const agentMessage = inbox.indexOf('clickTarget.type === "AgentMessage"');
  assert.ok(clickTarget >= 0 && clickTarget < invitation);
  assert.ok(invitation < agentMessage);
  assert.match(row, /decodeAgentMessage\(notification\.message\)/);
});
