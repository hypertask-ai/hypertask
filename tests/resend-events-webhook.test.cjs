const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { Webhook } = require("svix");

const root = path.resolve(__dirname, "..");
let entryId = 0;

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/resend-events-jiti-${++entryId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
      cache: false,
    },
  );
  return jiti(path.join(root, relativePath));
}

const secret = `whsec_${crypto.randomBytes(32).toString("base64")}`;
const previousSecret = process.env.RESEND_EVENTS_WEBHOOK_SECRET;
process.env.RESEND_EVENTS_WEBHOOK_SECRET = secret;

test.after(() => {
  if (previousSecret === undefined)
    delete process.env.RESEND_EVENTS_WEBHOOK_SECRET;
  else process.env.RESEND_EVENTS_WEBHOOK_SECRET = previousSecret;
});

function signedRequest(event, signingSecret = secret) {
  const body = JSON.stringify(event);
  const id = "msg_resend_events_test";
  const timestamp = new Date();
  return new Request("https://example.invalid/api/webhooks/resend-events", {
    method: "POST",
    body,
    headers: {
      "svix-id": id,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "svix-signature": new Webhook(signingSecret).sign(id, timestamp, body),
    },
  });
}

function harness() {
  const { createResendEventsHandler } = loadTs(
    "src/lib/email/resendEventsWebhook.ts",
  );
  const { verifySvixPayload } = loadTs("src/lib/svixWebhook.ts");
  const logs = [];
  const handler = createResendEventsHandler({
    verify: (key, body, headers) =>
      verifySvixPayload(key, body, {
        "svix-id": headers.get("svix-id") ?? "",
        "svix-timestamp": headers.get("svix-timestamp") ?? "",
        "svix-signature": headers.get("svix-signature") ?? "",
      }),
    log: (...args) => logs.push(args),
  });
  return { handler, logs };
}

const privateFields = {
  to: ["recipient@example.com"],
  from: "sender@example.com",
  subject: "Private subject",
  email_id: "private-email-id",
};

function assertPrivateFieldsAbsent(logs) {
  const output = JSON.stringify(logs);
  for (const value of Object.values(privateFields).flat()) {
    assert.ok(!output.includes(value), `payload field leaked: ${value}`);
  }
}

test("real Svix signature accepts a bounce and logs exactly one single-string line", async () => {
  const { handler, logs } = harness();
  const response = await handler(signedRequest({
    type: "email.bounced",
    data: { ...privateFields, bounce: { type: "Permanent", subType: "General" } },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true });
  assert.deepEqual(logs, [["[email-event] email.bounced (Permanent, General)"]]);
  assertPrivateFieldsAbsent(logs);
});

test("wrong and missing Svix signatures return 400 without logging", async () => {
  const { handler, logs } = harness();
  const event = { type: "email.bounced", data: privateFields };
  const wrongKey = `whsec_${crypto.randomBytes(32).toString("base64")}`;
  for (const request of [
    signedRequest(event, wrongKey),
    new Request("https://example.invalid/api/webhooks/resend-events", {
      method: "POST",
      body: JSON.stringify(event),
    }),
  ]) {
    const response = await handler(request);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { received: false });
  }
  assert.deepEqual(logs, []);
});

test("unset signing key returns 503 and logs the configuration error before verification", async () => {
  const { createResendEventsHandler } = loadTs("src/lib/email/resendEventsWebhook.ts");
  const logs = [];
  const handler = createResendEventsHandler({
    verify: () => assert.fail("verification must not run without a key"),
    log: (...args) => logs.push(args),
  });
  delete process.env.RESEND_EVENTS_WEBHOOK_SECRET;
  try {
    const response = await handler(signedRequest({ type: "email.failed" }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { received: false });
    assert.deepEqual(logs, [["[email-event] webhook signing key is not configured"]]);
  } finally {
    process.env.RESEND_EVENTS_WEBHOOK_SECRET = secret;
  }
});

test("failed reasons redact every address, collapse whitespace, and cap the reason at 120 characters", async () => {
  const { handler, logs } = harness();
  const reason = `  Rejected recipient@example.com\n\tand other+tag@example.org   ${"x".repeat(150)}`;
  const response = await handler(signedRequest({
    type: "email.failed",
    data: { ...privateFields, failed: { reason } },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true });
  const expectedReason = `Rejected <email> and <email> ${"x".repeat(150)}`.slice(0, 120);
  assert.equal(expectedReason.length, 120);
  assert.deepEqual(logs, [[`[email-event] email.failed: ${expectedReason}`]]);
  assertPrivateFieldsAbsent(logs);
  assert.ok(!JSON.stringify(logs).includes("other+tag@example.org"));
});

test("the same failed cause groups together despite different addresses and whitespace", async () => {
  const { handler, logs } = harness();
  for (const reason of ["Mailbox for first@example.com rejected", "Mailbox\nfor second@example.org   rejected"]) {
    await handler(signedRequest({ type: "email.failed", data: { failed: { reason } } }));
  }
  assert.deepEqual(logs, Array(2).fill(["[email-event] email.failed: Mailbox for <email> rejected"]));
});

test("missing, empty and non-string failure fields fall back to unknown", async () => {
  const { handler, logs } = harness();
  for (const event of [
    { type: "email.bounced" },
    { type: "email.bounced", data: { bounce: { type: "", subType: 123 } } },
    { type: "email.failed" },
    { type: "email.failed", data: { failed: { reason: " \n " } } },
    { type: "email.failed", data: { failed: { reason: {} } } },
  ]) {
    const response = await handler(signedRequest(event));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: true });
  }
  assert.deepEqual(logs, [
    ["[email-event] email.bounced (unknown, unknown)"],
    ["[email-event] email.bounced (unknown, unknown)"],
    ["[email-event] email.failed: unknown"],
    ["[email-event] email.failed: unknown"],
    ["[email-event] email.failed: unknown"],
  ]);
});

test("delivered and other verified event types are acknowledged without logging", async () => {
  const { handler, logs } = harness();
  for (const type of ["email.delivered", "email.sent", "unknown.event"]) {
    const response = await handler(signedRequest({ type, data: privateFields }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: true });
  }
  assert.deepEqual(logs, []);
});

test("production route verifies real signatures and logs using console.error", async () => {
  const { POST } = loadTs("src/app/api/webhooks/resend-events/route.ts");
  const logs = [];
  const previousError = console.error;
  console.error = (...args) => logs.push(args);
  try {
    const response = await POST(signedRequest({
      type: "email.failed",
      data: { ...privateFields, failed: { reason: "Blocked recipient@example.com" } },
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: true });
  } finally {
    console.error = previousError;
  }
  assert.deepEqual(logs, [["[email-event] email.failed: Blocked <email>"]]);
  assertPrivateFieldsAbsent(logs);
});
