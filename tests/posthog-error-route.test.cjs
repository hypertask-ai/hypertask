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
    return false;
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
  const previousEnvironment = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "preview";
  try {
    const response = await testPost({ headers: new Headers() });
    assert.equal(response.status, 404);
    assert.deepEqual(checks, [
      { key: "htpr-6238-posthog-error-alert", userId: 6 },
    ]);
  } finally {
    if (previousEnvironment === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousEnvironment;
  }
});
