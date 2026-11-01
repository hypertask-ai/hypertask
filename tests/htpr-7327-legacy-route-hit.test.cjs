const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load } = require("./task-route-loader.cjs");

const root = path.resolve(__dirname, "..");
const routes = [
  "/api/tasks/linkPullRequest",
  "/api/section/getByTaskId",
  "/api/notifications/mute",
  "/api/projects/views/sync-view",
];

function telemetry(t, overrides = {}) {
  const captures = [];
  const scheduled = [];
  const warnings = [];
  t.mock.method(console, "warn", (...args) => warnings.push(args));
  const { reportLegacyRouteHit } = load("src/lib/telemetry/legacyRouteHit.ts", {
    "./signupAnalytics": {
      postHogClient: overrides.postHogClient ?? (() => ({
        captureImmediate: overrides.captureImmediate ?? ((capture) => {
          captures.push(capture);
          return Promise.resolve();
        }),
      })),
    },
    "@vercel/functions": {
      waitUntil: (promise) => {
        scheduled.push(promise);
        overrides.waitUntil?.(promise);
      },
    },
  });
  return { reportLegacyRouteHit, captures, scheduled, warnings };
}

test("each legacy route reports its own path exactly once before delegating", async () => {
  for (const route of routes) {
    const file = `src/pages${route}.ts`;
    const calls = [];
    const req = { method: "DELETE", headers: {} };
    const sentinel = {};
    const res = {
      status(code) {
        calls.push(["status", code]);
        return res;
      },
      json(body) {
        calls.push(["json", body]);
        return sentinel;
      },
    };
    const handler = load(file, {
      "@/lib/telemetry/legacyRouteHit": {
        reportLegacyRouteHit: (...args) => calls.push(["report", ...args]),
      },
      "@/lib/api/task-writes/route": {
        taskWriteHandler: () => (...args) => {
          calls.push(["handler", ...args]);
          return sentinel;
        },
      },
      "@/lib/prisma": { default: {} },
      "@/utils/helperFunctions/Views/BoardFilterSanitizer": {},
      "@/lib/auth/getSessionUser": {},
      "@/utils/controllers/projects/getAllIncludes": {},
      "@/utils/controllers/projects/views/boardFilterWriteLock": {},
    }).default;
    const result = handler(req, res);
    assert.deepEqual(calls[0], ["report", route, req]);
    if (route === "/api/projects/views/sync-view") {
      assert.equal(await result, sentinel);
      assert.deepEqual(calls.slice(1), [
        ["status", 405],
        ["json", { message: "Method not allowed" }],
      ]);
    } else {
      assert.equal(result, sentinel);
      assert.deepEqual(calls.slice(1), [["handler", req, res]]);
    }
  }
});

test("each hit warns and schedules one exact event without waiting for capture", async (t) => {
  let complete;
  const captures = [];
  const pending = new Promise((resolve) => { complete = resolve; });
  const state = telemetry(t, {
    captureImmediate: (capture) => {
      captures.push(capture);
      return pending;
    },
  });
  const req = {
    method: "POST",
    headers: {
      "user-agent": "legacy-client/1.0",
      referer: "https://example.com/board",
      authorization: "Bearer private-token",
    },
  };
  for (const route of routes) {
    assert.equal(state.reportLegacyRouteHit(route, req), undefined);
    assert.deepEqual(captures.at(-1), {
      distinctId: `legacy-route:${route}`,
      event: "legacy_route_hit",
      properties: {
        route,
        method: "POST",
        user_agent: "legacy-client/1.0",
        referer: "https://example.com/board",
        has_authorization: true,
        environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
        $process_person_profile: false,
      },
    });
  }
  assert.equal(captures.length, routes.length);
  assert.equal(state.scheduled.length, routes.length);
  assert.deepEqual(state.warnings, routes.map((route) => [`legacy route hit: ${route}`]));
  complete();
  await Promise.all(state.scheduled);
});

test("missing request metadata is null and absent authorization is false", async (t) => {
  const state = telemetry(t);
  assert.equal(state.reportLegacyRouteHit(routes[0], { headers: {} }), undefined);
  assert.deepEqual(state.captures[0].properties, {
    route: routes[0],
    method: null,
    user_agent: null,
    referer: null,
    has_authorization: false,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
    $process_person_profile: false,
  });
  await Promise.all(state.scheduled);
});

test("an unconfigured PostHog client still warns and returns synchronously", (t) => {
  const state = telemetry(t, { postHogClient: () => undefined });
  assert.equal(state.reportLegacyRouteHit(routes[0], { headers: {} }), undefined);
  assert.deepEqual(state.warnings, [[`legacy route hit: ${routes[0]}`]]);
  assert.deepEqual(state.captures, []);
  assert.deepEqual(state.scheduled, []);
});

test("a rejected capture is handled without returning a promise or rejecting scheduled work", async (t) => {
  const state = telemetry(t, {
    captureImmediate: () => Promise.reject(new Error("capture unavailable")),
  });
  assert.equal(state.reportLegacyRouteHit(routes[0], { headers: {} }), undefined);
  assert.equal(state.scheduled.length, 1);
  await Promise.all(state.scheduled);
  assert.deepEqual(state.warnings, [
    [`legacy route hit: ${routes[0]}`],
    ["[legacy-route-analytics] PostHog capture failed"],
  ]);
});

for (const dependency of ["postHogClient", "captureImmediate", "waitUntil"]) {
  test(`a synchronous ${dependency} error never escapes the reporting call`, async (t) => {
    const state = telemetry(t, {
      [dependency]: () => { throw new Error(`${dependency} unavailable`); },
    });
    assert.equal(state.reportLegacyRouteHit(routes[0], { headers: {} }), undefined);
    assert.deepEqual(state.warnings, [
      [`legacy route hit: ${routes[0]}`],
      ["[legacy-route-analytics] PostHog capture could not be scheduled"],
    ]);
    assert.equal(state.scheduled.length, dependency === "waitUntil" ? 1 : 0);
    await Promise.all(state.scheduled);
  });
}
