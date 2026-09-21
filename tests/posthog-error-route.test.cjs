const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const checks = [];

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

stubModule("src/lib/flags.ts", {
  FEATURE_FLAG_OWNER_USER_ID: 6,
  POSTHOG_ERROR_ALERT_FLAG: "htpr-6238-posthog-error-alert",
  isFeatureEnabled: async (key, userId) => {
    checks.push({ key, userId });
    return flagEnabled;
  },
  isFeatureFlagOwner: async (headers) => {
    checks.push({ ownerSession });
    return ownerSession;
  },
});
stubModule("src/lib/redis.ts", {
  getRedis: async () => {
    throw new Error("continued after feature flag gate");
  },
});
stubModule("src/lib/telemetry/posthogErrorAlert.ts", {});

const jiti = createJiti(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { POST: alertPost } = jiti(
  path.join(root, "src/app/api/integrations/posthog/error-alert/route.ts"),
);
const { POST: testPost } = jiti(
  path.join(root, "src/app/api/integrations/posthog/error-test/route.ts"),
);

let flagEnabled = false;
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

test("disabled flag rejects the webhook before reading or dispatching it", async () => {
  checks.length = 0;
  let bodyRead = false;
  const request = {
    headers: new Headers(),
    body: {
      getReader() {
        bodyRead = true;
        throw new Error("read disabled webhook body");
      },
    },
  };
  const response = await alertPost(request);

  assert.equal(response.status, 404);
  assert.equal(bodyRead, false);
  assert.deepEqual(checks, [
    { key: "htpr-6238-posthog-error-alert", userId: 6 },
  ]);
});

test("disabled flag hides the preview error trigger before token checks", async () => {
  checks.length = 0;
  await withEnvironment("preview", async () => {
    const response = await testPost({ headers: new Headers() });
    assert.equal(response.status, 404);
    assert.deepEqual(checks, [
      { key: "htpr-6238-posthog-error-alert", userId: 6 },
    ]);
  });
});

test("production trigger without an owner session is a 404 before token checks", async () => {
  flagEnabled = true;
  ownerSession = false;
  checks.length = 0;
  try {
    await withEnvironment("production", async () => {
      const response = await testPost({ headers: new Headers() });
      assert.equal(response.status, 404);
      assert.deepEqual(checks, [
        { key: "htpr-6238-posthog-error-alert", userId: 6 },
        { ownerSession: false },
      ]);
    });
  } finally {
    flagEnabled = false;
  }
});

test("production trigger with an owner session still needs the operator token", async () => {
  flagEnabled = true;
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
        assert.deepEqual(checks, [
          { key: "htpr-6238-posthog-error-alert", userId: 6 },
          { ownerSession: true },
        ]);
      }),
    );
  } finally {
    flagEnabled = false;
    ownerSession = false;
  }
});
