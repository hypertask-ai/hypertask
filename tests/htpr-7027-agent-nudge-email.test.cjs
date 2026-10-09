const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadTs: load } = require("./slack-app-fixtures.cjs");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const key = "htpr-7027-agent-nudge-email";
const modulePath = "src/lib/onboarding/emails/agentNudge.ts";
const queuePath = "src/pages/api/queues/agentNudgeEmailQueue.ts";
const delay = 24 * 60 * 60 * 1000;
process.env.SESSION_SECRET = "agent-nudge-test-only-signing-secret";
test.beforeEach((context) => context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-12T12:00:00Z") }));

function harness() {
  const user = { id: 3001, uid: "email_test", email: "new@yopmail.com", joinedAt: new Date("2026-10-09T00:00:00Z"), emailVerified: true, UserSetting: { notification: true, notificationPreference: "all", isVerified: true } };
  const state = { user, connection: null, enabled: true, qaEnabled: true, failSend: false, failPublish: false, failAudit: false, failMarker: false, failFlag: false, failUser: false, failConnection: false, now: 0 };
  const values = new Map(), expiries = new Map();
  const sends = [], jobs = [], logs = [], queries = [], connectionReads = [], redisCalls = [], flagReads = [], errors = [], events = [];
  const expire = (key_) => {
    if (expiries.has(key_) && expiries.get(key_) <= state.now) { values.delete(key_); expiries.delete(key_); }
  };
  const redis = {
    get: async (key_) => { expire(key_); return values.get(key_) ?? null; },
    set: async (...args) => {
      redisCalls.push(args);
      const [key_, value, ...options] = args;
      events.push(`redis:${key_}`);
      if (state.failMarker && key_.startsWith("onboarding:nudge-sent:")) throw new Error("Marker unavailable");
      expire(key_);
      if (options.includes("NX") && values.has(key_)) return null;
      values.set(key_, value);
      if (options.includes("EX")) expiries.set(key_, state.now + options[options.indexOf("EX") + 1]);
      else expiries.delete(key_);
      return "OK";
    },
    del: async (key_) => { redisCalls.push(["del", key_]); expiries.delete(key_); return values.delete(key_); },
  };
  const prisma = {
    user: { findUnique: async () => { if (state.failUser) throw new Error("DB unavailable"); return state.user; } },
    logs: {
      findFirst: async (query) => {
        queries.push(query);
        const { where } = query;
        assert.equal(where.log, "agent_nudge_email_sent");
        return logs.find((row) => row.LoggedById === where.LoggedById && row.log === where.log) ?? null;
      },
      create: async ({ data }) => { events.push(`log:${data.log}`); if (state.failAudit) throw new Error("Audit unavailable"); logs.push(data); return data; },
    },
  };
  const mocks = {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/onboarding/agentConnection": { getFirstAgentConnection: async (...args) => { connectionReads.push(args); if (state.failConnection) throw new Error("Connection unavailable"); return state.connection; } },
    "@/lib/redis": { getRedis: async () => redis },
    "@/lib/auth/requestBaseUrl": { fallbackBaseUrl: () => "https://app.hypertask.ai/" },
    "@/lib/flags": { FEATURE_FLAG_QA_USER_ID: 985, isFeatureEnabled: async (flag, id) => { flagReads.push([flag, id]); if (state.failFlag) throw new Error("Flag unavailable"); return id === 985 ? state.qaEnabled : state.enabled; } },
    "@/lib/email/sendEmail": { sendEmail: async (options) => { sends.push(options); if (state.failSend) throw new Error("Provider unavailable"); return { id: "mail-1" }; } },
    "@/lib/qstash": { publishJob: async (job) => { events.push("publish"); jobs.push(job); if (state.failPublish) throw new Error("QStash unavailable"); return { messageId: "job-1" }; }, withQstashSignature: (fn) => fn },
  };
  const nudge = load(modulePath, mocks);
  const queue = load(queuePath, { ...mocks, "@/lib/onboarding/emails/agentNudge": nudge });
  async function quiet(fn) {
    const original = console.error;
    console.error = (...args) => errors.push(args);
    try { return await fn(); } finally { console.error = original; }
  }
  async function receive(body = { userId: 3001 }, method = "POST") {
    const response = { code: null, body: null, headers: {}, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.code = code; return this; }, json(body_) { this.body = body_; return this; } };
    await quiet(() => queue.default({ method, body }, response));
    return response;
  }
  return { state, values, expiries, sends, jobs, logs, queries, connectionReads, redisCalls, flagReads, errors, events, mocks, receive, schedule: () => quiet(() => nudge.maybeScheduleAgentNudge(3001)) };
}

for (const [name, change, reason] of [
  ["flag off", (h) => { h.state.enabled = false; }, "flag_off"],
  ["pre-cohort", (h) => { h.state.user.joinedAt = new Date("2026-10-08T23:59:59Z"); }, "pre_cohort"],
  ["guest", (h) => { h.state.user.uid = "guest_test"; }, "guest"],
  ["service", (h) => { h.state.user.uid = "service_test"; }, "service_identity"],
  ["agent", (h) => { h.state.user.uid = "agent_test"; }, "service_identity"],
  ["bot", (h) => { h.state.user.uid = "bot_test"; }, "service_identity"],
  ["missing user", (h) => { h.state.user = null; }, "missing_user"],
  ["already scheduled", (h) => { h.values.set("onboarding:nudge-scheduled:3001", "claimed"); }, "already_scheduled"],
]) {
  test(`schedule: ${name} never publishes`, async () => {
    const h = harness(); change(h);
    assert.equal(await h.schedule(), reason);
    assert.equal(h.jobs.length, 0); assert.equal(h.sends.length, 0); assert.equal(h.errors.length, 0);
  });
}

test("schedule: normal signup uses joinedAt plus 24h, expiring lease then durable marker and one job for concurrent logins", async () => {
  const h = harness(); h.state.user.joinedAt = new Date("2026-10-09T12:34:56.789Z");
  assert.deepEqual((await Promise.all([h.schedule(), h.schedule()])).sort(), ["already_scheduling", "scheduled"]);
  assert.deepEqual(h.jobs, [{ path: "/api/queues/agentNudgeEmailQueue", body: { userId: 3001 }, notBefore: Math.ceil((h.state.user.joinedAt.getTime() + delay) / 1000) }]);
  assert.deepEqual(h.redisCalls[0].slice(2), ["EX", 600, "NX"]);
  assert.equal(h.redisCalls[0][0], "onboarding:nudge-scheduling:3001");
  assert.equal(h.redisCalls.at(-1)[0], "onboarding:nudge-scheduled:3001");
  assert.equal(h.redisCalls.at(-1).length, 2);
  assert.equal(h.expiries.has("onboarding:nudge-scheduled:3001"), false);
  assert.ok(h.events.indexOf("redis:onboarding:nudge-scheduled:3001") > h.events.indexOf("publish"));
  h.state.now = 600;
  assert.equal(await h.schedule(), "already_scheduled");
  assert.equal(h.jobs.length, 1);
  assert.deepEqual(h.flagReads, [[key, 3001], [key, 3001], [key, 3001]]);
});

test("schedule: durable marker stays absent while publication is in flight", async () => {
  const h = harness();
  let release, started;
  const publishing = new Promise((resolve) => { started = resolve; });
  const published = new Promise((resolve) => { release = resolve; });
  h.mocks["@/lib/qstash"].publishJob = async (job) => { h.jobs.push(job); started(); await published; };
  const attempt = h.schedule();
  await publishing;
  assert.equal(h.values.has("onboarding:nudge-scheduling:3001"), true);
  assert.equal(h.expiries.get("onboarding:nudge-scheduling:3001"), 600);
  assert.equal(h.values.has("onboarding:nudge-scheduled:3001"), false);
  assert.equal(await h.schedule(), "already_scheduling");
  release();
  assert.equal(await attempt, "scheduled");
  assert.equal(h.values.has("onboarding:nudge-scheduled:3001"), true);
  assert.equal(h.jobs.length, 1);
});

test("schedule: a crash before publication leaves only a lease that lets a later sign-in retry", async () => {
  const h = harness();
  h.values.set("onboarding:nudge-scheduling:3001", "interrupted");
  h.expiries.set("onboarding:nudge-scheduling:3001", 600);
  h.state.now = 599;
  assert.equal(await h.schedule(), "already_scheduling");
  assert.equal(h.jobs.length, 0);
  assert.equal(h.values.has("onboarding:nudge-scheduled:3001"), false);
  h.state.now = 600;
  assert.equal(await h.schedule(), "scheduled");
  assert.equal(h.jobs.length, 1);
  assert.equal(h.values.has("onboarding:nudge-scheduled:3001"), true);
  assert.equal(h.expiries.has("onboarding:nudge-scheduled:3001"), false);
});

for (const qaEnabled of [true, false]) {
  test(`schedule: armed QA uses its own ${qaEnabled ? "enabled" : "disabled"} flag and 120s delay`, async () => {
    const h = harness(); h.state.enabled = false; h.state.qaEnabled = qaEnabled; h.state.user.email = " NEW@MAIL.TM ";
    h.values.set("onboarding:qa-armed:new@mail.tm", "1");
    const before = Date.now();
    assert.equal(await h.schedule(), qaEnabled ? "scheduled" : "flag_off");
    assert.deepEqual(h.flagReads, [[key, 985]]);
    if (qaEnabled) {
      assert.ok(h.jobs[0].notBefore >= (before + 120000) / 1000);
      assert.ok(h.jobs[0].notBefore <= Math.ceil((Date.now() + 120000) / 1000));
    } else assert.equal(h.jobs.length, 0);
  });
}

test("schedule: publish failure releases lease for a later sign-in and never writes a durable marker", async () => {
  const h = harness(); h.state.failPublish = true;
  assert.equal(await h.schedule(), "failed");
  assert.equal(h.values.has("onboarding:nudge-scheduled:3001"), false);
  assert.equal(h.values.has("onboarding:nudge-scheduling:3001"), false);
  assert.deepEqual(h.redisCalls.at(-1), ["del", "onboarding:nudge-scheduling:3001"]);
  h.state.failPublish = false;
  assert.equal(await h.schedule(), "scheduled");
});

for (const failure of ["failUser", "failFlag"]) {
  test(`schedule: ${failure} cannot break auth or publish`, async () => {
    const h = harness(); h.state[failure] = true;
    assert.equal(await h.schedule(), "failed"); assert.equal(h.jobs.length, 0); assert.equal(h.sends.length, 0);
  });
}

for (const [name, change, reason] of [
  ["flag off", (h) => { h.state.enabled = false; }, "flag_off"],
  ["pre-cohort", (h) => { h.state.user.joinedAt = new Date("2026-10-08T23:59:59Z"); }, "pre_cohort"],
  ["guest", (h) => { h.state.user.uid = "guest_test"; }, "guest"],
  ["service", (h) => { h.state.user.uid = "service_test"; }, "service_identity"],
  ["unverified", (h) => { h.state.user.emailVerified = false; h.state.user.UserSetting.isVerified = false; }, "unverified_email"],
  ["missing email", (h) => { h.state.user.email = ""; }, "unverified_email"],
  ["unsubscribed", (h) => { h.state.user.UserSetting.notification = false; }, "notifications_off"],
  ["preference nothing", (h) => { h.state.user.UserSetting.notificationPreference = "nothing"; }, "notifications_off"],
  ["missing settings", (h) => { h.state.user.UserSetting = null; }, "notifications_off"],
  ["durable already-sent audit", (h) => { h.logs.push({ LoggedById: 3001, log: "agent_nudge_email_sent" }); }, "already_sent"],
  ["durable already-sent marker", (h) => { h.values.set("onboarding:nudge-sent:3001", "sent"); }, "already_sent"],
]) {
  test(`receiver: ${name} is a logged 2xx skip without a send`, async () => {
    const h = harness(); change(h);
    const result = await h.receive();
    assert.equal(result.code, 200); assert.equal(result.body.reason, reason); assert.equal(result.body.sent, false);
    assert.equal(h.logs.at(-1).log, `agent_nudge_email_skipped:${reason}`);
    assert.equal(h.sends.length, 0); assert.equal(h.jobs.length, 0); assert.equal(h.errors.length, 0);
  });
}

for (const client of ["Hypertask CLI", "Your MCP agent", "Cursor"]) {
  test(`receiver: shared all-history ${client} connection skips without a cutoff`, async () => {
    const h = harness(); h.state.connection = { at: new Date("2020-01-01"), client };
    const result = await h.receive();
    assert.equal(result.code, 200); assert.equal(result.body.reason, "agent_connected"); assert.equal(h.sends.length, 0);
    assert.equal(h.logs.at(-1).log, "agent_nudge_email_skipped:agent_connected");
    assert.deepEqual(h.connectionReads, [[3001]]);
    assert.deepEqual(h.queries, []);
  });
}

test("receiver: early non-armed delivery republishes at signup plus 24h and never claims a send", async () => {
  const h = harness(); h.state.user.joinedAt = new Date(Date.now() - 1000);
  const result = await h.receive();
  assert.equal(result.code, 200); assert.equal(result.body.reason, "too_early"); assert.equal(h.sends.length, 0);
  assert.equal(h.values.has("onboarding:nudge:3001"), false);
  assert.deepEqual(h.jobs, [{ path: "/api/queues/agentNudgeEmailQueue", body: { userId: 3001 }, notBefore: Math.ceil((h.state.user.joinedAt.getTime() + delay) / 1000) }]);
  h.state.failPublish = true;
  assert.equal((await h.receive()).code, 500);
});

for (const qaEnabled of [true, false]) {
  test(`receiver: armed QA rechecks nudge flag ${qaEnabled ? "on" : "off"} and can bypass 24h only when on`, async () => {
    const h = harness(); h.state.enabled = false; h.state.qaEnabled = qaEnabled;
    h.state.user.joinedAt = new Date(); h.state.user.email = " NEW@MAIL.TM ";
    h.values.set("onboarding:qa-armed:new@mail.tm", "1");
    const result = await h.receive();
    assert.equal(result.code, 200); assert.equal(result.body.reason, qaEnabled ? "sent" : "flag_off");
    assert.deepEqual(h.flagReads, [[key, 985]]); assert.equal(h.sends.length, Number(qaEnabled));
  });
}

test("QA arming never overrides consent, cohort, connection, sent audit or marker", async () => {
  for (const change of [
    (h) => { h.state.user.UserSetting.notification = false; },
    (h) => { h.state.user.joinedAt = new Date("2026-10-08"); },
    (h) => { h.state.connection = { at: new Date(), client: "Your MCP agent" }; },
    (h) => { h.logs.push({ LoggedById: 3001, log: "agent_nudge_email_sent" }); },
    (h) => { h.values.set("onboarding:nudge-sent:3001", "sent"); },
  ]) {
    const h = harness(); h.state.enabled = false; h.values.set("onboarding:qa-armed:new@yopmail.com", "1"); change(h);
    assert.notEqual((await h.receive()).body.reason, "sent"); assert.equal(h.sends.length, 0);
  }
});

test("receiver: success sends exact content, shared command, MCP CTA, unsubscribe and lifetime dedupe", async () => {
  const h = harness();
  assert.equal(h.state.connection, null);
  assert.equal((await h.receive()).body.reason, "sent");
  assert.deepEqual(h.connectionReads, [[3001]]);
  assert.deepEqual(h.queries, [{ where: { LoggedById: 3001, log: "agent_nudge_email_sent" } }]);
  const mail = h.sends[0];
  const { MCP_ADD_COMMAND } = load("src/lib/onboarding/installCommands.ts");
  assert.equal(mail.subject, "Your agents can't see your board yet");
  for (const text of ["Connect an agent to your board", "Connecting Claude Code, Cursor or any MCP client takes one command:", MCP_ADD_COMMAND, "Hypertask confirms the connection as soon as your agent says hello. Then ask it to pick up the top task on your board.", "Connect an agent: https://app.hypertask.ai/settings/mcp", "Unsubscribe: https://app.hypertask.ai/api/notifications/unsubscribe?token="]) assert.ok(mail.text.includes(text), text);
  assert.ok(mail.html.includes(MCP_ADD_COMMAND)); assert.match(mail.html, /href="https:\/\/app.hypertask.ai\/settings\/mcp"/);
  assert.match(mail.html, />Unsubscribe<\/a>/); assert.equal(mail.to, "new@yopmail.com");
  assert.equal(mail.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.match(mail.headers["List-Unsubscribe"], /^<https:\/\/app.hypertask.ai\/api\/notifications\/unsubscribe\?token=.+>$/);
  assert.equal(mail.idempotencyKey, "htpr-7027/user/3001");
  assert.deepEqual(h.redisCalls[0].slice(2), ["EX", 600, "NX"]); assert.equal(h.redisCalls[0][0], "onboarding:nudge:3001");
  assert.equal(h.redisCalls[1][0], "onboarding:nudge-sent:3001"); assert.equal(h.redisCalls[1].length, 2);
  assert.ok(h.values.get("onboarding:nudge-sent:3001"));
  assert.deepEqual(h.logs.at(-1), { log: "agent_nudge_email_sent", type: "Signup", status: "Normal", LoggedById: 3001 });
  h.state.now = 86400; assert.equal((await h.receive()).body.reason, "already_sent");
  h.values.clear(); assert.equal((await h.receive()).body.reason, "already_sent"); assert.equal(h.sends.length, 1);
  assert.match(read("src/components/Modals/Settings/settingsNavigation.ts"), /defaultSection: "mcp"/);
  const navigation = load("src/components/Modals/Settings/settingsNavigation.ts", {
    "@/lib/state": {}, "@/store": {}, "@/lib/demo/isGuestClient": {}, "@/lib/searchArchive": {},
    "@/utils/api/global/apiHelpers/getAllProjectsMinimal": {},
  });
  assert.equal(navigation.getSettingsPath("mcp"), "/settings/mcp");
});

test("receiver: the exact 24h boundary is enforced even with fractional signup seconds", async (context) => {
  const h = harness(); h.state.user.joinedAt = new Date("2026-10-09T12:34:56.789Z");
  const due = h.state.user.joinedAt.getTime() + delay;
  context.mock.timers.setTime(due - 1);
  assert.equal((await h.receive()).body.reason, "too_early"); assert.equal(h.sends.length, 0);
  assert.equal(h.jobs[0].notBefore, Math.ceil(due / 1000));
  context.mock.timers.setTime(due);
  assert.equal((await h.receive()).body.reason, "sent"); assert.equal(h.sends.length, 1);
});

test("receiver: reloads consent and connections after scheduling, and expired QA arming cannot accelerate", async () => {
  for (const [change, reason] of [
    [(h) => { h.state.user.UserSetting.notification = false; }, "notifications_off"],
    [(h) => { h.state.connection = { at: new Date(), client: "Your MCP agent" }; }, "agent_connected"],
    [(h) => { h.state.enabled = false; }, "flag_off"],
  ]) {
    const h = harness(); assert.equal(await h.schedule(), "scheduled"); change(h);
    assert.equal((await h.receive()).body.reason, reason); assert.equal(h.sends.length, 0);
  }
  const h = harness(); h.state.user.joinedAt = new Date();
  h.values.set("onboarding:qa-armed:new@yopmail.com", "1"); assert.equal(await h.schedule(), "scheduled");
  h.values.delete("onboarding:qa-armed:new@yopmail.com");
  assert.equal((await h.receive()).body.reason, "too_early"); assert.equal(h.sends.length, 0);
  assert.deepEqual(h.flagReads, [[key, 985], [key, 3001]]);
});

test("receiver: concurrent jobs send once", async () => {
  const h = harness();
  const results = await Promise.all([h.receive(), h.receive()]);
  assert.deepEqual(results.map((r) => r.body.reason).sort(), ["already_claimed", "sent"]);
  assert.deepEqual(results.map((r) => r.code).sort(), [200, 503]); assert.equal(h.sends.length, 1);
});

test("receiver: send failure is 5xx, releases claim and retry uses the same idempotency key", async () => {
  const h = harness(); h.state.failSend = true;
  assert.equal((await h.receive()).code, 500); assert.equal(h.values.has("onboarding:nudge:3001"), false);
  assert.deepEqual(h.redisCalls.at(-1), ["del", "onboarding:nudge:3001"]);
  assert.equal(h.logs.some((row) => row.log === "agent_nudge_email_sent"), false);
  h.state.failSend = false;
  assert.equal((await h.receive()).body.reason, "sent"); assert.equal(h.sends[0].idempotencyKey, h.sends[1].idempotencyKey);
});

test("receiver: accepted send retains durable marker through audit outage and lease expiry", async () => {
  const h = harness(); h.state.failAudit = true;
  const response = await h.receive();
  assert.equal(response.code, 200); assert.equal(response.body.reason, "sent");
  assert.equal(h.values.has("onboarding:nudge-sent:3001"), true);
  assert.match(h.errors[0][0], /sent audit failed/);
  h.state.failAudit = false; h.state.now = 600;
  assert.equal((await h.receive()).body.reason, "already_sent"); assert.equal(h.sends.length, 1);
});

test("receiver: sent marker outage preserves the success audit without retrying an accepted send", async () => {
  const h = harness(); h.state.failMarker = true;
  const response = await h.receive();
  assert.equal(response.code, 200); assert.equal(response.body.reason, "sent");
  assert.equal(h.values.has("onboarding:nudge-sent:3001"), false);
  assert.deepEqual(h.logs, [{ log: "agent_nudge_email_sent", type: "Signup", status: "Normal", LoggedById: 3001 }]);
  assert.deepEqual(h.events.slice(-2), ["log:agent_nudge_email_sent", "redis:onboarding:nudge-sent:3001"]);
  assert.match(h.errors[0][0], /sent marker failed/);
  h.state.now = 600;
  assert.equal((await h.receive()).body.reason, "already_sent"); assert.equal(h.sends.length, 1);
});

test("receiver: abandoned in-flight claim expires after 600 seconds", async () => {
  const h = harness();
  h.values.set("onboarding:nudge:3001", "interrupted"); h.expiries.set("onboarding:nudge:3001", 600);
  h.state.now = 599;
  const held = await h.receive();
  assert.equal(held.code, 503); assert.deepEqual(held.body, { ok: false, sent: false, reason: "already_claimed" });
  assert.deepEqual(h.logs, []);
  assert.equal(h.sends.length, 0);
  h.state.now = 600; assert.equal((await h.receive()).body.reason, "sent");
  assert.equal(h.sends.length, 1);
});

test("receiver: missing user skips, infrastructure failures retry and malformed jobs never send", async () => {
  const missing = harness(); missing.state.user = null;
  assert.equal((await missing.receive()).body.reason, "missing_user"); assert.equal(missing.sends.length, 0);
  for (const failure of ["failUser", "failFlag", "failConnection"]) { const h = harness(); h.state[failure] = true; assert.equal((await h.receive()).code, 500); assert.equal(h.sends.length, 0); }
  const h = harness();
  for (const body of [null, {}, { userId: "3001" }, { userId: -1 }, { userId: 0 }, { userId: 1.5 }, { userId: Infinity }, { userId: Number.MAX_SAFE_INTEGER + 1 }]) assert.equal((await h.receive(body)).code, 400);
  const get = await h.receive({ userId: 3001 }, "GET"); assert.equal(get.code, 405); assert.equal(get.headers.Allow, "POST");
  assert.equal(h.sends.length, 0);
});

test("queue exports only the signature-wrapped receiver with raw body parsing disabled", () => {
  let wrapped = false;
  const sentinel = () => {};
  const route = load(queuePath, { "@/lib/onboarding/emails/agentNudge": {}, "@/lib/qstash": { withQstashSignature: (handler) => { assert.equal(typeof handler, "function"); wrapped = true; return sentinel; } } });
  assert.ok(wrapped); assert.equal(route.default, sentinel); assert.deepEqual(route.config, { api: { bodyParser: false } });
});

test("shared onboarding layout escapes content and URLs without changing the text alternative", () => {
  const { renderOnboardingEmail } = load("src/lib/onboarding/emails/layout.ts");
  const raw = '<script>"&\'</script>';
  const mail = renderOnboardingEmail({ subject: raw, heading: raw, paragraphs: [raw], code: raw, cta: { label: raw, url: 'https://example.test/?a="&b=1' }, unsubscribeUrl: 'https://example.test/?u="&v=1' });
  assert.ok(!mail.html.toLowerCase().includes("<script")); assert.ok(mail.html.includes("&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;"));
  assert.ok(mail.html.includes('href="https://example.test/?a=&quot;&amp;b=1"')); assert.ok(mail.html.includes('href="https://example.test/?u=&quot;&amp;v=1"'));
  assert.equal(mail.subject, raw); assert.ok(mail.text.includes(raw));
});

test("legacy auth hooks schedule nudge once, with waitUntil after successful cookie construction", () => {
  for (const route of ["verify-code", "verify-email-token"]) {
    const source = read(`src/app/api/auth/${route}/route.ts`);
    const hook = source.indexOf("waitUntil(maybeScheduleAgentNudge(userData!.id))");
    assert.ok(hook > source.indexOf("signSession({ id: userData!.id"));
    assert.ok(hook > source.indexOf("seedResponseThemeCookie(request, response)"));
    assert.ok(hook < source.indexOf("} catch (cookieError)"));
    assert.ok(hook < source.indexOf("    return response"));
    const welcome = source.indexOf("waitUntil(maybeSendWelcomeEmail(userData!.id, { boardId: welcomeBoardId }))");
    const provision = source.indexOf("const onboardingResult = await provisionFirstWorkspace(");
    assert.ok(provision > 0 && welcome > provision && hook > welcome);
    assert.equal(source.split("waitUntil(maybeScheduleAgentNudge").length, 2);
  }
});

test("native auth schedules only real successful sign-ins after cookies, not bridges or refreshes", async () => {
  const signIns = ["/callback/google", "/magic-link/verify", "/sign-in/email-otp", "/sign-in/email", "/sign-in/social", "/passkey/verify-authentication"];
  for (const endpoint of [...signIns, "/bridge-legacy-session", "/bridge", "/get-session", "/demo-session"]) {
    const events = [];
    let userFound = true;
    const pluginModule = load("src/lib/auth/legacyCookiePlugin.ts", {
      "@/lib/flags": { HTPR_7030_GOOGLE_SIGNUP_STARTER_BOARD_FLAG: "htpr-7030-google-signup-starter-board", isFeatureEnabled: async () => true },
      "@/lib/constants/constants": { companySizeOptions: ["Just me"], companyRoleOptions: ["Founder"] },
      "@/utils/controllers/users/provisionFirstWorkspace": { provisionFirstWorkspace: async () => { await Promise.resolve(); events.push("provisioned"); } },
      "better-auth/api": { createAuthEndpoint: () => ({}), createAuthMiddleware: (fn) => fn },
      "@/lib/prisma": { __esModule: true, default: { user: { findUnique: async () => userFound ? { id: 3001, email: "new@yopmail.com" } : null } } },
      "@/lib/auth/session": { SESSION_COOKIE: "ht_session", SESSION_TTL_SECONDS: 10, sessionCookieOptions: () => ({}), signSession: () => "signed" },
      "@/lib/auth/slimUserCookie": { slimUserForCookie: (user) => user },
      "@/lib/configs/auth.config": { __esModule: true, default: { cookies: { theme: "theme" } } },
      "@/lib/auth/themeCookie": { getThemeCookieOptions: () => ({}) },
      "@/lib/themePreferences": { themeCookieSeedValue: () => null },
      "@/utils/controllers/demo/adoptGuestBoards": { adoptGuestBoards: async () => events.push("adopt") },
      "@/utils/controllers/demo/resolveLoginBoard": { resolveLoginBoard: async () => undefined },
      "@/lib/onboarding/emails/welcome": { maybeSendWelcomeEmail: async () => events.push("welcome") },
      "@/lib/onboarding/emails/agentNudge": { maybeScheduleAgentNudge: async (id) => { assert.equal(id, 3001); events.push("nudge"); } },
      "@vercel/functions": { waitUntil: () => events.push("waitUntil") },
    });
    const plugin = pluginModule.legacyCookiePlugin();
    const request = new Request(`https://app.hypertask.ai/api/auth${endpoint}`);
    if (endpoint === "/callback/google") pluginModule.newGoogleSignupRequests.set(request, 3001);
    const ctx = { path: endpoint, request, context: { newSession: { user: { id: "3001" } } }, getCookie: () => "existing", setCookie: (name) => events.push(name) };
    await plugin.hooks.after[0].handler(ctx);
    assert.equal(events.includes("nudge"), signIns.includes(endpoint), endpoint);
    if (signIns.includes(endpoint)) {
      assert.ok(events.indexOf("nudge") > events.indexOf("ht_session"));
      assert.ok(events.indexOf("welcome") > events.indexOf("signup_source"));
      assert.ok(events.indexOf("nudge") > events.indexOf("welcome"));
      assert.equal(events.filter((e) => e === "nudge").length, 1);
    }
    if (endpoint === "/callback/google") {
      assert.ok(events.indexOf("provisioned") >= 0);
      assert.ok(events.indexOf("adopt") > events.indexOf("provisioned"));
      assert.ok(events.indexOf("ht_session") > events.indexOf("adopt"));
    }
    events.length = 0; await plugin.hooks.after[0].handler({ path: endpoint, context: {} }); assert.deepEqual(events, []);
    userFound = false;
    await plugin.hooks.after[0].handler(ctx);
    assert.deepEqual(events, ["adopt"]);
  }
});

test("QA arm reuses endpoint with nudge flag independently of welcome, maintaining identity/origin/new inbox guards", async () => {
  const values = [], flags = [], userQueries = [];
  const state = { id: 985, email: "valentin@hypertask.ai", enabled: true, existingEmail: "Existing@MAIL.TM" };
  const { POST } = load("src/app/api/onboarding/emails/qa-arm/route.ts", {
    "@/lib/auth/getSessionUser": { getSessionUser: async () => state.id ? { userId: state.id } : null },
    "@/lib/prisma": { __esModule: true, default: { user: {
      findUnique: async () => ({ email: state.email }),
      findFirst: async (query) => {
        userQueries.push(query);
        assert.equal(query.where.email.mode, "insensitive");
        return query.where.email.equals.toLowerCase() === state.existingEmail.toLowerCase() ? { id: 3001 } : null;
      },
    } } },
    "@/lib/flags": { FEATURE_FLAG_QA_USER: { userId: 985, email: "valentin@hypertask.ai" }, isFeatureEnabled: async (flag, id) => { flags.push([flag, id]); return flag === key && state.enabled; } },
    "@/lib/redis": { getRedis: async () => ({ set: async (...args) => values.push(args) }) },
  });
  const request = (email = "qa@yopmail.com", type = "agent_nudge", origin = "https://app.hypertask.ai") => new NextRequest("https://app.hypertask.ai/api/onboarding/emails/qa-arm", { method: "POST", headers: { host: "app.hypertask.ai", ...(origin ? { origin } : {}), "Content-Type": "application/json" }, body: JSON.stringify({ email, type }) });
  for (const id of [null, 6, 3001]) { state.id = id; assert.equal((await POST(request())).status, 403); }
  state.id = 985; state.email = "other@example.test"; assert.equal((await POST(request())).status, 403);
  state.email = "valentin@hypertask.ai"; state.enabled = false; assert.equal((await POST(request())).status, 403); state.enabled = true;
  for (const origin of [null, "https://evil.test", "http://app.hypertask.ai"]) assert.equal((await POST(request(undefined, undefined, origin))).status, 403);
  for (const email of ["a@b@mail.tm", "@mail.tm", "a b@mail.tm", "qa@localhost", "a".repeat(313) + "@mail.tm", null]) assert.equal((await POST(request(email))).status, 400);
  assert.equal((await POST(request(undefined, "anything"))).status, 400); assert.deepEqual(values, []);
  assert.deepEqual(userQueries, []);
  assert.equal((await POST(request(" EXISTING@mail.tm "))).status, 409);
  assert.deepEqual(userQueries[0], { where: { email: { equals: "existing@mail.tm", mode: "insensitive" } }, select: { id: true } });
  assert.deepEqual(values, []);
  for (const email of [" QA@MAIL.TM ", "qa@example.com", "qa@yopmail.com", "a".repeat(312) + "@mail.tm"]) {
    assert.equal((await POST(request(email))).status, 200);
    assert.deepEqual(values.at(-1), [`onboarding:qa-armed:${email.trim().toLowerCase()}`, "1", "EX", 7200]);
  }
  assert.ok(flags.every(([flag, id]) => flag === key && id === 985));
});

test("nudge is registered as a feature with Owner + QA default, server-gated with OFF respected and exact follow-up markers", async () => {
  let row = null;
  const registry = load("src/lib/flags.ts", {
    "@/lib/prisma": { __esModule: true, default: { featureFlag: { findUnique: async () => row, findMany: async () => [] }, user: { findUnique: async ({ where }) => ({ email: where.id === 985 ? "valentin@hypertask.ai" : "new@yopmail.com" }) } } },
    "@/lib/auth/getSessionUser": {},
    "@/lib/agentRuns/model": { AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG: "htpr-6406-agent-chat-stop-and-timeout" },
  });
  assert.equal(registry.HTPR_7027_AGENT_NUDGE_EMAIL_FLAG, key); assert.equal(registry.defaultFeatureFlagMode(key), "OWNER_AND_QA");
  assert.equal((await registry.listFeatureFlagModes()).find((entry) => entry.key === key).kind, "feature");
  assert.equal(await registry.isFeatureEnabled(key, 3001), false); assert.equal(await registry.isFeatureEnabled(key, 985), true);
  row = { mode: "OFF" }; assert.equal(await registry.isFeatureEnabled(key, 985), false);
  const source = read(modulePath);
  assert.match(source, /import \{ getFirstAgentConnection \} from "@\/lib\/onboarding\/agentConnection";/);
  assert.doesNotMatch(source, /function getFirstAgentConnection|HTPR-7026: replace/);
  assert.equal(source.split('// HTPR-7034: trackActivation(userId, "lifecycle_email_sent", { type: "agent_nudge" })').length, 2);
  assert.ok(source.indexOf('// HTPR-7034:') > source.indexOf('await sendEmail('));
  assert.equal(load("src/lib/onboarding/emails/welcome.ts", harness().mocks).WELCOME_COHORT_START, "2026-10-09T00:00:00Z");
});
