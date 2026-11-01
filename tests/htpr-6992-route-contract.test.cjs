const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load } = require("./task-route-loader.cjs");
const { createHarness } = require("./helpers/pages-route-no-session.cjs");

const root = path.resolve(__dirname, "..");
const pinned = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/htpr-6992-no-session-responses.json"), "utf8"));
const routeFiles = Object.keys(pinned).sort();

test("a request with no session gets the pinned status and body on every kept route", async () => {
  const harness = createHarness(root);
  for (const file of routeFiles) {
    const handler = harness.load(file);
    for (const [key, expected] of Object.entries(pinned[file])) {
      const method = key.replace(/^wrong:/, "");
      const actual = await harness.call(handler, method);
      assert.equal(actual.prismaTouched, false, `${file} ${key} touched the database before auth`);
      assert.deepEqual({ status: actual.status, body: actual.body }, expected, `${file} ${key}`);
    }
  }
});

function adapterWith(sessionLookup) {
  const flagCalls = [];
  const mocks = {
    "@/lib/auth/getSessionUser": { getSessionUser: sessionLookup },
    "@/lib/flags": { isFeatureEnabled: async (...args) => { flagCalls.push(args); return false; } },
  };
  return { ...load("src/lib/api/task-writes/route.ts", mocks), flagCalls };
}

function pagesCall(handler, method, body = { id: 7 }) {
  const sent = { status: null, body: undefined, headers: {} };
  const res = {
    setHeader(name, value) { sent.headers[name] = value; return res; },
    status(code) { sent.status = code; return res; },
    json(value) { sent.body = value; return res; },
    send(value) { sent.body = value; return res; },
  };
  const req = { method, headers: { cookie: "ht_session=signed" }, cookies: { ht_session: "signed" }, query: { a: "1" }, body };
  return Promise.resolve(handler(req, res)).then(() => sent);
}

test("the adapter always calls the shared route with the session and copies its response", async () => {
  const session = { userId: 985, source: "better-auth" };
  const { taskWriteHandler, flagCalls } = adapterWith(async () => session);
  const seen = [];
  const route = async (request, passed) => {
    seen.push({ passed, body: await request.json(), query: request.query, cookie: request.headers.get("cookie") });
    return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { "content-type": "application/json", "x-trace": "t" } });
  };
  const handler = taskWriteHandler({ POST: async () => route });
  const sent = await pagesCall(handler, "POST");
  assert.deepEqual(sent, { status: 201, body: { ok: true }, headers: { "x-trace": "t" } });
  assert.deepEqual(seen, [{ passed: session, body: { id: 7 }, query: { a: "1" }, cookie: "ht_session=signed" }]);
  assert.deepEqual(flagCalls, []);
});

test("the adapter leaves auth to the route when the session lookup fails or finds nobody", async () => {
  for (const lookup of [async () => null, async () => { throw new Error("auth outage"); }]) {
    const { taskWriteHandler } = adapterWith(lookup);
    const passed = [];
    const handler = taskWriteHandler({ PUT: async () => async (_request, session) => {
      passed.push(session);
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    } });
    const sent = await pagesCall(handler, "PUT");
    assert.equal(sent.status, 401);
    assert.deepEqual(sent.body, { message: "Unauthorized" });
    assert.deepEqual(passed, [undefined]);
  }
});

test("other methods get 405, a custom 405 body, a fallback, or the catch-all route", async () => {
  const { taskWriteHandler } = adapterWith(async () => null);
  const route = async () => async () => Response.json({ via: "route" });
  assert.deepEqual(await pagesCall(taskWriteHandler({ POST: route }), "GET"), { status: 405, body: { message: "Method not allowed" }, headers: {} });
  assert.deepEqual((await pagesCall(taskWriteHandler({ POST: route }, { methodNotAllowed: { error: "Method not allowed" } }), "GET")).body, { error: "Method not allowed" });
  const fallback = (_req, res) => res.status(200).json({ via: "fallback" });
  assert.deepEqual((await pagesCall(taskWriteHandler({ POST: route }, { fallback }), "GET")).body, { via: "fallback" });
  assert.deepEqual((await pagesCall(taskWriteHandler({ POST: route }, { fallback }), "POST")).body, { via: "route" });
  assert.deepEqual((await pagesCall(taskWriteHandler({ "*": route }), "PATCH")).body, { via: "route" });
});
