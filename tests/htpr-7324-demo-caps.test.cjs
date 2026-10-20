const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createHash } = require("node:crypto");
const ai = require("ai");
const { MockLanguageModelV4 } = require("ai/test");
const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true, fsCache: false });
const stub = (file, exports) => {
  const filename = path.join(root, file);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
let redis, flag, guest, flagCalls, modelCalls, logs, provisionCalls, gatewayKeys;
let monthSpend, daySpend, demoSpend, redisFailure, aggregateCalls, reports;
let identity, generationFailure;
let errorReports = [];
const originalFetch = global.fetch;
const originalDemoKey = process.env.DEMO_AI_GATEWAY_API_KEY;
const board = {
  name: "Launch Plan",
  views: [1, 2, 3].map((n) => ({ title: `View ${n}`, filterType: "priority", filterValue: String(n) })),
  columns: ["To Do", "In Progress", "Done"].map((title) => ({ title, tasks: [1, 2].map((n) => ({ title: `Task ${n}`, label: null, priority: 1, dueInDays: null })) })),
};
const usage = { inputTokens: { total: 100, cacheRead: 10, cacheWrite: 5 }, outputTokens: { total: 50 } };
const model = new MockLanguageModelV4({
  doGenerate: async (options) => {
    modelCalls.push(options);
    if (generationFailure) throw generationFailure;
    return { content: [{ type: "text", text: JSON.stringify(board) }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] };
  },
  doStream: async (options) => {
    modelCalls.push(options);
    return { stream: new ReadableStream({ start(controller) {
      for (const chunk of [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "text" },
        { type: "text-delta", id: "text", delta: "<p>Prioritize your next task.</p>" },
        { type: "text-end", id: "text" },
        { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
      ]) controller.enqueue(chunk);
      controller.close();
    } }) };
  },
});
const aiPath = require.resolve("ai");
require.cache[aiPath].exports = { ...ai, createGateway: ({ apiKey }) => {
  gatewayKeys.push(apiKey);
  return () => model;
} };
class NextRequest extends Request {
  constructor(url, init) {
    super(url, init);
    this.nextUrl = new URL(url);
    this.cookies = { get: () => this.headers.has("cookie") ? { value: "session" } : undefined };
  }
}
class NextResponse {
  static json(body, init) {
    const response = Response.json(body, init);
    response.cookies = { set: (key, value) => response.headers.append("set-cookie", `${key}=${value}`) };
    return response;
  }
}
const next = require.resolve("next/server");
require.cache[next] = { id: next, filename: next, loaded: true, exports: { NextRequest, NextResponse } };
stub("src/lib/flags.ts", { isFeatureEnabled: async (key, userId) => {
  if (key !== "htpr-7324-plan-ai-caps") return false;
  flagCalls.push(userId);
  if (flag instanceof Error) throw flag;
  return flag;
} });
stub("src/lib/redis.ts", { getRedis: async () => {
  if (redisFailure) throw new Error("Redis unavailable");
  return redis;
} });
stub("src/lib/errors/reportError.ts", { reportError: async (payload) => errorReports.push(payload) });
stub("src/app/api/ai/_lib/aiUsage.ts", { logAiUsage: async (data) => logs.push(data) });
stub("src/app/api/ai/_lib/planGate.ts", { backgroundClaudeModelEnabled: async () => false });
stub("src/lib/demo/guestGuard.ts", { resolveGuestSession: async () => {
  if (guest instanceof Error) throw guest;
  return guest;
} });
stub("src/lib/auth/session.ts", {
  SESSION_COOKIE: "ht_session", verifySession: () => identity ? { id: 900, email: "guest@test" } : null,
  signSession: () => "session", sessionCookieOptions: () => ({}),
});
stub("src/lib/auth/betterAuth.ts", { auth: { handler: async () => new Response(null, { status: 204 }) } });
stub("src/lib/auth/getSessionUser.ts", { getSessionUser: async () => identity ? { userId: 900 } : null });
stub("src/lib/auth/slimUserCookie.ts", { slimUserForCookie: (user) => user });
stub("src/lib/demo/provisionGuest.ts", {
  provisionGuest: async () => {
    provisionCalls.push("create");
    return { projectId: 901, boardUrl: "/project?id=901", uniqueIdentifier: "DEMO", userRecord: { id: 900, email: "guest@test", uid: "guest_900" } };
  },
  provisionGuestBoard: async () => { provisionCalls.push("regenerate"); return { projectId: 902, boardUrl: "/project?id=902", uniqueIdentifier: "DEMO2" }; },
});
stub("src/lib/prisma.ts", { default: {
  aiUsage: { aggregate: async () => { aggregateCalls++; return { _sum: { totalTokens: monthSpend * 1000 / 0.0004 } }; } },
  user: { findUnique: async () => ({ id: 900, uid: "guest_900", email: "guest@test", accountId: "account" }) },
  project: { findFirst: async () => ({ id: 901, googleAccountId: "account", teamId: "guest-team", uniqueIdentifier: "DEMO" }) },
} });
function fakeRedis() {
  const values = new Map();
  const sets = new Map();
  const get = (key) => Number(values.get(key) ?? 0);
  const zset = (key) => { if (!sets.has(key)) sets.set(key, new Map()); return sets.get(key); };
  return {
    values, sets,
    get: async (key) => values.get(key) ?? null,
    exists: async (key) => Number(values.has(key)),
    set: async (key, value, ...options) => {
      if (options.includes("NX") && values.has(key)) return null;
      values.set(key, String(value)); return "OK";
    },
    eval: async (script, count, ...all) => {
      const keys = all.slice(0, count);
      const args = all.slice(count);
      if (script.includes('local initialized =')) {
        if (values.has(keys[2])) return 0;
        const pending = Math.max(get(keys[0]) - Number(args[0]), 0);
        [args[1], args[2], args[4], pending, args[3]].forEach((value, i) => values.set(keys[i], String(value)));
        return 1;
      }
      if (script.includes('KEYS[2], "1", "EX"')) {
        if (values.has(keys[1])) return 0;
        values.set(keys[1], "1"); values.set(keys[0], String(get(keys[0]) + Number(args[0]))); return 1;
      }
      if (script.includes('local visible =')) {
        if (!values.has(keys[0]) && !values.has(keys[1])) return null;
        return keys.reduce((sum, key) => sum + get(key), 0);
      }
      if (script.includes('local scopes =')) {
        const scopes = JSON.parse(args[0]);
        if (script.includes('local removed =')) {
          let removed = 0;
          for (const [c, r] of scopes) {
            if (zset(keys[r - 1]).delete(args[1])) {
              values.set(keys[c - 1], String(get(keys[c - 1]) + Number(args[2]))); removed++;
            }
          }
          return removed;
        }
        for (const [index, scope] of scopes.entries()) {
          let total = 0;
          for (const [c, r] of scope.pairs) {
            for (const [member, expiry] of zset(keys[r - 1])) {
              if (expiry <= Number(args[1])) {
                values.set(keys[c - 1], String(get(keys[c - 1]) + Number(member.split("|").at(-1))));
                zset(keys[r - 1]).delete(member);
              }
            }
            total += get(keys[c - 1]);
            for (const member of zset(keys[r - 1]).keys()) total += Number(member.split("|").at(-1));
          }
          if (scope.pending) total += get(keys[scope.pending - 1]);
          if (total + Number(args[2]) > scope.cap) return -index - 1;
        }
        for (const scope of scopes) zset(keys[scope.pairs[scope.writeIndex - 1][1] - 1]).set(args[4], Number(args[3]));
        return 1;
      }
      if (script.includes('local window =')) {
        const set = zset(keys[0]);
        const now = Number(args[0]);
        const window = Number(args[1]);
        for (const [id, timestamp] of set) if (timestamp <= now - window) set.delete(id);
        if (set.size >= Number(args[2])) return Math.max(1, Math.ceil((Math.min(...set.values()) + window - now) / 1000));
        set.set(args[3], now);
        return 0;
      }
      throw new Error(`Unexpected fake Redis script: ${script.slice(0, 60)}`);
    },
  };
}
const allowance = load(path.join(root, "src/app/api/ai/_lib/sharedAllowance.ts"));
const { POST: chat } = load(path.join(root, "src/app/api/demo/chat/stream/route.ts"));
const { POST: provision } = load(path.join(root, "src/app/api/demo/guest/route.ts"));
const { generateDemoBoard, DemoBoardGenerationUnavailableError } = load(path.join(root, "src/lib/demo/generateDemoBoard.ts"));
const { aiAllowancePeriod } = load(path.join(root, "src/lib/aiAllowancePolicy.ts"));
const { consumeDemoWindow } = load(path.join(root, "src/lib/demo/slidingWindow.ts"));
function request(body = { message: "What should I do next?" }, ip = "203.0.113.1", headers = {}) {
  return new NextRequest("https://app.hypertask.ai/api/demo", {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip, ...headers }, body: JSON.stringify(body),
  });
}
test.beforeEach(() => {
  redis = fakeRedis(); flag = true; guest = { userId: 900, teamId: "guest-team" };
  flagCalls = []; modelCalls = []; logs = []; provisionCalls = []; gatewayKeys = [];
  monthSpend = 0; daySpend = 0; demoSpend = 0; redisFailure = false; aggregateCalls = 0; reports = [];
  identity = false; generationFailure = null;
  process.env.DEMO_AI_GATEWAY_API_KEY = "demo-test-key";
  allowance.resetGatewayPricingCacheForTests();
  global.fetch = async (url, options) => {
    assert.equal(options?.headers?.Authorization ?? "Bearer demo-test-key", "Bearer demo-test-key");
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith("/models")) return Response.json({ data: [
      { id: "google/gemini-3.5-flash-lite", pricing: { input: "0.000001", output: "0.000002" } },
      { id: "openai/gpt-6-luna", pricing: { input: "0.000001", output: "0.000002" } },
    ] });
    reports.push(parsed);
    const tag = parsed.searchParams.get("tags");
    if (!tag) return Response.json({ results: [{ total_cost: demoSpend }] });
    const count = reports.filter((r) => r.searchParams.get("tags") === tag).length;
    return Response.json({ results: [{ tag, total_cost: count === 1 ? monthSpend : daySpend }] });
  };
});
test.after(() => {
  global.fetch = originalFetch;
  if (originalDemoKey === undefined) delete process.env.DEMO_AI_GATEWAY_API_KEY;
  else process.env.DEMO_AI_GATEWAY_API_KEY = originalDemoKey;
});
for (const invalid of [null, { userId: 900, teamId: null }, new Error("lookup failed")]) {
  test(`chat refuses missing/invalid guest before any model call: ${String(invalid)}`, async () => {
    guest = invalid;
    const response = await chat(request());
    assert.equal(response.status, 401);
    assert.match(response.headers.get("content-type"), /text\/event-stream/);
    assert.match(await response.text(), /start the demo again/);
    assert.equal(modelCalls.length, 0);
    assert.equal(gatewayKeys.length, 0);
    assert.deepEqual(flagCalls, [0]);
  });
}
test("a valid guest is admitted, tagged and charged actual cost in every scope and usage log", async () => {
  const response = await chat(request());
  assert.match(await response.text(), /Prioritize your next task/);
  assert.equal(modelCalls.length, 1);
  assert.equal(aggregateCalls, 0);
  assert.deepEqual(gatewayKeys, ["demo-test-key"]);
  assert.deepEqual(modelCalls[0].providerOptions.gateway.tags, ["demo-chat", "team:guest-team"]);
  const expected = allowance.modelCostUsd(await allowance.modelPricing("google/gemini-3.5-flash-lite"), 100, 50, 10, 5);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].costUsd, expected);
  const month = aiAllowancePeriod();
  for (const prefix of [`ai-allowance:${month.key}:guest-team`, `ai-allowance:day:${month.endDate}:guest-team`, `ai-allowance:demo:${month.key}`]) {
    assert.equal(Number(await redis.get(`${prefix}:committed`)), Math.ceil(expected * 1e6));
    assert.equal(redis.sets.get(`${prefix}:reservations`).size, 0);
  }
});
test("21st chat from the same extracted IP is refused without inference, and another IP is allowed", async () => {
  for (let i = 0; i < 20; i++) assert.match(await (await chat(request(undefined, `203.0.113.1, 10.0.0.${i}`))).text(), /status.*complete/);
  assert.match(await (await chat(request())).text(), /Too many demo messages from your network\. Try again in a few minutes\./);
  assert.equal(modelCalls.length, 20);
  assert.match(await (await chat(request(undefined, "203.0.113.2"))).text(), /status.*complete/);
  assert.equal(modelCalls.length, 21);
  assert.ok(redis.sets.has(`demo:chat:ip:${createHash("sha256").update("203.0.113.1").digest("hex")}`));
});
for (const scope of ["month", "day", "demo"]) {
  test(`chat refuses exhausted ${scope} money scope with existing signup SSE code and zero model calls`, async () => {
    if (scope === "month") monthSpend = 1;
    if (scope === "day") daySpend = 0.25;
    if (scope === "demo") demoSpend = 15;
    const response = await chat(request());
    assert.match(await response.text(), /guest_budget_exhausted/);
    assert.equal(modelCalls.length, 0);
    for (const [key, set] of redis.sets) if (key.startsWith("ai-allowance:")) assert.equal(set.size, 0);
  });
}
test("chat Redis outage refuses before model construction", async () => {
  errorReports = [];
  redisFailure = true;
  const response = await chat(request());
  assert.equal(response.status, 503);
  assert.match(await response.text(), /unavailable/);
  assert.equal(errorReports.length, 1);
  assert.equal(errorReports[0].source, "handled");
  assert.equal(errorReports[0].extra.stage, "allowance");
  assert.equal(modelCalls.length, 0);
  assert.equal(gatewayKeys.length, 0);
});
test("money-policy Redis failure after rate admission still refuses inference", async () => {
  const evalScript = redis.eval;
  redis.eval = async (script, ...args) => {
    if (script.includes("local scopes =")) throw new Error("policy Redis failed");
    return evalScript(script, ...args);
  };
  assert.match(await (await chat(request())).text(), /status.*error/);
  assert.equal(modelCalls.length, 0);
});
for (const entryPoint of ["chat", "board"]) {
  test(`Gateway policy bootstrap failure refuses ${entryPoint} inference`, async () => {
    const fetchPricing = global.fetch;
    global.fetch = async (url, options) => {
      const parsed = new URL(String(url));
      if (parsed.pathname.endsWith("/models")) return fetchPricing(url, options);
      assert.equal(parsed.pathname, "/v1/report");
      reports.push(parsed);
      return new Response(null, { status: 503 });
    };
    if (entryPoint === "chat") {
      assert.match(await (await chat(request())).text(), /status.*error/);
    } else {
      await assert.rejects(generateDemoBoard("Launch a project"), DemoBoardGenerationUnavailableError);
    }
    assert.ok(reports.length > 0, "allowance bootstrap must request /report");
    assert.equal(modelCalls.length, 0);
  });
}
test("flag lookup error fails closed for chat, guest creation and board generation", async () => {
  flag = new Error("flag unavailable");
  assert.equal((await chat(request())).status, 503);
  assert.equal((await provision(request({ purpose: "Launch a project" }))).status, 503);
  await assert.rejects(generateDemoBoard("Launch a project"), DemoBoardGenerationUnavailableError);
  assert.equal(modelCalls.length, 0);
  assert.deepEqual(provisionCalls, []);
});
test("flag off preserves anonymous chat, raw tags, legacy token cap, and no Redis or cost logging", async () => {
  flag = false; guest = null; redisFailure = true;
  assert.match(await (await chat(request())).text(), /status.*complete/);
  assert.equal(modelCalls.length, 1);
  assert.deepEqual(modelCalls[0].providerOptions.gateway.tags, ["demo-chat"]);
  assert.deepEqual(logs, []);
  guest = { userId: 900, teamId: "guest-team" };
  monthSpend = 0.1;
  assert.match(await (await chat(request())).text(), /guest_budget_exhausted/);
  assert.equal(modelCalls.length, 1);
  assert.equal(aggregateCalls, 1);
  assert.deepEqual(flagCalls, [0, 0]);
});
test("first board reserves and settles only demo-global, with no team month or day bootstrap", async () => {
  const generated = await generateDemoBoard("Launch a project");
  assert.equal(generated.name, board.name);
  assert.equal(modelCalls.length, 1);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].searchParams.get("group_by"), "day");
  assert.equal(reports[0].searchParams.has("tags"), false);
  assert.deepEqual([...redis.sets.keys()], [`ai-allowance:demo:${aiAllowancePeriod().key}:reservations`]);
  const expected = allowance.modelCostUsd(await allowance.modelPricing("openai/gpt-6-luna"), 100, 50, 10, 5);
  assert.equal(Number(await redis.get(`ai-allowance:demo:${aiAllowancePeriod().key}:committed`)), Math.ceil(expected * 1e6));
});
test("first board global exhaustion and regeneration guest day exhaustion use existing unavailable path", async () => {
  demoSpend = 15;
  await assert.rejects(generateDemoBoard("Launch a project"), DemoBoardGenerationUnavailableError);
  assert.equal(modelCalls.length, 0);
  redis = fakeRedis(); reports = []; demoSpend = 0; daySpend = 0.25;
  await assert.rejects(generateDemoBoard("Launch a project", "guest-team"), DemoBoardGenerationUnavailableError);
  assert.equal(modelCalls.length, 0);
});
test("regeneration reserves team month/day and global, settles actual usage and keeps team attribution", async () => {
  await generateDemoBoard("Launch a project", "guest-team");
  assert.equal(modelCalls.length, 1);
  assert.deepEqual(modelCalls[0].providerOptions.gateway.tags, ["demo-board", "team:guest-team"]);
  assert.equal([...redis.sets.keys()].filter((key) => key.startsWith("ai-allowance:")).length, 4);
  assert.equal([...redis.values.keys()].filter((key) => key.endsWith(":committed") && Number(redis.values.get(key)) > 0).length, 3);
  for (const set of redis.sets.values()) assert.equal(set.size, 0);
});
test("failed first-board inference conservatively settles reserved cost", async () => {
  generationFailure = new Error("provider failed");
  await assert.rejects(generateDemoBoard("Launch a project"), DemoBoardGenerationUnavailableError);
  assert.ok(Number(await redis.get(`ai-allowance:demo:${aiAllowancePeriod().key}:committed`)) > 0);
  for (const set of redis.sets.values()) assert.equal(set.size, 0);
});
test("flag-off board generation preserves raw model tags and never touches Redis", async () => {
  flag = false; redisFailure = true;
  await generateDemoBoard("Launch a project", "guest-team");
  assert.deepEqual(modelCalls[0].providerOptions.gateway.tags, ["demo-board"]);
  assert.deepEqual(reports, []);
  assert.deepEqual(flagCalls, [0]);
});
test("guest creation admits five per extracted IP and refuses the sixth, with Retry-After", async () => {
  for (let i = 0; i < 5; i++) assert.equal((await provision(request({ purpose: "Launch a project" }, "198.51.100.1, 10.0.0.1"))).status, 200);
  const response = await provision(request({ purpose: "Launch a project" }, "198.51.100.1"));
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get("retry-after")) > 0);
  assert.equal(provisionCalls.length, 5);
  assert.equal((await provision(request({}, "198.51.100.2"))).status, 200);
});
test("guest regeneration admits three per guest regardless of IP, then refuses the fourth", async () => {
  identity = true;
  for (let i = 0; i < 3; i++) assert.equal((await provision(request({ purpose: "Launch a project" }, `198.51.100.${i}`))).status, 200);
  const response = await provision(request({ purpose: "Launch a project" }, "198.51.100.100"));
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error, "too many new demo boards");
  assert.equal(provisionCalls.length, 3);
  assert.ok(redis.sets.has("demo:guest:regenerate:900"));
});
test("guest limiters fail closed on Redis outage and preserve legacy Maps with flag off", async () => {
  redisFailure = true;
  assert.equal((await provision(request({}))).status, 503);
  assert.deepEqual(provisionCalls, []);
  flag = false;
  for (let i = 0; i < 5; i++) assert.equal((await provision(request({}, "198.51.100.90"))).status, 200);
  assert.equal((await provision(request({}, "198.51.100.90"))).status, 429);
  assert.equal(provisionCalls.length, 5);
});
test("sliding window rejects malformed Redis responses rather than allowing traffic", async () => {
  for (const invalid of [null, undefined, "invalid", -1, 0.5]) {
    redis.eval = async () => invalid;
    await assert.rejects(consumeDemoWindow("demo:test", 20), /Invalid demo rate limit response/);
  }
});

test("provisioning forwards no team before guest creation, and the existing guest team on regeneration", async () => {
  const generationCalls = [];
  const stopped = new Error("generation refused");
  const api = require("./task-route-loader.cjs").load("src/lib/demo/provisionGuest.ts", {
    "@/lib/prisma": { default: { $transaction: () => assert.fail("must not create a guest after generation refusal") } },
    "@/lib/flags": {},
    "@/lib/constants/constants": {},
    "@/utils/helperFunctions/Views/BoardFilterSanitizer": {},
    "@/utils/helperFunctions/helperFunctions": {},
    "@/utils/controllers/projects/create": {},
    "@/utils/controllers/projects/createProjectWithStableName": {},
    "@/utils/controllers/projects/views/viewsHelperAPIfunctions": {},
    "@/utils/controllers/tasks/createTaskCore": {},
    "./generateDemoBoard": { generateDemoBoard: async (...args) => { generationCalls.push(args); throw stopped; } },
    "./guestSeedTasks": { GUEST_SEED_TASKS: [], GUEST_SEED_TASKS_IN_PROGRESS: [] },
    "./guest": { GUEST_UID_PREFIX: "guest_" },
  });
  await assert.rejects(api.provisionGuest("Launch a project"), (error) => error === stopped);
  await assert.rejects(api.provisionGuestBoard("Launch a project", { userId: 900, teamId: "guest-team", googleAccountId: "account" }), (error) => error === stopped);
  assert.deepEqual(generationCalls, [["Launch a project", undefined], ["Launch a project", "guest-team"]]);
});

test("Redis failure refuses first-board and guest regeneration inference", async () => {
  redisFailure = true;
  for (const teamId of [undefined, "guest-team"]) {
    await assert.rejects(generateDemoBoard("Launch a project", teamId), DemoBoardGenerationUnavailableError);
  }
  identity = true;
  assert.equal((await provision(request({ purpose: "Launch a project" }))).status, 503);
  assert.equal(modelCalls.length, 0);
  assert.deepEqual(provisionCalls, []);
});
