import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { activationHarness } from "./helpers/activation-harness";

process.env.POSTHOG_SERVER_PROJECT_TOKEN = "mock-local-only";

function harness() {
  const h = activationHarness();
  h.setFlagEnabled("htpr-7271-saved-work-events", true);
  h.setFlagEnabled("htpr-7273-column-events", true);
  h.mocks["@/lib/telemetry/analyticsOutbox"] = { isAnalyticsOutboxEnabled: async () => false };
  const intents = h.load("src/lib/telemetry/analyticsIntents.ts");
  const kicks: string[] = [];
  h.mocks["@/lib/telemetry/savedWork"] = {
    ...h.load("src/lib/telemetry/savedWork.ts"), processAnalyticsIntentSoon: (key: string) => { kicks.push(key); },
  };
  h.mocks["@/lib/mcp/webhooks/outbox"] = { persistBoardWebhookEvent: async () => [] };
  const phases: string[] = [];
  const insert = h.prisma.analyticsIntent.createMany;
  let failInsert = false;
  h.prisma.analyticsIntent.createMany = async (args: any) => {
    phases.push("root-intent");
    if (failInsert) throw Error("intent unavailable with private customer data");
    return insert(args);
  };
  const transaction = h.prisma.$transaction;
  h.prisma.$transaction = (callback: any) => transaction(async (db: any) => {
    const oldIntents = structuredClone(h.intentRows);
    const oldTasks = new Map(h.tasks);
    const oldProjects = structuredClone(h.projects);
    const tx = { ...db, analyticsIntent: { ...db.analyticsIntent, createMany: async (args: any) => {
      phases.push("tx-intent");
      if (failInsert) throw Error("intent unavailable with private customer data");
      return insert(args);
    } } };
    try {
      const result = await callback(tx);
      phases.push("commit");
      return result;
    } catch (error) {
      h.intentRows.splice(0, h.intentRows.length, ...oldIntents);
      h.tasks.clear();
      for (const [key, value] of oldTasks) h.tasks.set(key, value);
      h.projects.clear();
      for (const [key, value] of oldProjects) h.projects.set(key, value);
      phases.push("rollback");
      throw error;
    }
  });
  const taskEvents = () => h.load("src/lib/mcp/webhooks/taskEvents.ts");
  const saveTask = (create?: (tx: any) => Promise<any>) => taskEvents().createTaskWithBoardWebhookOutbox(h.prisma,
    { userId: 123, agentId: null }, create ?? (async () => {
      h.tasks.set(41, { id: 41, projectId: 15, createdAt: new Date("2026-10-17T12:00:00Z") });
      return { taskId: 41, firstTaskPointerTaskId: h.projects.get(15).firstTaskPointerTaskId, result: { id: 41 }, webhookTask: { id: 41, projectId: 15, section: "Doing", sectionId: 1, status: "Normal" } };
    }), "web");
  return { ...h, intents, phases, kicks, saveTask, setInsertFailure: (value: boolean) => { failInsert = value; } };
}

test("task intent is inserted by the transaction client and survives death before the post-commit kick", async () => {
  const h = harness();
  await h.saveTask();
  assert.deepEqual(h.phases, ["tx-intent", "commit"]);
  assert.equal(h.flagChecks.length, 0);
  assert.equal(h.captures.length, 0);
  assert.equal(h.jobs.length, 0);
  assert.equal(h.intentRows[0].processedAt, null);
  assert.ok(h.intentRows[0].nextAttemptAt <= new Date());
  assert.deepEqual(h.intentRows[0].payload, { taskId: 41, actor: { userId: 123, agentId: null }, channel: "web" });
  assert.deepEqual(await h.intents.retryAnalyticsIntents(), { processed: 1, failed: 0, skipped: 0 });
  assert.deepEqual(await h.intents.retryAnalyticsIntents(), { processed: 0, failed: 0, skipped: 0 });
  assert.deepEqual(h.captures.map((capture) => capture.event), ["task_created"]);
  assert.ok(h.intentRows[0].processedAt);
});

test("a failed task write leaves neither intent nor capture", async () => {
  const h = harness();
  await assert.rejects(h.saveTask(async () => { throw Error("save failed"); }), /save failed/);
  assert.deepEqual(h.phases, ["rollback"]);
  assert.equal(h.intentRows.length, 0);
  assert.equal(h.kicks.length, 0);
  await h.intents.retryAnalyticsIntents();
  assert.equal(h.captures.length, 0);
});

test("intent insert failure rolls the task back rather than leaving a committed task without analytics", async () => {
  const h = harness();
  h.setInsertFailure(true);
  await assert.rejects(h.saveTask(), /intent unavailable/);
  assert.equal(h.tasks.has(41), false);
  assert.equal(h.intentRows.length, 0);
  assert.equal(h.kicks.length, 0);
});

test("enrolled-board milestone and analytics intent commit together and roll back together", async () => {
  const h = harness();
  Object.assign(h.projects.get(15), { firstTaskPointerTaskId: 9, firstRealTaskCreatedAt: null });
  h.setInsertFailure(true);
  await assert.rejects(h.saveTask(), /intent unavailable/);
  assert.equal(h.projects.get(15).firstRealTaskCreatedAt, null);
  assert.equal(h.tasks.has(41), false);
  h.setInsertFailure(false);
  await h.saveTask();
  assert.ok(h.projects.get(15).firstRealTaskCreatedAt instanceof Date);
  assert.equal(h.intentRows.length, 1);
  assert.deepEqual(h.kicks, [h.intentRows[0].key]);
});

for (const failure of ["flag", "task lookup", "occurrence transaction"]) {
  test(`first ${failure} failure leaves an unprocessed intent and a later retry captures once`, async () => {
    const h = harness();
    await h.saveTask();
    let failed = false;
    if (failure === "flag") {
      const enabled = h.mocks["@/lib/flags"].isFeatureEnabled;
      h.mocks["@/lib/flags"].isFeatureEnabled = async (...args: any[]) => {
        if (!failed) { failed = true; throw Error("flag lookup private text"); }
        return enabled(...args);
      };
    } else if (failure === "task lookup") {
      const lookup = h.prisma.task.findUnique;
      h.prisma.task.findUnique = async (args: any) => {
        if (!failed) { failed = true; throw Error("database private text"); }
        return lookup(args);
      };
    } else {
      const transaction = h.prisma.$transaction;
      h.prisma.$transaction = (callback: any) => {
        if (!failed) { failed = true; return Promise.reject(Error("transaction private text")); }
        return transaction(callback);
      };
    }
    assert.deepEqual(await h.intents.retryAnalyticsIntents(), { processed: 0, failed: 1, skipped: 0 });
    assert.equal(h.intentRows[0].attempts, 1);
    assert.equal(h.intentRows[0].processedAt, null);
    assert.equal(h.intentRows[0].lastError, "Analytics intent processing failed");
    assert.equal(h.captures.length, 0);
    assert.deepEqual(await h.intents.retryAnalyticsIntents(), { processed: 0, failed: 0, skipped: 0 });
    h.intentRows[0].nextAttemptAt = new Date(0);
    assert.deepEqual(await h.intents.retryAnalyticsIntents(), { processed: 1, failed: 0, skipped: 0 });
    assert.equal(h.captures.filter((capture) => capture.event === "task_created").length, 1);
    assert.equal(h.intentRows[0].lastError, null);
  });
}

function paidEvent(): any {
  return { id: "evt_paid", type: "invoice.paid", created: 1770000000, data: { object: {
    id: "in_paid", customer: "cus_stored", subscription: "sub_paid", status: "paid", amount_paid: 3000,
    currency: "usd", billing_reason: "subscription_create", status_transitions: { paid_at: 1769999990 },
    lines: { data: [{ type: "subscription", price: { id: "price_month" } }] },
    customer_email: "private@example.test", metadata: { secret: "private customer text" },
  } } };
}

function subscription(): any {
  return { id: "sub_paid", customer: "cus_stored", status: "active", items: { data: [{ id: "si_paid", quantity: 3,
    price: { id: "price_month", product: "prod_paid", unit_amount: 1000, currency: "usd", recurring: { interval: "month" } },
  }] } };
}

function stripeHarness(event = paidEvent()) {
  const h = harness();
  h.setFlagEnabled("htpr-7272-payment-login-agent-events", true);
  h.prisma.team.findFirst = async ({ where }: any) => typeof where.stripe_customer_id === "string"
    ? { id: "team", googleAccount: { userId: 123 } } : null;
  const billing: string[] = [];
  const reads: string[] = [];
  const writes: string[] = [];
  const stripe = {
    events: { retrieve: async (id: string) => { reads.push(`event:${id}`); return event; } },
    subscriptions: { retrieve: async () => { reads.push("subscription"); return subscription(); } },
    invoices: { list: async () => { reads.push("invoices"); return { data: [], has_more: false }; } },
  };
  for (const resource of Object.values(stripe)) {
    for (const method of ["create", "update", "del", "cancel", "pay", "finalizeInvoice"]) {
      (resource as any)[method] = () => { writes.push(method); throw Error("Stripe write forbidden"); };
    }
  }
  h.mocks["raw-body"] = { default: async () => Buffer.from("signed test fixture") };
  h.mocks["stripe"] = { Stripe: class {
    static API_VERSION = "2023-08-16";
    constructor(_key: string, options: any) { assert.equal(options.apiVersion, "2023-08-16"); }
    webhooks = { constructEvent: (raw: Buffer, signature: string) => {
      assert.equal(raw.toString(), "signed test fixture"); assert.equal(signature, "signed"); return event;
    } };
    events = stripe.events;
    subscriptions = stripe.subscriptions;
    invoices = stripe.invoices;
  } };
  h.mocks["@/lib/telemetry/analyticsIntents"] = { ...h.intents, processAnalyticsIntentSoon: (key: string) => { h.kicks.push(key); } };
  h.mocks["@/utils/controllers/stripe/webhook/onCheckoutSuccess"] = { default: async () => { billing.push("checkout"); } };
  h.mocks["@/utils/controllers/stripe/webhook/onSubscriptionUpdated"] = { default: async () => { billing.push("subscription"); } };
  const handle = h.load("src/pages/api/stripe/webhook.ts").default;
  const request = async () => {
    const response = { code: 0, body: null as any, status(code: number) { this.code = code; return this; }, json(body: any) { this.body = body; return this; } };
    await handle({ headers: { "stripe-signature": "signed" } }, response);
    return response;
  };
  return { ...h, stripe, billing, reads, writes, request };
}

test("real signed invoice webhook returns 500 on enqueue failure, and 200 only after an ids-only intent is saved", async () => {
  const h = stripeHarness();
  h.setInsertFailure(true);
  assert.equal((await h.request()).code, 500);
  assert.equal(h.intentRows.length, 0);
  assert.equal(h.kicks.length, 0);
  h.setInsertFailure(false);
  assert.equal((await h.request()).code, 200);
  assert.equal(h.intentRows.length, 1);
  assert.equal(h.intentRows[0].kind, "stripe_event");
  assert.equal(h.intentRows[0].key, "stripe_event:evt_paid");
  assert.deepEqual(h.intentRows[0].payload, { eventId: "evt_paid" });
  assert.equal(h.billing.length, 0);
});

test("replayed invoice webhooks insert one intent and produce one payment occurrence", async () => {
  const h = stripeHarness();
  assert.equal((await h.request()).code, 200);
  assert.equal((await h.request()).code, 200);
  assert.equal(h.intentRows.length, 1);
  await Promise.all([h.intents.retryAnalyticsIntents({ stripe: h.stripe }), h.intents.retryAnalyticsIntents({ stripe: h.stripe })]);
  assert.equal(h.captures.filter((capture) => capture.event === "payment_succeeded").length, 1);
  assert.equal(h.logs.filter((row) => row.log === "analytics:payment_succeeded:in_paid").length, 1);
  assert.equal(h.reads.filter((read) => read === "event:evt_paid").length, 1);
  assert.equal(h.billing.length, 0);
  assert.equal(h.writes.length, 0);
});

test("a failed payment capture waits for subscription analytics and replay deduplicates the completed branch", async () => {
  const h = stripeHarness();
  const PostHog = h.mocks["posthog-node"].PostHog;
  let failPayment = true;
  h.mocks["posthog-node"].PostHog = class extends PostHog {
    constructor() {
      super();
      const capture = this.captureImmediate;
      this.captureImmediate = async (payload: any) => {
        if (payload.event === "payment_succeeded" && failPayment) throw Error("temporary payment capture failure");
        return capture(payload);
      };
    }
  };
  await h.request();
  assert.deepEqual(await h.intents.retryAnalyticsIntents({ stripe: h.stripe }), { processed: 0, failed: 1, skipped: 0 });
  assert.deepEqual(h.captures.map((capture) => capture.event), ["subscription_started"]);
  assert.equal(h.intentRows[0].attempts, 1);
  assert.equal(h.intentRows[0].processedAt, null);
  failPayment = false;
  h.intentRows[0].nextAttemptAt = new Date(0);
  assert.deepEqual(await h.intents.retryAnalyticsIntents({ stripe: h.stripe }), { processed: 1, failed: 0, skipped: 0 });
  assert.deepEqual(h.captures.map((capture) => capture.event).sort(), ["payment_succeeded", "subscription_started"]);
});

test("an invoice paid before its customer mapping exists stays due and is captured once the mapping appears", async () => {
  const h = stripeHarness();
  let mapped = false;
  h.prisma.team.findFirst = async ({ where }: any) => mapped && where.stripe_customer_id === "cus_stored"
    ? { id: "team", googleAccount: { userId: 123 } } : null;
  assert.equal((await h.request()).code, 200);
  assert.deepEqual(await h.intents.retryAnalyticsIntents({ stripe: h.stripe }), { processed: 0, failed: 1, skipped: 0 });
  assert.equal(h.intentRows[0].processedAt, null);
  assert.equal(h.captures.length, 0);
  mapped = true;
  h.intentRows[0].nextAttemptAt = new Date(0);
  assert.deepEqual(await h.intents.retryAnalyticsIntents({ stripe: h.stripe }), { processed: 1, failed: 0, skipped: 0 });
  assert.equal(h.captures.filter((capture) => capture.event === "payment_succeeded").length, 1);
  assert.equal(h.billing.length, 0);
});

for (const type of ["customer.subscription.updated", "customer.subscription.deleted"]) {
  test(`${type} replay only reads Stripe and captures analytics, never billing`, async () => {
    const event = { id: `evt_${type}`, type, created: 1770000000, data: {
      object: { ...subscription(), ...(type.endsWith("deleted") ? { ended_at: 1769999990 } : {}) }, previous_attributes: { quantity: 1 },
    } };
    const h = stripeHarness(event);
    const key = await h.intents.enqueueAnalyticsIntent(h.prisma, { kind: "stripe_event", payload: { eventId: event.id } });
    assert.equal(await h.intents.processAnalyticsIntent(key, { stripe: h.stripe }), "processed");
    assert.deepEqual(h.captures.map((capture) => capture.event), [type.endsWith("deleted") ? "subscription_canceled" : "subscription_seats_changed"]);
    assert.equal(h.billing.length, 0);
    assert.equal(h.writes.length, 0);
    assert.deepEqual(h.reads, [`event:${event.id}`]);
  });

  test(`${type} keeps billing before enqueue and acknowledges 200 when enqueue fails`, async () => {
    const h = stripeHarness({ id: "evt_subscription", type, created: 1770000000, data: { object: subscription() } });
    h.setInsertFailure(true);
    const errors: any[] = [];
    const original = console.error;
    console.error = (...args) => { errors.push(args); };
    try { assert.equal((await h.request()).code, 200); } finally { console.error = original; }
    assert.deepEqual(h.billing, ["subscription"]);
    assert.equal(h.kicks.length, 0);
    assert.deepEqual(errors, [["[stripe-analytics] intent enqueue failed"]]);
  });
}

function sectionHarness() {
  const h = harness();
  h.prisma.section.create = async ({ data }: any) => ({ id: 7, projectId: 15, ...data });
  h.prisma.section.findUnique = async () => ({ id: 7, projectId: 15, section_title: "Todo", deleted: false });
  h.prisma.section.update = async ({ data }: any) => ({ id: 7, projectId: 15, deleted: false, ...data });
  h.prisma.task.updateManyAndReturn = async () => [];
  h.mocks["@/utils/controllers/section/viewHelpers"] = { appendSectionToAllViews: async () => {}, updateSectionInAllViews: async () => {}, removeSectionFromAllViews: async () => {} };
  h.mocks["@/utils/controllers/notifications/agentFirstTaskEmail"] = { scheduleAgentFirstTaskEmailBatch: () => {} };
  h.mocks["@/utils/controllers/projects/getAllIncludes"] = { getProjectWhere: () => ({}), savedViewBoardAccessWhere: () => ({}) };
  h.mocks["@/utils/generateRank"] = { default: () => "A0500" };
  return { ...h, service: h.load("src/utils/controllers/section/sectionService.ts") };
}

for (const kind of ["column_created", "column_renamed"]) {
  test(`${kind} intent is inside the column write transaction`, async () => {
    const h = sectionHarness();
    const result = kind === "column_created"
      ? await h.service.createSection({ projectId: 15, title: "Review", userId: 123 })
      : await h.service.updateSection({ sectionId: 7, section_title: "Review", userId: 123 });
    assert.equal(result.status, 200);
    assert.deepEqual(h.phases, ["tx-intent", "commit"]);
    assert.equal(h.intentRows[0].kind, kind);
    assert.equal(h.intentRows[0].payload.columnId, 7);
    assert.deepEqual(h.kicks, [h.intentRows[0].key]);
  });
}

test("manual board intent is inside the project creation transaction", async () => {
  const h = harness();
  h.prisma.project_View = { upsert: async () => ({ default_view_id: 1 }) };
  const result = await h.load("src/utils/controllers/projects/create.ts").default(123, "Board", "team", "account", "BOARD");
  assert.equal(result.status, 200);
  assert.deepEqual(h.phases, ["tx-intent", "commit"]);
  assert.equal(h.intentRows[0].kind, "board_created");
  assert.equal(h.intentRows[0].payload.boardId, result.json.id);
  assert.equal(h.intentRows[0].payload.method, "manual");
});

test("manifest analytics enqueue failure cannot compensate or fail a successfully created board", async () => {
  const h = harness();
  h.setInsertFailure(true);
  h.mocks["@/utils/controllers/projects/boardQuota"] = { assertBoardQuota: async () => {} };
  h.mocks["@/utils/controllers/projects/create"] = { createProjectViewAndCreateDefault: async () => {}, updateUniqueIdentifier: async () => {} };
  h.mocks["@/utils/generateRank"] = { default: () => "A0100" };
  h.mocks["@/lib/mcp/tasks/services"] = { createTask: async () => { throw Error("no tasks in fixture"); } };
  h.mocks["@/lib/mcp/boards/links"] = { buildMcpBoardUrl: (id: number) => `board:${id}`, buildMcpTaskUrl: () => "task" };
  h.mocks["@/lib/constants/constants"] = { PriorityConstants: [], EstimateConstants: [] };
  h.mocks["@/lib/mcp/webhooks/taskEvents"] = { persistTaskCreatedWebhook: async () => {} };
  h.mocks["@/lib/agentWebhooks/outbox"] = { persistAgentTaskCreatedPending: async () => {} };
  h.mocks["@/lib/api/task-writes/create-global-effects"] = { schedulePostCreateWork: () => {}, createPriorityActivity: async () => {} };
  h.mocks["@/utils/controllers/activities/createEstimateActivity"] = { default: async () => {} };
  h.mocks["@/models/model"] = {};
  h.prisma.project.findUniqueOrThrow = async ({ where }: any) => ({ ...h.projects.get(where.id), uniqueIdentifier: "BOARD" });
  h.prisma.section.findMany = async () => [];
  const updates: any[] = [];
  h.prisma.task.updateMany = async (args: any) => { updates.push(args); };
  h.prisma.project.update = async (args: any) => { updates.push(args); };
  const result = await h.load("src/lib/mcp/boards/createBoardFromManifest.ts").createBoardFromManifest({
    teamId: "team", googleAccountId: "account", userId: 123, userEmail: "member@example.test",
    manifest: { title: "Board", sections: [], labels: [], tasks: [] }, creation: { method: "api", channel: "api" },
  });
  assert.ok(result.board.id);
  assert.deepEqual(updates, []);
  assert.equal(h.kicks.length, 0);
});

test("retry bounds, backoff, lease ownership and seven-day cleanup protect durable intents", async () => {
  const h = harness();
  await h.saveTask();
  h.prisma.task.findUnique = async () => { throw Error("private error"); };
  for (let attempt = 0; attempt < 10; attempt++) {
    h.intentRows[0].nextAttemptAt = new Date(0);
    const before = Date.now();
    assert.equal(await h.intents.processAnalyticsIntent("task_created:41"), "failed");
    assert.equal(h.intentRows[0].attempts, attempt + 1);
    const delay = [60000, 300000, 1800000, 7200000, 43200000][Math.min(attempt, 4)];
    assert.ok(h.intentRows[0].nextAttemptAt.getTime() >= before + delay);
    assert.ok(h.intentRows[0].nextAttemptAt.getTime() <= Date.now() + delay);
  }
  h.intentRows[0].nextAttemptAt = new Date(0);
  assert.equal(await h.intents.processAnalyticsIntent("task_created:41"), "skipped");
  const row = { ...h.intentRows[0], attempts: 0, nextAttemptAt: new Date(0) };
  h.intentRows.splice(0);
  for (let id = 0; id < 101; id++) h.intentRows.push({ ...row, id: `row-${id}`, key: `task_created:${id}`, createdAt: new Date(id) });
  h.intentRows.push({ ...row, id: "old", key: "old", processedAt: new Date(Date.now() - 8 * 86400000) });
  h.intentRows.push({ ...row, id: "recent", key: "recent", processedAt: new Date() });
  assert.deepEqual(await h.intents.retryAnalyticsIntents(), { processed: 0, failed: 100, skipped: 0 });
  assert.equal(h.intentRows.some((row) => row.key === "old"), false);
  assert.equal(h.intentRows.some((row) => row.key === "recent"), true);
  assert.equal(h.intentRows.find((row) => row.key === "task_created:100").attempts, 0);
});

test("stale lease completion cannot mark a newly leased intent processed", async () => {
  const h = harness();
  await h.saveTask();
  const lookup = h.prisma.task.findUnique;
  h.prisma.task.findUnique = async (args: any) => {
    h.intentRows[0].nextAttemptAt = new Date(Date.now() + 600000);
    return lookup(args);
  };
  assert.equal(await h.intents.processAnalyticsIntent("task_created:41"), "skipped");
  assert.equal(h.intentRows[0].processedAt, null);
  assert.equal(h.captures.length, 1);
});

test("additive intent migration and schema contain the unique key and due index", () => {
  const sql = fs.readFileSync("src/prisma/migrations/20261017140000_htpr_7288_analytics_intent/migration.sql", "utf8");
  assert.match(sql, /CREATE TABLE "AnalyticsIntent"/);
  assert.match(sql, /CREATE UNIQUE INDEX "AnalyticsIntent_key_key"/);
  assert.match(sql, /ON "AnalyticsIntent"\("processedAt", "nextAttemptAt"\)/);
  assert.match(fs.readFileSync("src/prisma/schema.prisma", "utf8"), /model AnalyticsIntent \{[\s\S]*?@@index\(\[processedAt, nextAttemptAt\]\)/);
});
