const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { test } = require("node:test");
const root = path.resolve(__dirname, "..");
const diagnosticsFlag = "htpr-7752-chat-alert-diagnostics";

function load(file, modules = {}) {
  const loaded = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    module: loaded, exports: loaded.exports,
    require: (name) => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected runtime dependency: ${name}`);
      return modules[name];
    },
    process: { env: { VERCEL_ENV: "production" } },
    console: { warn() {} },
  }, { filename: file });
  return loaded.exports;
}

const policy = load("src/lib/ai/chatAlerts/policy.ts");
const delivery = {
  id: "incident:breach", incidentId: "incident", environment: "production", kind: "error_rate", phase: "breach",
  happenedAt: new Date("2026-10-24T12:00:00Z"), requestCount: 20, errorCount: 2, p95Ms: 1000, attemptCount: 1,
};

function harness({ failure, error = new Error("private reply"), enabled = true, missingManager = false, polling = false, finishFailure = false, reportFailure = false } = {}) {
  const reports = [];
  const finishes = [];
  const messages = new Map();
  const published = [];
  const broadcasts = [];
  const fail = (stage) => { if (failure === stage) throw error; };
  const tx = {
    $queryRaw: async () => [{ id: "manager" }],
    chatSession: { upsert: async () => ({ id: "session" }), update: async () => ({}) },
    chatMessage: {
      findUnique: async ({ where }) => messages.get(where.id),
      create: async ({ data }) => { messages.set(data.id, data); return data; },
      update: async ({ where, data }) => Object.assign(messages.get(where.id), data),
    },
    agentWebhookSubscription: { findUnique: async () => ({ active: !polling }) },
  };
  const db = {
    agent: { findFirst: async () => { fail("manager-lookup"); return missingManager ? null : { id: "manager", userId: 6 }; } },
    $transaction: async (callback) => {
      fail("transaction");
      try { return await callback(tx); } catch (error) { messages.clear(); throw error; }
    },
  };
  const manager = load("src/lib/ai/chatAlerts/manager.ts", {
    "@/lib/agentWebhooks/outbox": {
      persistAgentRunTriggerWebhooks: async () => { fail("webhook-persist"); return polling || failure === "webhook-validation" ? [] : ["outbox"]; },
      publishAgentWebhookDeliveries: async (ids) => { fail("publish"); published.push(Array.from(ids)); },
    },
    "@/lib/agents/chatBroadcast": { broadcastChatSession: async (id) => { fail("broadcast"); broadcasts.push(id); } },
    "@/lib/flags": { FEATURE_FLAG_OWNER_USER_ID: 6 },
    "./policy": policy,
  });
  let next = delivery;
  const service = load("src/lib/ai/chatAlerts/service.ts", {
    "@/lib/prisma": db,
    "@/lib/flags": { FEATURE_FLAG_OWNER_USER_ID: 6, isFeatureEnabled: async (key) => {
      if (key !== diagnosticsFlag) return true;
      if (enabled === "unavailable") throw new Error("flag unavailable");
      return enabled;
    } },
    "@/lib/flags/keys": { HTPR_6354_AI_CHAT_ALERTS_FLAG: "htpr-6354-ai-chat-alerts" },
    "@/lib/flags/definitions/htpr-7752-chat-alert-diagnostics": { HTPR_7752_CHAT_ALERT_DIAGNOSTICS_FLAG: diagnosticsFlag },
    "@/lib/errors/reportError": { reportError: async (report) => { if (reportFailure) throw new Error("report unavailable"); reports.push(JSON.parse(JSON.stringify(report))); } },
    "./manager": manager,
    "./store": {
      evaluateAlerts: async () => {},
      claimDelivery: async () => { const claimed = next; next = undefined; return claimed; },
      finishDelivery: async (_, item, success) => { if (finishFailure) throw new Error("finish unavailable"); finishes.push({ id: item.id, success }); },
    },
  });
  return { service, reports, finishes, messages, published, broadcasts };
}

async function run(h) {
  await h.service.recordAiChatAlertSample({ userId: 6, outcome: "ok", latencyMs: 100 });
}

for (const stage of ["manager-lookup", "transaction", "webhook-persist", "publish", "broadcast"]) {
  test(`delivery report retains sanitized exception metadata at ${stage}`, async () => {
    const error = Object.assign(new Error("private reply Authorization: Bearer test-only-value"), {
      name: "PrismaClientKnownRequestError", code: "P2028", meta: { secret: "private prompt" },
    });
    const h = harness({ failure: stage, error });
    await run(h);
    assert.deepEqual(h.reports[0].extra, {
      environment: "production", step: "delivery", attemptCount: 1,
      stage, errorName: "PrismaClientKnownRequestError", prismaCode: "P2028",
    });
    assert.deepEqual(h.finishes, [{ id: delivery.id, success: false }]);
    assert.equal(h.reports[0].source, "handled");
    assert.equal(h.reports[0].fingerprintKey, "ai-chat-alerts:production:delivery");
    assert.doesNotMatch(JSON.stringify(h.reports), /private|Authorization|test-only-value|stack|meta"/);
    const { safeErrorExtra } = load("src/lib/telemetry/errorSanitization.ts");
    assert.deepEqual(JSON.parse(JSON.stringify(safeErrorExtra(h.reports[0].extra))), {
      ht_stage: stage, ht_errorName: "PrismaClientKnownRequestError", ht_prismaCode: "P2028",
    });
  });
}

test("incompatible webhook is identified, while polling delivery still succeeds", async () => {
  const incompatible = harness({ failure: "webhook-validation" });
  await run(incompatible);
  assert.equal(incompatible.reports[0].extra.stage, "webhook-validation");
  assert.equal(incompatible.reports[0].extra.errorName, "Error");
  assert.equal(incompatible.messages.size, 0);
  assert.deepEqual(incompatible.finishes, [{ id: delivery.id, success: false }]);
  const polling = harness({ polling: true });
  await run(polling);
  assert.deepEqual(polling.finishes, [{ id: delivery.id, success: true }]);
  assert.equal(polling.messages.get(`ai-chat-alert:${delivery.id}`).isDelivered, false);
  assert.deepEqual(polling.broadcasts, ["session"]);
  assert.deepEqual(polling.reports, []);
});

test("missing Manager reports configuration failure without silently consuming the alert", async () => {
  const h = harness({ missingManager: true });
  await run(h);
  assert.equal(h.reports[0].extra.stage, "manager-lookup");
  assert.equal(h.reports[0].extra.errorName, "Error");
  assert.deepEqual(h.finishes, [{ id: delivery.id, success: false }]);
});

test("flag Off restores the existing report payload", async () => {
  const h = harness({ failure: "broadcast", enabled: false });
  await run(h);
  assert.deepEqual(h.reports[0].extra, { environment: "production", step: "delivery", attemptCount: 1 });
  assert.deepEqual(h.finishes, [{ id: delivery.id, success: false }]);
});

test("diagnostic flag lookup failure does not prevent delivery", async () => {
  const h = harness({ enabled: "unavailable" });
  await run(h);
  assert.deepEqual(h.finishes, [{ id: delivery.id, success: true }]);
  assert.equal(h.messages.get(`ai-chat-alert:${delivery.id}`).isDelivered, true);
  assert.deepEqual(h.broadcasts, ["session"]);
});

test("custom exception names, codes and non-Error throws cannot leak through metadata", async () => {
  for (const error of [
    { name: "private prompt", code: "private reply", message: "secret" },
    { name: "Error", code: "P2028 private reply", stack: "secret" },
    "private reply", null,
  ]) {
    const h = harness({ failure: "transaction", error });
    await run(h);
    assert.equal(h.reports[0].extra.stage, "transaction");
    assert.equal(h.reports[0].extra.errorName, error?.name === "Error" ? "Error" : "UnknownError");
    assert.equal(h.reports[0].extra.prismaCode, undefined);
    assert.doesNotMatch(JSON.stringify(h.reports), /private|secret/);
  }
});

test("delivery failure is reported even if recording the failed attempt also fails", async () => {
  const h = harness({ failure: "broadcast", finishFailure: true });
  await run(h);
  assert.equal(h.reports[0].extra.stage, "broadcast");
  assert.equal(h.reports[0].extra.errorName, "Error");
  assert.equal(h.reports[1].extra.step, "processing");
});

test("successful webhook delivery and reporting outages remain non-throwing", async () => {
  const h = harness();
  await run(h);
  assert.deepEqual(h.finishes, [{ id: delivery.id, success: true }]);
  assert.equal(h.messages.get(`ai-chat-alert:${delivery.id}`).isDelivered, true);
  assert.deepEqual(h.published, [["outbox"]]);
  assert.deepEqual(h.broadcasts, ["session"]);
  assert.deepEqual(h.reports, []);
  const outage = harness({ failure: "broadcast", reportFailure: true });
  await run(outage);
  assert.deepEqual(outage.finishes, [{ id: delivery.id, success: false }]);
});

test("ticket flag ships as a low-risk Everyone bugfix", () => {
  const definition = load("src/lib/flags/definitions/htpr-7752-chat-alert-diagnostics.ts").default;
  assert.equal(definition.key, diagnosticsFlag);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason.length > 0);
});
