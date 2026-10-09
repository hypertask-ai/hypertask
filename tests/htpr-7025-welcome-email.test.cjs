const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const key = "htpr-7025-welcome-email";
process.env.SESSION_SECRET = "welcome-email-test-only-signing-secret";

function load(file, mocks = {}) {
  const javascript = ts.transpileModule(read(file), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module_ = { exports: {} };
  const importModule = (name) => {
    if (Object.hasOwn(mocks, name)) return { __esModule: true, ...mocks[name] };
    if (!name.startsWith("@/") && !name.startsWith(".")) return require(name);
    const target = name.startsWith("@/") ? `src/${name.slice(2)}` : path.join(path.dirname(file), name);
    const resolved = [target, `${target}.ts`, `${target}.tsx`].find((candidate) => fs.existsSync(path.join(root, candidate)));
    assert.ok(resolved, `Missing test import ${name}`);
    return load(resolved, mocks);
  };
  new Function("require", "module", "exports", javascript)(importModule, module_, module_.exports);
  return module_.exports;
}

function harness() {
  const user = { id: 3001, uid: "email_test", email: "new@yopmail.com", joinedAt: new Date("2026-10-09T00:00:00Z"), emailVerified: true, UserSetting: { notification: true, notificationPreference: "all", isVerified: true } };
  const state = { user, enabled: true, qaEnabled: true, failSend: false, failAudit: false, failMarker: false, failQaRead: false, now: 0, owned: { id: 42 }, member: { id: 43 } };
  const values = new Map(), expiries = new Map();
  const sends = [], logs = [], queries = [], redisCalls = [], flagReads = [], errors = [], events = [], captures = [];
  const expire = (key_) => {
    if (expiries.has(key_) && expiries.get(key_) <= state.now) { values.delete(key_); expiries.delete(key_); }
  };
  const redis = {
    get: async (key_) => { if (state.failQaRead && key_.startsWith("onboarding:qa-armed:")) throw new Error("Redis read failed"); expire(key_); return values.get(key_) ?? null; },
    set: async (...args) => {
      redisCalls.push(args);
      const [key_, value, ...options] = args;
      events.push(`redis:${key_}`);
      if (state.failMarker && key_.startsWith("onboarding:welcome-sent:")) throw new Error("Marker unavailable");
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
    user: { findUnique: async () => state.user },
    logs: {
      findFirst: async ({ where }) => logs.find((row) => row.LoggedById === where.LoggedById && row.log === where.log) ?? null,
      create: async ({ data }) => { events.push(`log:${data.log}`); if (state.failAudit) throw new Error("Audit unavailable"); logs.push(data); return data; },
    },
    project: { findFirst: async (query) => { queries.push(query); return query.where.ownerId ? state.owned : state.member; } },
  };
  const mocks = {
    "@/lib/prisma": { default: prisma },
    "@/lib/telemetry/activationAnalytics": { trackActivation: async (...args) => { captures.push(args); } },
    "@/lib/redis": { getRedis: async () => redis },
    "@/lib/flags": { FEATURE_FLAG_QA_USER_ID: 985, isFeatureEnabled: async (flag, id) => { flagReads.push([flag, id]); return id === 985 ? state.qaEnabled : state.enabled; } },
    "@/lib/email/sendEmail": { sendEmail: async (options) => { sends.push(options); if (state.failSend) throw new Error("Provider unavailable"); return { id: "mail-1" }; } },
  };
  const welcome = load("src/lib/onboarding/emails/welcome.ts", mocks);
  async function send(opts) {
    const original = console.error;
    console.error = (...args) => errors.push(args);
    try { return await welcome.maybeSendWelcomeEmail(user.id, opts); }
    finally { console.error = original; }
  }
  return { state, values, sends, logs, queries, redisCalls, flagReads, errors, events, captures, mocks, send };
}

for (const [name, change, reason] of [
  ["flag off", (h) => { h.state.enabled = false; }, "flag_off"],
  ["pre-cohort", (h) => { h.state.user.joinedAt = new Date("2026-10-08T23:59:59Z"); }, "pre_cohort"],
  ["guest", (h) => { h.state.user.uid = "guest_test"; }, "guest"],
  ["service", (h) => { h.state.user.uid = "service_test"; }, "service_identity"],
  ["agent", (h) => { h.state.user.uid = "agent_test"; }, "service_identity"],
  ["unverified", (h) => { h.state.user.emailVerified = false; h.state.user.UserSetting.isVerified = false; }, "unverified_email"],
  ["missing email", (h) => { h.state.user.email = ""; }, "unverified_email"],
  ["notifications off", (h) => { h.state.user.UserSetting.notification = false; }, "notifications_off"],
  ["preference nothing", (h) => { h.state.user.UserSetting.notificationPreference = "nothing"; }, "notifications_off"],
  ["missing settings", (h) => { h.state.user.UserSetting = null; }, "notifications_off"],
  ["missing user", (h) => { h.state.user = null; }, "missing_user"],
  ["durable already-sent audit", (h) => { h.logs.push({ LoggedById: 3001, log: "welcome_email_sent" }); }, "already_sent"],
  ["durable already-sent marker", (h) => { h.values.set("onboarding:welcome-sent:3001", "sent"); }, "already_sent"],
  ["Redis claim lost", (h) => { h.values.set("onboarding:welcome:3001", "claimed"); }, "already_claimed"],
]) {
  test(`${name} skips quietly without sending`, async () => {
    const h = harness(); change(h);
    const priorLogs = h.logs.length;
    assert.equal(await h.send(), reason);
    assert.equal(h.sends.length, 0);
    assert.deepEqual(h.captures, []);
    assert.equal(h.logs.length, priorLogs);
    assert.equal(h.errors.length, 0);
    if (reason === "already_sent") assert.equal(h.redisCalls.length, 0);
  });
}

test("successful welcome uses shared MCP command, board, unsubscribe, lease and durable dedupe", async () => {
  const h = harness();
  assert.equal(await h.send(), "sent");
  const mail = h.sends[0];
  const { MCP_ADD_COMMAND } = load("src/lib/onboarding/installCommands.ts");
  assert.equal(mail.subject, "Your board is ready. Connect Claude Code in 30 seconds.");
  for (const text of ["Your Hypertask board is live", MCP_ADD_COMMAND, "Claude Code: run this, then type /mcp to sign in.", "Settings > Connect > MCP", "Then ask your agent to pick up the top task on your board.", "Open my board: https://app.hypertask.ai/project?id=42", "Unsubscribe: https://app.hypertask.ai/api/notifications/unsubscribe?token="]) assert.ok(mail.text.includes(text), text);
  assert.ok(mail.html.includes(MCP_ADD_COMMAND));
  assert.ok(mail.html.includes("Settings &gt; Connect &gt; MCP"));
  assert.match(mail.html, /<pre[^>]*font-family:monospace/);
  assert.ok(mail.html.indexOf("then type /mcp") < mail.html.indexOf(MCP_ADD_COMMAND));
  assert.ok(mail.html.indexOf(MCP_ADD_COMMAND) < mail.html.indexOf("Cursor and other MCP clients"));
  assert.match(mail.html, /href="https:\/\/app.hypertask.ai\/project\?id=42"/);
  assert.match(mail.html, />Unsubscribe<\/a>/);
  assert.match(mail.headers["List-Unsubscribe"], /^<https:\/\/app.hypertask.ai\/api\/notifications\/unsubscribe\?token=.+>$/);
  assert.equal(mail.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.equal(mail.idempotencyKey, "htpr-7025/user/3001");
  assert.equal(h.redisCalls[0][0], "onboarding:welcome:3001");
  assert.deepEqual(h.redisCalls[0].slice(2), ["EX", 600, "NX"]);
  assert.equal(h.redisCalls[1][0], "onboarding:welcome-sent:3001");
  assert.equal(h.redisCalls[1].length, 2);
  assert.ok(h.values.get("onboarding:welcome-sent:3001"));
  assert.deepEqual(h.logs, [{ log: "welcome_email_sent", type: "Signup", status: "Normal", LoggedById: 3001 }]);
  h.state.now = 86400;
  assert.equal(await h.send(), "already_sent");
  h.values.clear();
  assert.equal(await h.send(), "already_sent");
  assert.equal(h.sends.length, 1);
  assert.deepEqual(h.queries[0].orderBy, [{ createdAt: "asc" }, { id: "asc" }]);
  assert.deepEqual(h.captures, [[3001, "lifecycle_email_sent", { type: "welcome" }]]);
});

test("welcome tracks only accepted delivery and does not await analytics", async () => {
  const h = harness();
  let releaseSend;
  const delivery = new Promise((resolve) => { releaseSend = resolve; });
  let sendStarted;
  const started = new Promise((resolve) => { sendStarted = resolve; });
  h.mocks["@/lib/email/sendEmail"].sendEmail = async () => { sendStarted(); await delivery; };
  let releaseAnalytics;
  const analytics = new Promise((resolve) => { releaseAnalytics = resolve; });
  h.mocks["@/lib/telemetry/activationAnalytics"].trackActivation = (...args) => { h.captures.push(args); return analytics; };
  const sending = load("src/lib/onboarding/emails/welcome.ts", h.mocks).maybeSendWelcomeEmail(h.state.user.id);
  try {
    await started;
    assert.deepEqual(h.captures, [], "pending delivery must not emit");
    releaseSend();
    assert.equal(await Promise.race([sending, new Promise((resolve) => setTimeout(() => resolve("timed_out"), 1000))]), "sent");
    assert.deepEqual(h.captures, [[3001, "lifecycle_email_sent", { type: "welcome" }]]);
  } finally {
    releaseSend();
    releaseAnalytics();
    await sending;
  }
});

test("concurrent sign-ins send once", async () => {
  const h = harness();
  const outcomes = await Promise.all([h.send(), h.send()]);
  assert.deepEqual(outcomes.sort(), ["already_claimed", "sent"]);
  assert.equal(h.sends.length, 1);
});

for (const qaEnabled of [true, false]) {
  test(`armed mail.tm evaluates QA flag ${qaEnabled ? "on" : "off"}`, async () => {
    const h = harness(); h.state.enabled = false; h.state.qaEnabled = qaEnabled;
    h.state.user.email = " NEW@MAIL.TM ";
    h.values.set("onboarding:qa-armed:new@mail.tm", "1");
    assert.equal(await h.send(), qaEnabled ? "sent" : "flag_off");
    assert.deepEqual(h.flagReads, [[key, 985]]);
    assert.equal(h.sends.length, Number(qaEnabled));
  });
}

test("QA marker Redis failure preserves welcome's failed outcome without sending", async () => {
  const h = harness();
  h.state.failQaRead = true;
  assert.equal(await h.send(), "failed");
  assert.equal(h.sends.length, 0);
  assert.equal(h.flagReads.length, 0);
  assert.equal(h.errors.length, 1);
});

test("arming cannot override cohort, consent or durable sent audit and marker", async () => {
  for (const change of [
    (h) => { h.state.user.joinedAt = new Date("2026-10-08"); },
    (h) => { h.state.user.UserSetting.notification = false; },
    (h) => { h.logs.push({ LoggedById: 3001, log: "welcome_email_sent" }); },
    (h) => { h.values.set("onboarding:welcome-sent:3001", "sent"); },
  ]) {
    const h = harness(); h.state.enabled = false; h.values.set("onboarding:qa-armed:new@yopmail.com", "1"); change(h);
    assert.notEqual(await h.send(), "sent");
    assert.equal(h.sends.length, 0);
  }
});

test("send failure logs Error, releases claim and permits retry", async () => {
  const h = harness(); h.state.failSend = true;
  assert.equal(await h.send(), "failed");
  assert.deepEqual(h.captures, []);
  assert.equal(h.values.has("onboarding:welcome:3001"), false);
  assert.deepEqual(h.logs[0], { log: "welcome_email_failed", type: "Error", status: "Normal", LoggedById: 3001 });
  assert.ok(h.errors[0][1] instanceof Error);
  h.state.failSend = false;
  assert.equal(await h.send(), "sent");
  assert.equal(h.sends[0].idempotencyKey, h.sends[1].idempotencyKey);
});

test("audit outage after provider acceptance retains a durable marker without reporting a send failure", async () => {
  const h = harness(); h.state.failAudit = true;
  assert.equal(await h.send(), "sent");
  assert.equal(h.values.has("onboarding:welcome-sent:3001"), true);
  assert.equal(h.events.includes("log:welcome_email_failed"), false);
  assert.match(h.errors[0][0], /sent audit failed/);
  h.state.now = 600;
  assert.equal(await h.send(), "already_sent");
  assert.equal(h.sends.length, 1);
});

test("sent marker outage preserves the success audit and never retries an accepted send", async () => {
  const h = harness(); h.state.failMarker = true;
  assert.equal(await h.send(), "sent");
  assert.equal(h.values.has("onboarding:welcome-sent:3001"), false);
  assert.deepEqual(h.logs, [{ log: "welcome_email_sent", type: "Signup", status: "Normal", LoggedById: 3001 }]);
  assert.deepEqual(h.events.slice(-2), ["log:welcome_email_sent", "redis:onboarding:welcome-sent:3001"]);
  assert.equal(h.events.includes("log:welcome_email_failed"), false);
  assert.match(h.errors[0][0], /sent marker failed/);
  h.state.now = 600;
  assert.equal(await h.send(), "already_sent");
  assert.equal(h.sends.length, 1);
});

test("board selection uses explicit, then earliest owned, then membership, then app home", async () => {
  const explicit = harness(); await explicit.send({ boardId: 99 });
  assert.ok(explicit.sends[0].text.includes("/project?id=99")); assert.equal(explicit.queries.length, 0);
  const member = harness(); member.state.owned = null; await member.send();
  assert.ok(member.sends[0].text.includes("/project?id=43"));
  assert.deepEqual(member.queries[1].where, { status: "Normal", members: { some: { userId: 3001, agentId: null } } });
  assert.deepEqual(member.queries[1].orderBy, [{ createdAt: "asc" }, { id: "asc" }]);
  const home = harness(); home.state.owned = null; home.state.member = null; await home.send();
  assert.ok(home.sends[0].text.includes("Open my board: https://app.hypertask.ai/\n"));
  const original = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "https://staging.hypertask.ai/";
  try { const staging = harness(); await staging.send(); assert.ok(staging.sends[0].text.includes("https://staging.hypertask.ai/project?id=42")); }
  finally { if (original === undefined) delete process.env.NEXT_PUBLIC_SITE_URL; else process.env.NEXT_PUBLIC_SITE_URL = original; }
});

test("shared layout escapes script tags in either case and leaves text readable", () => {
  const { renderOnboardingEmail } = load("src/lib/onboarding/emails/layout.ts");
  for (const tag of ["script", "SCRIPT"]) {
    const raw = `<${tag}>"&'</${tag}>`;
    assert.ok(raw.toLowerCase().includes("<script"));
    const message = renderOnboardingEmail({ subject: raw, heading: raw, paragraphs: [raw], code: raw, cta: { label: raw, url: 'https://example.test/?a="&b=1' }, unsubscribeUrl: 'https://example.test/?u="&v=1' });
    assert.ok(!message.html.toLowerCase().includes("<script"));
    assert.ok(!message.html.includes('href="https://example.test/?a="'));
    assert.ok(message.html.includes(`&lt;${tag}&gt;&quot;&amp;&#39;&lt;/${tag}&gt;`));
    assert.ok(message.html.includes('href="https://example.test/?a=&quot;&amp;b=1"'));
    assert.ok(message.html.includes('href="https://example.test/?u=&quot;&amp;v=1"'));
    assert.ok(message.text.includes(raw)); assert.equal(message.subject, raw);
  }
  assert.match(read("src/lib/onboarding/emails/layout.ts"), /renderLayout/);
  assert.doesNotMatch(read("src/lib/onboarding/emails/layout.ts"), /<!doctype|<html/);
});

test("shared layout code block has light fallback and dark-mode contrast", () => {
  const { renderOnboardingEmail } = load("src/lib/onboarding/emails/layout.ts");
  const { html } = renderOnboardingEmail({ subject: "Test", heading: "Test", paragraphs: ["Run this"], code: "claude mcp add", cta: { label: "Open", url: "https://app.hypertask.ai" } });
  const token = (theme, name) => read(`src/styles/tailwindThemes/${theme}.css`).match(new RegExp(`${name}:\\s*(#[a-f0-9]+);`, "i"))[1];
  const lightSurface = token("porcelain", "--bg-comment-description"), lightText = token("porcelain", "--color-white-black");
  assert.ok(html.includes(`background-color:${lightSurface};color:${lightText};`));
  assert.match(html, /<div class="content-list"[^>]*font-size:14px;/);
  const darkStyles = html.split("@media (prefers-color-scheme: dark) {")[1].split("@media only screen")[0];
  const darkSurface = token("graphite", "--bg-comment-description"), darkText = token("graphite", "--color-white-black");
  assert.ok(darkStyles.includes(`.onboarding-code { background-color: ${darkSurface} !important; color: ${darkText} !important; }`));
});

test("sendEmail uses HTTP idempotency header, not email body headers; existing calls unchanged", async () => {
  const { sendEmail } = load("src/lib/email/sendEmail.ts");
  const previous = global.fetch; const calls = [];
  global.fetch = async (_, options) => { calls.push(options); return Response.json({ id: "email" }); };
  try {
    const options = { to: "new@yopmail.com", from: "Hypertask <notifications@hypertask.ai>", subject: "Test", text: "Test", headers: { "List-Unsubscribe": "<https://example.test/unsubscribe>" } };
    await sendEmail({ ...options, idempotencyKey: "htpr-7025/user/3001" }); await sendEmail(options);
    assert.equal(calls[0].headers["Idempotency-Key"], "htpr-7025/user/3001");
    assert.equal(calls[1].headers["Idempotency-Key"], undefined);
    assert.deepEqual(JSON.parse(calls[0].body), JSON.parse(calls[1].body));
    assert.equal(JSON.parse(calls[0].body).headers["Idempotency-Key"], undefined);
    assert.ok(calls[0].signal instanceof AbortSignal);
  } finally { global.fetch = previous; }
});

test("legacy hooks schedule welcome only after successful cookie setup, with provisioned board", () => {
  for (const route of ["verify-code", "verify-email-token"]) {
    const source = read(`src/app/api/auth/${route}/route.ts`);
    const hook = source.indexOf("waitUntil(maybeSendWelcomeEmail(userData!.id, { boardId: welcomeBoardId }))");
    assert.ok(hook > source.indexOf("signSession({ id: userData!.id"));
    assert.ok(hook > source.indexOf("seedResponseThemeCookie(request, response)"));
    assert.ok(hook < source.indexOf("} catch (cookieError)"));
    assert.ok(hook < source.indexOf("    return response"));
    assert.match(source, /welcomeBoardId = onboardingResult\?\.Project\?\.id/);
    const provision = source.indexOf("const onboardingResult = await provisionFirstWorkspace(");
    const boardAssignment = source.indexOf("welcomeBoardId = onboardingResult?.Project?.id");
    assert.ok(provision > 0 && boardAssignment > provision && hook > boardAssignment);
    assert.equal(source.split("waitUntil(maybeSendWelcomeEmail").length, 2);
  }
});

test("native hooks exclude bridge and refresh, and schedule after legacy cookies", async () => {
  for (const endpoint of ["/callback/google", "/magic-link/verify", "/sign-in/email-otp", "/sign-in/email", "/sign-in/social", "/passkey/verify-authentication", "/bridge-legacy-session", "/bridge", "/get-session", "/demo-session"]) {
    const events = [];
    let userFound = true;
    const pluginModule = load("src/lib/auth/legacyCookiePlugin.ts", {
      "@/lib/flags": { HTPR_7030_GOOGLE_SIGNUP_STARTER_BOARD_FLAG: "htpr-7030-google-signup-starter-board", isFeatureEnabled: async () => true },
      "@/lib/constants/constants": { companySizeOptions: ["Just me"], companyRoleOptions: ["Founder"] },
      "@/utils/controllers/users/provisionFirstWorkspace": { provisionFirstWorkspace: async () => { await Promise.resolve(); events.push("provisioned"); } },
      "better-auth/api": { createAuthEndpoint: () => ({}), createAuthMiddleware: (fn) => fn },
      "@/lib/prisma": { default: { user: { findUnique: async () => userFound ? { id: 3001, email: "new@yopmail.com" } : null }, project: { findFirst: async () => null } } },
      "@/lib/auth/session": { SESSION_COOKIE: "ht_session", SESSION_TTL_SECONDS: 10, sessionCookieOptions: () => ({}), signSession: () => "signed" },
      "@/lib/auth/slimUserCookie": { slimUserForCookie: (user) => user },
      "@/lib/configs/auth.config": { default: { cookies: { theme: "theme" } } },
      "@/lib/auth/themeCookie": { getThemeCookieOptions: () => ({}) },
      "@/lib/themePreferences": { themeCookieSeedValue: () => null },
      "@/utils/controllers/demo/adoptGuestBoards": { adoptGuestBoards: async () => events.push("adopt") },
      "@/utils/controllers/demo/resolveLoginBoard": { resolveLoginBoard: async () => undefined },
      "@/lib/onboarding/emails/welcome": { maybeSendWelcomeEmail: async () => events.push("welcome") },
      "@/lib/onboarding/emails/agentNudge": { maybeScheduleAgentNudge: async () => {} },
      "@vercel/functions": { waitUntil: () => events.push("scheduled") },
    });
    const plugin = pluginModule.legacyCookiePlugin();
    const request = new Request(`https://app.hypertask.ai/api/auth${endpoint}`);
    if (endpoint === "/callback/google") pluginModule.newGoogleSignupRequests.set(request, 3001);
    const ctx = { path: endpoint, request, context: { newSession: { user: { id: "3001" } } }, getCookie: () => "existing", setCookie: (name) => events.push(name) };
    await plugin.hooks.after[0].handler(ctx);
    const realSignIn = ["/callback/google", "/magic-link/verify", "/sign-in/email-otp", "/sign-in/email", "/sign-in/social", "/passkey/verify-authentication"].includes(endpoint);
    assert.equal(events.includes("welcome"), realSignIn, endpoint);
    if (realSignIn) {
      assert.ok(events.indexOf("welcome") > events.indexOf("ht_session"));
      assert.ok(events.indexOf("welcome") > events.indexOf("signup_source"));
    }
    if (endpoint === "/callback/google") {
      assert.ok(events.indexOf("provisioned") >= 0);
      assert.ok(events.indexOf("adopt") > events.indexOf("provisioned"));
      assert.ok(events.indexOf("ht_session") > events.indexOf("adopt"));
    }
    events.length = 0;
    await plugin.hooks.after[0].handler({ path: endpoint, context: {} });
    assert.deepEqual(events, []);
    userFound = false;
    await plugin.hooks.after[0].handler(ctx);
    assert.deepEqual(events, ["adopt"]);
  }
});

test("QA arming requires fixed QA identity, matching email, flag, same origin and a new inbox", async () => {
  const values = [], flagReads = [], userQueries = [];
  const state = { id: 985, email: "valentin@hypertask.ai", enabled: true, existingEmail: "Existing@MAIL.TM" };
  const { POST } = load("src/app/api/onboarding/emails/qa-arm/route.ts", {
    "@/lib/auth/getSessionUser": { getSessionUser: async () => state.id ? { userId: state.id } : null },
    "@/lib/prisma": { default: { user: {
      findUnique: async () => ({ email: state.email }),
      findFirst: async (query) => {
        userQueries.push(query);
        assert.equal(query.where.email.mode, "insensitive");
        return query.where.email.equals.toLowerCase() === state.existingEmail.toLowerCase() ? { id: 3001 } : null;
      },
    } } },
    "@/lib/flags": { FEATURE_FLAG_QA_USER: { userId: 985, email: "valentin@hypertask.ai" }, isFeatureEnabled: async (flag, id) => { flagReads.push([flag, id]); return state.enabled; } },
    "@/lib/redis": { getRedis: async () => ({ set: async (...args) => values.push(args) }) },
  });
  const request = (email, origin = "https://app.hypertask.ai") => new NextRequest("https://app.hypertask.ai/api/onboarding/emails/qa-arm", { method: "POST", headers: { host: "app.hypertask.ai", ...(origin ? { origin } : {}), "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
  for (const id of [null, 6, 3001]) { state.id = id; assert.equal((await POST(request("qa@mail.tm"))).status, 403); }
  state.id = 985; state.email = "other@example.test";
  assert.equal((await POST(request("qa@mail.tm"))).status, 403);
  state.email = "valentin@hypertask.ai"; state.enabled = false;
  assert.equal((await POST(request("qa@mail.tm"))).status, 403);
  state.enabled = true;
  for (const email of ["@mail.tm", "a@b@mail.tm", "a b@mail.tm", "qa@localhost", "a".repeat(313) + "@mail.tm", null]) assert.equal((await POST(request(email))).status, 400);
  for (const origin of [null, "https://evil.test", "http://app.hypertask.ai"]) assert.equal((await POST(request("qa@mail.tm", origin))).status, 403);
  assert.deepEqual(userQueries, []);
  assert.equal((await POST(request(" EXISTING@mail.tm "))).status, 409);
  assert.deepEqual(userQueries[0], { where: { email: { equals: "existing@mail.tm", mode: "insensitive" } }, select: { id: true } });
  assert.deepEqual(values, []);
  for (const email of [" QA@MAIL.TM ", "qa@example.com", "qa@yopmail.com", "a".repeat(312) + "@mail.tm"]) {
    const response = await POST(request(email));
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { armed: true });
    assert.deepEqual(values.at(-1), [`onboarding:qa-armed:${email.trim().toLowerCase()}`, "1", "EX", 7200]);
  }
  assert.ok(flagReads.every(([flag, id]) => flag === key && id === 985));
});

test("welcome flag is a feature with Owner + QA default and respects OFF", async () => {
  let row = null;
  const registry = load("src/lib/flags.ts", {
    "@/lib/prisma": { default: { featureFlag: { findUnique: async () => row, findMany: async () => [] }, user: { findUnique: async ({ where }) => ({ email: where.id === 985 ? "valentin@hypertask.ai" : "new@yopmail.com" }) } } },
    "@/lib/auth/getSessionUser": {},
    "@/lib/agentRuns/model": { AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG: "htpr-6406-agent-chat-stop-and-timeout" },
  });
  assert.equal(registry.HTPR_7025_WELCOME_EMAIL_FLAG, key);
  assert.equal(registry.defaultFeatureFlagMode(key), "OWNER_AND_QA");
  assert.equal((await registry.listFeatureFlagModes()).find((entry) => entry.key === key).kind, "feature");
  assert.equal(await registry.isFeatureEnabled(key, 3001), false);
  assert.equal(await registry.isFeatureEnabled(key, 985), true);
  row = { mode: "OFF" }; assert.equal(await registry.isFeatureEnabled(key, 985), false);
  assert.match(read("src/lib/onboarding/emails/welcome.ts"), /sent = true;\s+void trackActivation\(userId, "lifecycle_email_sent", \{ type: "welcome" \}\);/);
});
