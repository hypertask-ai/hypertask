const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test, before, after, beforeEach } = require("node:test");
const { PGlite } = require("@electric-sql/pglite");
const { createJiti } = require("jiti");
const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { interopDefault: true });
const policy = jiti(path.join(root, "src/lib/ai/chatAlerts/policy.ts"));
const store = jiti(path.join(root, "src/lib/ai/chatAlerts/store.ts"));
const migration = fs.readFileSync(path.join(root, "src/prisma/migrations/20261003230000_add_ai_chat_alerts/migration.sql"), "utf8");
let sql;
let now;
let transactionTail = Promise.resolve();

// Real isolated Postgres semantics, with the database clock controlled so a
// full recovery window and backoff can be tested without sleeping.
async function query(client, strings, ...values) {
  let text = strings.reduce((result, part, index) => result + (index ? `$${index}` : "") + part, "");
  text = text.replaceAll("clock_timestamp()", `'${now.toISOString()}'::timestamptz`);
  return client.query(text, values);
}
const adapter = (client) => ({
  $queryRaw: async (...args) => (await query(client, ...args)).rows,
  $executeRaw: async (...args) => (await query(client, ...args)).affectedRows,
});
const db = {
  $queryRaw: async (...args) => (await query(sql, ...args)).rows,
  $executeRaw: async (...args) => (await query(sql, ...args)).affectedRows,
  $transaction: (callback) => {
    const result = transactionTail.then(() => sql.transaction((tx) => callback(adapter(tx))));
    transactionTail = result.catch(() => undefined);
    return result;
  },
};
const rows = async (table) => (await sql.query(`SELECT * FROM "${table}" ORDER BY "id"`)).rows;
const advance = (ms) => { now = new Date(now.getTime() + ms); };
const sample = (statusCode = 200, latencyMs = 1000, environment = "production") => store.evaluateAlerts(db, environment, { statusCode, latencyMs });
async function breach(environment = "production") {
  for (let index = 0; index < 18; index++) await sample(200, 1000, environment);
  await sample(500, 1000, environment);
  await sample(500, 1000, environment);
}
async function deliverNext(success = true, environment = "production") {
  const delivery = await store.claimDelivery(db, environment);
  if (delivery) await store.finishDelivery(db, delivery, success);
  return delivery;
}

before(async () => {
  sql = new PGlite();
  await sql.exec(migration);
});
after(async () => { await sql.close(); });
beforeEach(async () => {
  now = new Date("2026-10-03T12:00:00.000Z");
  await sql.exec('TRUNCATE "AiChatAlertSample", "AiChatAlertDelivery", "AiChatAlertIncident" RESTART IDENTITY CASCADE');
});

test("breach opens an incident, delivers once, and suppresses duplicate alerts", async () => {
  await breach();
  assert.equal((await rows("AiChatAlertIncident")).length, 1);
  const first = await deliverNext();
  assert.equal(first.kind, "error_rate");
  assert.equal(first.phase, "breach");
  assert.equal(first.requestCount, 20);
  assert.equal(first.errorCount, 2);
  assert.match(policy.alertMessage(first), /AI Chat error rate breached/);
  await Promise.all([sample(500), sample(500)]);
  assert.equal((await rows("AiChatAlertIncident")).length, 1);
  assert.equal((await rows("AiChatAlertDelivery")).length, 1);
  assert.equal(await deliverNext(), undefined);
});

test("strict thresholds require 20 requests and use nearest-rank rolling p95", async () => {
  for (let index = 0; index < 19; index++) await sample(200, 20_000);
  assert.equal((await rows("AiChatAlertIncident")).length, 0);
  await sample(500, 20_001);
  // Exactly 5% errors and p95 exactly 20s do not breach.
  assert.equal((await rows("AiChatAlertIncident")).length, 0);
  await sample(200, 20_001);
  const incident = (await rows("AiChatAlertIncident"))[0];
  assert.equal(incident.kind, "latency");
  assert.equal((await rows("AiChatAlertDelivery"))[0].p95Ms, 20_001);
  advance(policy.AI_CHAT_ALERT_WINDOW_MS);
  await store.evaluateAlerts(db, "production");
  assert.equal((await rows("AiChatAlertSample")).length, 0);
});

test("19 failed or slow requests cannot open an incident", async () => {
  for (let index = 0; index < 19; index++) await sample(500, 30_000);
  assert.equal((await rows("AiChatAlertIncident")).length, 0);
  await sample(500, 30_000);
  assert.deepEqual((await rows("AiChatAlertIncident")).map((row) => row.kind).sort(), ["error_rate", "latency"]);
});

test("delivery failure retries with backoff up to three times, then stops", async () => {
  await breach();
  for (let attempt = 1; attempt <= 4; attempt++) {
    const delivery = await deliverNext(false);
    assert.equal(delivery.attemptCount, attempt);
    assert.equal(await store.claimDelivery(db, "production"), undefined);
    if (attempt < 4) {
      const delay = policy.AI_CHAT_ALERT_RETRY_MS[attempt - 1];
      advance(delay - 1);
      assert.equal(await store.claimDelivery(db, "production"), undefined);
      advance(1);
    }
  }
  assert.equal((await rows("AiChatAlertDelivery"))[0].status, "failed");
  advance(60 * 60_000);
  assert.equal(await store.claimDelivery(db, "production"), undefined);
  await sample(500);
  assert.equal((await rows("AiChatAlertDelivery")).length, 1);
});

test("a transient delivery failure succeeds on retry without repeating the alert", async () => {
  await breach();
  const first = await deliverNext(false);
  advance(60_000);
  const retry = await deliverNext();
  assert.equal(retry.id, first.id);
  assert.equal(retry.attemptCount, 2);
  assert.equal(await deliverNext(), undefined);
});

test("recovery closes only after a full healthy window, and a later breach alerts again", async () => {
  await breach();
  const initial = await deliverNext();
  advance(policy.AI_CHAT_ALERT_WINDOW_MS);
  await store.evaluateAlerts(db, "production");
  let incident = (await rows("AiChatAlertIncident"))[0];
  assert.equal(incident.closedAt, null);
  assert.equal(incident.healthySince.toISOString(), now.toISOString());
  advance(policy.AI_CHAT_ALERT_WINDOW_MS - 1);
  await store.evaluateAlerts(db, "production");
  assert.equal(await deliverNext(), undefined);
  advance(1);
  await store.evaluateAlerts(db, "production");
  incident = (await rows("AiChatAlertIncident"))[0];
  assert.equal(incident.closedAt.toISOString(), now.toISOString());
  const recovered = await deliverNext();
  assert.equal(recovered.phase, "recovery");
  assert.equal(recovered.incidentId, initial.incidentId);
  assert.match(policy.alertMessage(recovered), /recovered for a full 15-minute window/);
  await breach();
  const subsequent = await deliverNext();
  assert.equal(subsequent.phase, "breach");
  assert.notEqual(subsequent.incidentId, initial.incidentId);
});

test("a new breach resets the recovery timer, including low-volume bad windows", async () => {
  await breach();
  advance(policy.AI_CHAT_ALERT_WINDOW_MS);
  await store.evaluateAlerts(db, "production");
  advance(60_000);
  await sample(500);
  assert.equal((await rows("AiChatAlertIncident"))[0].healthySince, null);
  advance(policy.AI_CHAT_ALERT_WINDOW_MS);
  await store.evaluateAlerts(db, "production");
  advance(policy.AI_CHAT_ALERT_WINDOW_MS - 1);
  await store.evaluateAlerts(db, "production");
  assert.equal((await rows("AiChatAlertIncident"))[0].closedAt, null);
});

test("recovery delivery retries independently without blocking a subsequent incident", async () => {
  await breach();
  await deliverNext();
  advance(policy.AI_CHAT_ALERT_WINDOW_MS);
  await store.evaluateAlerts(db, "production");
  advance(policy.AI_CHAT_ALERT_WINDOW_MS);
  await store.evaluateAlerts(db, "production");
  const recovery = await deliverNext(false);
  assert.equal(recovery.phase, "recovery");
  await breach();
  const subsequent = await deliverNext();
  assert.equal(subsequent.phase, "breach");
  assert.notEqual(subsequent.incidentId, recovery.incidentId);
  advance(60_000);
  const recoveryRetry = await deliverNext();
  assert.equal(recoveryRetry.id, recovery.id);
});

test("leases fence stale acknowledgements and killed attempts remain bounded", async () => {
  await breach();
  const stale = await store.claimDelivery(db, "production");
  assert.equal(await store.claimDelivery(db, "production"), undefined);
  advance(60_000);
  const current = await store.claimDelivery(db, "production");
  await store.finishDelivery(db, stale, true);
  assert.equal((await rows("AiChatAlertDelivery"))[0].status, "pending");
  assert.equal(current.attemptCount, 2);
  for (const delay of [120_000, 240_000]) {
    advance(delay - 1);
    assert.equal(await store.claimDelivery(db, "production"), undefined);
    advance(1);
    await store.claimDelivery(db, "production");
  }
  advance(240_000);
  assert.equal(await store.claimDelivery(db, "production"), undefined);
  assert.equal((await rows("AiChatAlertDelivery"))[0].status, "failed");
});

test("environments have independent windows, incidents and delivery queues", async () => {
  await breach("preview");
  await sample(200, 1000, "production");
  assert.equal(await deliverNext(true, "production"), undefined);
  const preview = await deliverNext(true, "preview");
  assert.equal(preview.environment, "preview");
  await breach("production");
  assert.equal((await rows("AiChatAlertIncident")).length, 2);
  assert.equal((await deliverNext()).environment, "production");
});

test("database constraints enforce one open incident and one delivery per phase", async () => {
  await breach();
  const incident = (await rows("AiChatAlertIncident"))[0];
  await assert.rejects(sql.query('INSERT INTO "AiChatAlertIncident" ("id", "environment", "kind") VALUES ($1, $2, $3)', ["duplicate", "production", "error_rate"]), /duplicate key/);
  const delivery = (await rows("AiChatAlertDelivery"))[0];
  await assert.rejects(sql.query('INSERT INTO "AiChatAlertDelivery" ("id", "incidentId", "phase", "requestCount", "errorCount", "p95Ms") VALUES ($1, $2, $3, 20, 2, 1000)', ["duplicate", incident.id, delivery.phase]), /duplicate key/);
  await assert.rejects(sql.query('UPDATE "AiChatAlertDelivery" SET "attemptCount" = 5'), /check constraint/);
});

test("retention deletes old samples and closed incidents but preserves open incidents", async () => {
  await breach();
  const old = (await rows("AiChatAlertIncident"))[0];
  advance(2 * policy.AI_CHAT_ALERT_WINDOW_MS);
  await store.evaluateAlerts(db, "production");
  advance(policy.AI_CHAT_ALERT_WINDOW_MS);
  await store.evaluateAlerts(db, "production");
  await breach();
  advance(8 * 24 * 60 * 60_000);
  await store.evaluateAlerts(db, "production");
  const incidents = await rows("AiChatAlertIncident");
  assert.equal(incidents.length, 1);
  assert.notEqual(incidents[0].id, old.id);
  assert.equal(incidents[0].closedAt, null);
  assert.equal((await rows("AiChatAlertSample")).length, 0);
});

test("schema is additive and alert tables accept metadata only", async () => {
  const statements = migration.split(";").map((entry) => entry.trim()).filter(Boolean);
  assert.equal(statements.every((entry) => /^CREATE (?:TABLE|(?:UNIQUE )?INDEX) /.test(entry)), true);
  assert.equal(/^CREATE (?:TABLE|(?:UNIQUE )?INDEX) /.test('DROP TABLE "Existing"'), false);
  const columns = (await sql.query(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name LIKE 'AiChatAlert%' ORDER BY table_name, ordinal_position`)).rows;
  const expected = {
    AiChatAlertSample: ["id", "environment", "happenedAt", "latencyMs", "statusCode"],
    AiChatAlertIncident: ["id", "environment", "kind", "openedAt", "healthySince", "closedAt"],
    AiChatAlertDelivery: ["id", "incidentId", "phase", "requestCount", "errorCount", "p95Ms", "happenedAt", "status", "attemptCount", "nextAttemptAt"],
  };
  for (const [table, names] of Object.entries(expected)) {
    assert.deepEqual(columns.filter((entry) => entry.table_name === table).map((entry) => entry.column_name), names);
  }
  for (const column of columns.filter((entry) => /At$|Since$/.test(entry.column_name))) {
    assert.equal(column.data_type, "timestamp with time zone");
  }
  assert.equal(columns.some((entry) => /json|bytea/.test(entry.data_type)), false);
});
