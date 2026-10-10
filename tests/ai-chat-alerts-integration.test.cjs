const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { test } = require("node:test");
const { createJiti } = require("jiti");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const jiti = createJiti(__filename, { interopDefault: true });
const policy = jiti(path.join(root, "src/lib/ai/chatAlerts/policy.ts"));

function load(file, modules, environment = "production") {
  const loadedModule = { exports: {} };
  const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, {
    module: loadedModule, exports: loadedModule.exports,
    require: (name) => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected runtime dependency: ${name}`);
      return modules[name];
    },
    process: { env: { VERCEL_ENV: environment } },
    console: { warn: () => {} },
  }, { filename: file });
  return loadedModule.exports;
}

function serviceHarness({ enabled = true, environment = "production", deliveryError = false, processingError = false, flagError = false } = {}) {
  const calls = { flags: [], samples: [], deliveries: [], finishes: [], reports: [] };
  let next = { id: "incident:breach", incidentId: "incident", attemptCount: 1, phase: "breach" };
  const service = load("src/lib/ai/chatAlerts/service.ts", {
    "@/lib/prisma": {},
    "@/lib/flags": {
      FEATURE_FLAG_OWNER_USER_ID: 6,
      isFeatureEnabled: async (...args) => { calls.flags.push(args); if (flagError) throw new Error("private prompt"); return enabled; },
    },
    "@/lib/flags/keys": { HTPR_6354_AI_CHAT_ALERTS_FLAG: "htpr-6354-ai-chat-alerts" },
    "@/lib/errors/reportError": { reportError: async (report) => calls.reports.push(report) },
    "./manager": { deliverManagerAlert: async (_, delivery) => { calls.deliveries.push(delivery); if (deliveryError) throw new Error("private reply"); } },
    "./store": {
      evaluateAlerts: async (_, env, sample) => { calls.samples.push({ environment: env, sample }); if (processingError) throw new Error("secret content"); },
      claimDelivery: async () => { const value = next; next = undefined; return value; },
      finishDelivery: async (_, delivery, success) => calls.finishes.push({ delivery, success }),
    },
  }, environment);
  return { service, calls };
}

test("server flag is checked before storing samples or delivering alerts", async () => {
  const { service, calls } = serviceHarness({ enabled: false });
  await service.recordAiChatAlertSample({ userId: 2343, outcome: "failed", latencyMs: 30000 });
  await service.sweepAiChatAlerts();
  assert.equal(calls.flags.length, 2);
  assert.deepEqual(Array.from(calls.flags[0]), ["htpr-6354-ai-chat-alerts", 2343]);
  assert.equal(calls.flags[1][1], 6);
  assert.equal(calls.samples.length, 0);
  assert.equal(calls.deliveries.length, 0);
  const flags = (read("src/lib/flags.ts") + read("src/lib/flags/definitions.ts"));
  assert.match(flags, /key: HTPR_6354_AI_CHAT_ALERTS_FLAG,/);
  assert.match(flags, /DEFAULT_FEATURE_FLAG_MODE: FeatureFlagMode = "OWNER_AND_QA"/);
  assert.match(read("src/lib/flags/keys.ts"), /HTPR_6354_AI_CHAT_ALERTS_FLAG = "htpr-6354-ai-chat-alerts"/);
});

test("alert samples strictly allow only durations and outcome status codes", async () => {
  const { service, calls } = serviceHarness();
  await service.recordAiChatAlertSample({ userId: 985, outcome: "failed", latencyMs: 25000.2, prompt: "private prompt", reply: "private reply", error: "sensitive error" });
  assert.equal(calls.samples[0].environment, "production");
  assert.deepEqual(Object.keys(calls.samples[0].sample).sort(), ["latencyMs", "statusCode"]);
  assert.equal(calls.samples[0].sample.latencyMs, 25000);
  assert.equal(calls.samples[0].sample.statusCode, 500);
  await service.recordAiChatAlertSample({ userId: 985, outcome: "cancelled", latencyMs: 50 });
  assert.equal(calls.samples[1].sample.statusCode, 0);
  assert.equal(JSON.stringify(calls).includes("private prompt"), false);
  assert.equal(JSON.stringify(calls).includes("private reply"), false);
});

test("delivery failures are handled reports and never escape the background observer", async () => {
  const { service, calls } = serviceHarness({ deliveryError: true });
  await assert.doesNotReject(service.recordAiChatAlertSample({ userId: 6, outcome: "ok", latencyMs: 1000 }));
  assert.equal(calls.finishes[0].success, false);
  assert.equal(calls.reports[0].source, "handled");
  assert.equal(calls.reports[0].extra.attemptCount, 1);
  assert.equal(JSON.stringify(calls.reports).includes("private reply"), false);
});

test("DB and flag failures are absorbed and reported without exception bodies", async () => {
  for (const options of [{ processingError: true }, { flagError: true }]) {
    const { service, calls } = serviceHarness(options);
    await assert.doesNotReject(service.recordAiChatAlertSample({ userId: 6, outcome: "ok", latencyMs: 1000 }));
    assert.equal(calls.reports.length, 1);
    assert.equal(calls.reports[0].source, "handled");
    assert.equal(/secret content|private prompt/.test(JSON.stringify(calls.reports)), false);
  }
});

test("cron sweeps production and preview without needing new chat requests", async () => {
  const { service, calls } = serviceHarness();
  await service.sweepAiChatAlerts();
  assert.deepEqual(calls.samples.map((entry) => entry.environment), ["production", "preview"]);
  assert.equal(calls.samples.every((entry) => entry.sample === undefined), true);
  const cron = read("src/app/api/cron/native-agent-heartbeat/route.ts");
  assert.ok(cron.indexOf("after(sweepAiChatAlerts)") > cron.indexOf('return NextResponse.json({ error: "unauthorized"'));
  assert.match(read("vercel.json"), /native-agent-heartbeat[\s\S]*?\*\/15/);
});

test("non-deployment environments and malformed durations do not collect samples", async () => {
  for (const environment of ["development", "test"]) {
    const { service, calls } = serviceHarness({ environment });
    await service.recordAiChatAlertSample({ userId: 6, outcome: "ok", latencyMs: 100 });
    await service.sweepAiChatAlerts();
    assert.equal(calls.flags.length, 0);
    assert.equal(calls.samples.length, 0);
  }
  const { service, calls } = serviceHarness({ environment: "preview" });
  for (const latencyMs of [NaN, Infinity, -1]) {
    await service.recordAiChatAlertSample({ userId: 6, outcome: "ok", latencyMs });
  }
  await service.sweepAiChatAlerts();
  assert.equal(calls.samples.length, 0);
});

test("chat schedules alerts without awaiting them and leaves PostHog tracking independent", () => {
  const stream = read("src/lib/ai/chatStream/runStream.ts");
  assert.match(stream, /if \(state.turnOutcomeRecorded\) return;[\s\S]*state.turnOutcomeRecorded = true;/);
  assert.match(stream, /const alertObservation = recordAiChatAlertSample\(\{\s*userId: dbUser.id,\s*outcome,\s*latencyMs:/);
  assert.match(stream, /waitUntil\(observation\);\s*waitUntil\(alertObservation\);/);
  assert.doesNotMatch(stream, /await recordAiChatAlertSample|await alertObservation/);
  assert.doesNotMatch(read("src/lib/telemetry/aiChatObservability.ts"), /chatAlerts|ManagerAlert|AiChatAlertIncident/);
});

function managerHarness({ broadcastFailure = false, activeSubscription = true, webhookAvailable = true, managerAvailable = true } = {}) {
  const messages = new Map();
  const calls = { events: [], published: [], broadcasts: [], locks: [], lookup: null };
  let failBroadcast = broadcastFailure;
  const tx = {
    $queryRaw: async (strings) => { calls.locks.push(strings.join("?")); return [{ id: "manager" }]; },
    chatSession: { upsert: async () => ({ id: "session" }), update: async () => ({}) },
    chatMessage: {
      findUnique: async ({ where }) => messages.get(where.id),
      create: async ({ data }) => { assert.equal(messages.has(data.id), false); messages.set(data.id, data); return data; },
      update: async ({ where, data }) => Object.assign(messages.get(where.id), data),
    },
    agentWebhookSubscription: { findUnique: async () => ({ active: activeSubscription }) },
  };
  const db = {
    agent: { findFirst: async (query) => { calls.lookup = query; return managerAvailable ? { id: "manager", userId: 6, runtimeType: "EXTERNAL" } : null; } },
    $transaction: async (callback) => {
      const snapshot = new Map(messages);
      try { return await callback(tx); } catch (error) { messages.clear(); for (const [key, value] of snapshot) messages.set(key, value); throw error; }
    },
  };
  const manager = load("src/lib/ai/chatAlerts/manager.ts", {
    "@/lib/agentWebhooks/outbox": {
      persistAgentRunTriggerWebhooks: async (_, event) => { calls.events.push(event); return webhookAvailable ? ["existing-outbox-id"] : []; },
      publishAgentWebhookDeliveries: async (ids) => calls.published.push(ids),
    },
    "@/lib/agents/chatBroadcast": { broadcastChatSession: async (...args) => { calls.broadcasts.push(args); if (failBroadcast) { failBroadcast = false; throw new Error("broadcast failure"); } } },
    "@/lib/flags": { FEATURE_FLAG_OWNER_USER_ID: 6 },
    "./policy": policy,
  });
  return { manager, db, messages, calls };
}
const delivery = {
  id: "incident:breach", incidentId: "incident", environment: "production", kind: "error_rate", phase: "breach",
  happenedAt: new Date("2026-10-03T12:00:00Z"), requestCount: 20, errorCount: 2, p95Ms: 1000, attemptCount: 1,
};

test("Manager uses the existing addressed Agent Chat event, not a new channel", async () => {
  const { manager, db, messages, calls } = managerHarness();
  await manager.deliverManagerAlert(db, delivery);
  assert.equal(calls.lookup.where.displayName, "Manager");
  assert.equal(calls.lookup.where.runtimeType, "EXTERNAL");
  assert.equal(calls.events[0].event, "chat.message");
  assert.equal(calls.events[0].agentId, "manager");
  assert.equal(calls.events[0].actor.displayName, "AI Chat monitor");
  assert.equal(calls.events[0].chat.text, policy.alertMessage(delivery));
  assert.equal(messages.size, 1);
  assert.equal([...messages.values()][0].authorUserId, undefined);
  assert.match(calls.locks[0], /FROM "Agent"/);
});

test("retry after a committed Manager message cannot duplicate it or its webhook", async () => {
  const { manager, db, messages, calls } = managerHarness({ broadcastFailure: true });
  await assert.rejects(manager.deliverManagerAlert(db, delivery), /broadcast failure/);
  await manager.deliverManagerAlert(db, { ...delivery, attemptCount: 2 });
  assert.equal(messages.size, 1);
  assert.equal(calls.events.length, 1);
  assert.equal(calls.broadcasts.length, 2);
});

test("Manager polling retains a pending message, while an incompatible webhook fails handoff", async () => {
  const polling = managerHarness({ activeSubscription: false, webhookAvailable: false });
  await polling.manager.deliverManagerAlert(polling.db, delivery);
  assert.equal([...polling.messages.values()][0].isDelivered, false);
  const incompatible = managerHarness({ webhookAvailable: false });
  await assert.rejects(incompatible.manager.deliverManagerAlert(incompatible.db, delivery), /does not accept chat messages/);
  assert.equal(incompatible.messages.size, 0);
  const missing = managerHarness({ managerAvailable: false });
  await assert.rejects(missing.manager.deliverManagerAlert(missing.db, delivery), /not configured/);
  assert.equal(missing.messages.size, 0);
});

function webhookHarness(messageId) {
  const reports = [];
  const queued = [];
  const row = {
    id: "outbox", status: "pending", attemptCount: 0, event: "chat.message",
    payload: { chat: { messageId, text: "generated metric message" } },
    subscriptionId: "subscription",
    subscription: { active: true, url: "https://manager.invalid", secret: "test-only", agent: { userId: 6, revokedAt: null } },
  };
  const db = {
    agentWebhookDelivery: {
      updateMany: async () => {
        if (!["pending", "retrying", "processing"].includes(row.status)) return { count: 0 };
        row.status = "processing";
        return { count: 1 };
      },
      findUnique: async () => row,
      update: async ({ data }) => Object.assign(row, data),
    },
    agentWebhookSubscription: { update: async () => ({}) },
    $transaction: async (operations) => Promise.all(operations),
  };
  const webhook = load("src/lib/agentWebhooks/delivery.ts", {
    "@/lib/prisma": db,
    "@/lib/flags": { isFeatureEnabled: async () => true },
    "@/lib/agentRuns/model": { AGENT_RUN_FEATURE_FLAG: "existing-run-flag" },
    "@/lib/mcp/webhooks/delivery": { postSignedWebhook: async () => ({ ok: false, statusCode: 503, error: "private upstream body" }) },
    "./queue": { queueAgentWebhookDelivery: async (...args) => queued.push(args) },
    "@/lib/errors/reportError": { reportError: async (report) => reports.push(report) },
  });
  return { webhook, row, reports, queued };
}

test("existing Manager webhook transport retries three times and reports handled failures", async () => {
  const { webhook, row, reports, queued } = webhookHarness("ai-chat-alert:incident:breach");
  assert.equal(webhook.AGENT_WEBHOOK_MAX_ATTEMPTS, 4);
  for (let attempt = 1; attempt <= 4; attempt++) {
    const result = await webhook.deliverAgentWebhook("outbox");
    assert.equal(row.attemptCount, attempt);
    assert.equal(result.status, attempt === 4 ? "failed" : "retrying");
    assert.equal(reports[attempt - 1].source, "handled");
    assert.equal(reports[attempt - 1].extra.statusCode, 503);
    assert.equal(reports[attempt - 1].extra.attemptCount, attempt);
  }
  assert.equal((await webhook.deliverAgentWebhook("outbox")).status, "skipped");
  assert.equal(queued.length, 3);
  assert.equal(JSON.stringify(reports).includes("private upstream body"), false);
});

test("ordinary agent webhook failures are not reported as AI Chat alert failures", async () => {
  const { webhook, reports } = webhookHarness("ordinary-chat-message");
  await webhook.deliverAgentWebhook("outbox");
  assert.equal(reports.length, 0);
});
