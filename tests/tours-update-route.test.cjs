const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

function harness({ session = { userId: 42, source: "cli-bearer" }, productTours = {}, failure = false } = {}) {
  const calls = { reads: [], writes: [], logs: [] };
  let requestHeaders;
  const { POST } = loadModule("src/app/api/tours/update/route.ts", {
    "@/lib/auth/getSessionUser": { getSessionUser: async headers => {
      assert.equal(headers, requestHeaders);
      return session;
    } },
    "@/lib/auth/desktopCliTokenUser": { logDesktopCliAuthorization: (...args) => calls.logs.push(args) },
    "@/lib/prisma": { default: { userSetting: {
      findUnique: async query => { calls.reads.push(query); return { productTours }; },
      update: async query => {
        calls.writes.push(query);
        if (failure) throw new Error("synthetic database failure");
      },
    } } },
  });
  async function post(body, raw = false) {
    const req = new Request("https://app.test/api/tours/update?client=desktop", {
      method: "POST", body: raw ? body : JSON.stringify(body),
    });
    requestHeaders = req.headers;
    const response = await POST(req);
    return { status: response.status, body: await response.json() };
  }
  return { post, calls, session };
}

function assertLogged(h, status) {
  assert.deepEqual(h.calls.logs, [[h.session, "shared-session", status, {
    url: "/api/tours/update", method: "POST",
  }]]);
}

test("unauthenticated tours POST returns 401 without touching Prisma", async () => {
  const h = harness({ session: null });
  assert.deepEqual(await h.post({ tourId: "project" }), {
    status: 401, body: { error: "Unauthorized", code: "SESSION_REQUIRED" },
  });
  assert.deepEqual(h.calls, { reads: [], writes: [], logs: [] });
});

test("authenticated tours POST requires tourId before touching Prisma", async () => {
  const h = harness();
  assert.deepEqual(await h.post({ completed: true }), {
    status: 400, body: { message: "tourId is required" },
  });
  assert.deepEqual(h.calls.reads, []);
  assert.deepEqual(h.calls.writes, []);
  assertLogged(h, 400);
});

test("authenticated tours POST updates the user's tours and returns the saved data", async () => {
  const otherTour = { completed: false, skipped: true };
  const h = harness({ productTours: { shortcuts: otherTour, project: true } });
  const before = Date.now();
  const response = await h.post({ tourId: "project", completed: true });
  assert.equal(response.status, 200);
  const tour = response.body.tours.project;
  assert.equal(tour.completed, true);
  assert.equal(tour.skipped, false);
  for (const value of [tour.completedAt, tour.lastSeenAt]) {
    assert.ok(Date.parse(value) >= before && Date.parse(value) <= Date.now());
  }
  assert.deepEqual(response.body, {
    success: true, tours: { shortcuts: otherTour, _hasSeenAnyTour: true, project: tour },
  });
  assert.deepEqual(h.calls.reads, [{ where: { userId: 42 }, select: { productTours: true } }]);
  assert.deepEqual(h.calls.writes, [{ where: { userId: 42 }, data: { productTours: response.body.tours } }]);
  assertLogged(h, 200);
});

test("skipping a tour preserves its existing completion date", async () => {
  const completedAt = "2025-01-01T00:00:00.000Z";
  const h = harness({ productTours: { project: { completed: true, completedAt } } });
  const response = await h.post({ tourId: "project", skipped: true });
  assert.equal(response.status, 200);
  assert.equal(response.body.tours.project.completed, false);
  assert.equal(response.body.tours.project.skipped, true);
  assert.equal(response.body.tours.project.completedAt, completedAt);
});

test("invalid JSON returns a clean error without touching Prisma", async () => {
  const h = harness();
  const response = await h.post("{", true);
  assert.equal(response.status, 500);
  assert.equal(response.body.message, "Internal server error");
  assert.equal(typeof response.body.error, "string");
  assert.deepEqual(h.calls.reads, []);
  assert.deepEqual(h.calls.writes, []);
  assertLogged(h, 500);
});

test("database errors preserve the tours error response and CLI refusal logging", async () => {
  const h = harness({ failure: true });
  assert.deepEqual(await h.post({ tourId: "project" }), {
    status: 500, body: { message: "Internal server error", error: "synthetic database failure" },
  });
  assertLogged(h, 500);
});
