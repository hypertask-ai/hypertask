import assert from "node:assert/strict";
import test from "node:test";
import { activationHarness } from "./helpers/activation-harness";

// Every client is replaced before loading production telemetry modules.
process.env.POSTHOG_SERVER_PROJECT_TOKEN = "mock-local-only";

const events = ["board_created", "agent_connected", "agent_task_completed", "teammate_invited", "invite_accepted", "lifecycle_email_sent"];

test("fixed event contract uses the signup distinct id and arbitrary event properties", async () => {
  const h = activationHarness();
  const { trackActivation } = h.load("src/lib/telemetry/activationAnalytics.ts");
  for (const event of events) await trackActivation(123, event, { test: true, count: 2 });
  await h.drain();
  assert.deepEqual(h.captures, events.map((event) => ({ distinctId: "123", event, properties: { test: true, count: 2 } })));
});

test("guests, QA id, configured QA email, missing users and invalid ids are excluded", async () => {
  const h = activationHarness();
  h.users.set(50, { uid: "guest_demo", email: "guest@example.test" });
  h.users.set(985, { uid: "real_qa", email: "qa@example.test" });
  h.users.set(986, { uid: "real_qa2", email: "QA@EXAMPLE.TEST" });
  const oldQaEmail = process.env.QA_LOGIN_EMAIL;
  process.env.QA_LOGIN_EMAIL = " qa@example.test ";
  try {
    const { trackActivation } = h.load("src/lib/telemetry/activationAnalytics.ts");
    for (const id of [50, 985, 986, 999, 0, -1, NaN, 1.5]) await trackActivation(id, "board_created");
    await h.drain();
    assert.deepEqual(h.captures, []);
    await trackActivation(123, "board_created");
    await h.drain();
    assert.equal(h.captures.length, 1);
  } finally {
    if (oldQaEmail === undefined) delete process.env.QA_LOGIN_EMAIL;
    else process.env.QA_LOGIN_EMAIL = oldQaEmail;
  }
});

test("server flag OFF excludes events; ON includes a normal user", async () => {
  const h = activationHarness();
  const { trackActivation } = h.load("src/lib/telemetry/activationAnalytics.ts");
  h.setEnabled(false);
  await trackActivation(123, "board_created");
  await h.drain();
  assert.equal(h.captures.length, 0);
  h.setEnabled(true);
  await trackActivation(123, "board_created");
  await h.drain();
  assert.equal(h.captures.length, 1);
});

for (const failure of ["capture", "constructor", "database", "schedule"] as const) {
  test(`activation never rejects when ${failure} fails`, async () => {
    const h = activationHarness();
    h.setFailure(failure);
    const { trackActivation } = h.load("src/lib/telemetry/activationAnalytics.ts");
    await assert.doesNotReject(trackActivation(123, "board_created"));
    await assert.doesNotReject(h.drain());
  });
}

test("unconfigured telemetry is a silent no-op", async () => {
  const h = activationHarness();
  delete process.env.POSTHOG_SERVER_PROJECT_TOKEN;
  try {
    const { trackActivation } = h.load("src/lib/telemetry/activationAnalytics.ts");
    await trackActivation(123, "board_created");
    await h.drain();
    assert.deepEqual(h.captures, []);
  } finally {
    process.env.POSTHOG_SERVER_PROJECT_TOKEN = "mock-local-only";
  }
});

test("the request returns before database lookup and shared capture runs after lookup", async () => {
  const h = activationHarness();
  let release!: (value: unknown) => void;
  let lookupStarted!: () => void;
  const started = new Promise<void>((resolve) => { lookupStarted = resolve; });
  h.prisma.user.findUnique = () => new Promise((resolve) => { release = resolve; lookupStarted(); });
  const { trackActivation } = h.load("src/lib/telemetry/activationAnalytics.ts");
  await trackActivation(123, "board_created");
  assert.equal(h.captures.length, 0);
  await started;
  release({ uid: "real_member", email: "member@example.test" });
  await h.drain();
  assert.equal(h.captures.length, 1);
});

for (const job of ["occurrence", "connection"] as const) {
  const record = (h: ReturnType<typeof activationHarness>, occurrence = "retry") => {
    const api = h.load("src/lib/telemetry/activationOccurrences.ts");
    if (job === "connection") api.recordAgentConnection(123, occurrence, "mcp", "Cursor");
    else api.recordActivationOccurrence(123, "teammate_invited", occurrence, { method: "link" });
  };

  test(`${job}: failed capture leaves no marker and retry uses the same event UUID`, async () => {
    const h = activationHarness();
    h.setFailure("capture");
    record(h);
    await h.drain();
    assert.deepEqual(h.logs, []);
    assert.equal(h.prismaCalls.includes("logs.create"), false);
    assert.equal(h.captureAttempts.length, 1);
    const uuid = h.captureAttempts[0].uuid;
    assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    h.setFailure(null);
    record(h);
    await h.drain();
    assert.equal(h.captureAttempts[1].uuid, uuid);
    assert.equal(h.logs.length, 1);
    assert.equal(h.captures.length, 1);
    assert.ok(h.prismaCalls.indexOf("captureImmediate") < h.prismaCalls.indexOf("logs.create"));
    record(h);
    await h.drain();
    assert.equal(h.captureAttempts.length, 2, "successful occurrence is not captured again");
  });

  test(`${job}: unconfigured PostHog writes nothing and does not consume the occurrence`, async () => {
    const h = activationHarness();
    delete process.env.POSTHOG_SERVER_PROJECT_TOKEN;
    try {
      record(h);
      await h.drain();
      assert.deepEqual(h.logs, []);
      assert.deepEqual(h.captureAttempts, []);
      assert.equal(h.prismaCalls.includes("$transaction"), false);
    } finally {
      process.env.POSTHOG_SERVER_PROJECT_TOKEN = "mock-local-only";
    }
    record(h);
    await h.drain();
    assert.equal(h.captures.length, 1);
    assert.equal(h.logs.length, 1);
  });

  test(`${job}: capture succeeded but marker failed, so a cold retry retains the PostHog UUID`, async () => {
    const h = activationHarness();
    h.prisma.logs.create = async () => { throw Error("mock marker unavailable"); };
    record(h);
    await h.drain();
    assert.equal(h.captures.length, 1);
    assert.deepEqual(h.logs, []);
    const cold = activationHarness();
    record(cold);
    await cold.drain();
    assert.equal(cold.captureAttempts[0].uuid, h.captureAttempts[0].uuid);
    assert.equal(cold.logs.length, 1);
    record(cold, "different-occurrence");
    await cold.drain();
    assert.notEqual(cold.captureAttempts[1].uuid, cold.captureAttempts[0].uuid);
  });
}

test("the advisory lock covers capture and marker writes for concurrent cold connections", async () => {
  const h = activationHarness();
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const capturing = new Promise<void>((resolve) => { started = resolve; });
  const Client = h.mocks["posthog-node"].PostHog;
  h.mocks["posthog-node"].PostHog = class extends Client {
    constructor() {
      super();
      const capture = this.captureImmediate;
      this.captureImmediate = async (event: any) => { started(); await pending; await capture(event); };
    }
  };
  let locks = 0;
  h.prisma.$executeRaw = async (strings: TemplateStringsArray, userId: number) => {
    assert.equal(strings.join("?"), "SELECT pg_advisory_xact_lock(7034::int, ?::int)");
    assert.equal(userId, 123);
    locks++;
  };
  const first = h.load("src/lib/telemetry/activationOccurrences.ts");
  const second = h.load("tests/cold-activation.ts", require("node:fs").readFileSync("src/lib/telemetry/activationOccurrences.ts", "utf8").replaceAll('"./', '"@/lib/telemetry/'));
  first.recordAgentConnection(123, "concurrent-credential", "mcp");
  second.recordAgentConnection(123, "concurrent-credential", "mcp");
  await capturing;
  assert.deepEqual(h.logs, [], "marker cannot precede the pending capture");
  assert.equal(locks, 1, "the competing transaction waits for capture to finish");
  release();
  await h.drain();
  assert.equal(locks, 2);
  assert.equal(h.captures.length, 1);
  assert.equal(h.logs.length, 1);
});

test("signup and activation share the bounded immediate client and waitUntil", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync("src/lib/telemetry/signupAnalytics.ts", "utf8");
  assert.match(source, /CAPTURE_TIMEOUT_MS = 1500/);
  assert.match(source, /flushAt: 1/);
  assert.match(source, /flushInterval: 0/);
  assert.match(source, /requestTimeout: CAPTURE_TIMEOUT_MS/);
  assert.match(source, /waitUntil/);
});
