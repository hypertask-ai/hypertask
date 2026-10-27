const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");
const test = require("node:test");

const stubs = {};
const checks = [];

function stubModule(relativePath, exports) {
  stubs[relativePath.replace(/^src\//, "@/").replace(/\.ts$/, "")] = exports;
}

stubModule("src/lib/flags.ts", {
  isFeatureEnabled: async () => assert.fail("retired flag must not be checked"),
  isFeatureFlagOwner: async (headers) => {
    checks.push({ ownerSession });
    return ownerSession;
  },
});
stubModule("src/lib/redis.ts", {
  getRedis: async () => {
    throw new Error("unauthorized request accessed Redis");
  },
});
stubModule("src/lib/telemetry/posthogErrorAlert.ts", {});
stubModule("src/utils/controllers/errors/recordPostHogDispatchFallback.ts", { recordPostHogDispatchFallback: async () => assert.fail("hidden or unauthorized request used the fallback") });

const { POST: alertPost } = load("src/app/api/integrations/posthog/error-alert/route.ts", stubs);
const { POST: testPost } = load("src/app/api/integrations/posthog/error-test/route.ts", stubs);

let ownerSession = false;

function withEnvironment(value, run) {
  const previousEnvironment = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = value;
  return Promise.resolve(run()).finally(() => {
    if (previousEnvironment === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousEnvironment;
  });
}

function withTestToken(value, run) {
  const previousToken = process.env.POSTHOG_ERROR_TEST_TOKEN;
  process.env.POSTHOG_ERROR_TEST_TOKEN = value;
  return Promise.resolve(run()).finally(() => {
    if (previousToken === undefined) delete process.env.POSTHOG_ERROR_TEST_TOKEN;
    else process.env.POSTHOG_ERROR_TEST_TOKEN = previousToken;
  });
}

test("webhook rejects oversized bodies before reading or dispatching them", async () => {
  let bodyRead = false;
  const response = await alertPost({
    headers: new Headers({ "content-length": String(32 * 1024 + 1) }),
    body: {
      getReader() {
        bodyRead = true;
        throw new Error("read oversized webhook body");
      },
    },
  });
  assert.equal(response.status, 413);
  assert.equal(bodyRead, false);
});

test("webhook still rejects unsigned requests without consulting the retired flag", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const response = await alertPost({ headers: new Headers() });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Invalid webhook" });
  } finally {
    console.warn = originalWarn;
  }
});

test("unsupported environments hide the error trigger", async () => {
  await withEnvironment("development", async () => {
    assert.equal((await testPost({ headers: new Headers() })).status, 404);
  });
});

test("production trigger without an owner session is a 404 before token checks", async () => {
  ownerSession = false;
  checks.length = 0;
  await withEnvironment("production", async () => {
    const response = await testPost({ headers: new Headers() });
    assert.equal(response.status, 404);
    assert.deepEqual(checks, [{ ownerSession: false }]);
  });
});

test("production CI canary needs the test secret, accepts only a bounded marker, and does not need owner cookies", async () => {
  ownerSession = false;
  await withTestToken("operator-token", () => withEnvironment("production", async () => {
    const headers = new Headers({ "x-posthog-canary": "yper4-331-123-1" });
    assert.equal((await testPost({ headers })).status, 401);
    headers.set("x-error-test-token", "wrong");
    assert.equal((await testPost({ headers })).status, 401);
    headers.set("x-error-test-token", "operator-token");
    await assert.rejects(testPost({ headers }), /PostHog pipeline canary yper4-331-123-1/);
    headers.set("x-posthog-canary", "arbitrary error message");
    assert.equal((await testPost({ headers })).status, 400);
  }));
  await withTestToken("operator-token", () => withEnvironment("preview", async () => {
    assert.equal((await testPost({ headers: new Headers({ "x-posthog-canary": "yper4-331-123-1", "x-error-test-token": "operator-token" }) })).status, 404);
  }));
});

test("production trigger with an owner session still needs the operator token", async () => {
  ownerSession = true;
  checks.length = 0;
  try {
    await withTestToken("operator-token", () =>
      withEnvironment("production", async () => {
        const response = await testPost({ headers: new Headers() });
        assert.equal(response.status, 401);

        checks.length = 0;
        await assert.rejects(
          testPost({
            headers: new Headers({ "x-error-test-token": "operator-token" }),
          }),
          /HTPR-6238 deliberate error tracking verification/,
        );
        assert.deepEqual(checks, [{ ownerSession: true }]);
      }),
    );
  } finally {
    ownerSession = false;
  }
});
