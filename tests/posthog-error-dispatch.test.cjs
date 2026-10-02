const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");
const { NextRequest } = require("next/server");
const { Webhook } = require("svix");

const root = path.resolve(__dirname, "..");
const calls = [];
const claims = [];
const webhookSecret = `whsec_${Buffer.from("test-webhook-secret").toString("base64")}`;
const alert = {
  environment: "preview",
  eventId: "0199aa11-bb22-7c33-8d44-ee5566778899",
  fingerprint: "a".repeat(64),
  release: "b".repeat(40),
  timestamp: new Date().toISOString(),
  name: "Error",
  message: "Test alert",
};

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

stubModule("src/lib/flags.ts", { isFeatureEnabled: async () => true });
stubModule("src/lib/redis.ts", { getRedis: async () => ({}) });
stubModule("src/lib/telemetry/posthogErrorAlert.ts", {
  parsePostHogExceptionAlert: () => alert,
  claimPostHogAlert: async () => ({ accepted: true, firstFingerprint: true, count: 1 }),
  commitPostHogAlertClaim: async () => claims.push("commit"),
  releasePostHogAlertClaim: async () => claims.push("release"),
});
const jiti = createJiti(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { POST } = jiti(path.join(root, "src/app/api/integrations/posthog/error-alert/route.ts"));

async function dispatch(overrides = {}, status = 204) {
  const environment = {
    POSTHOG_ERROR_WEBHOOK_SECRET: webhookSecret,
    POSTHOG_ERROR_EVENT_SECRET: "test-event-secret",
    POSTHOG_SERVER_PROJECT_ID: "236160",
    POSTHOG_UI_HOST: "https://eu.posthog.com",
    VERCEL_GIT_REPO_OWNER: "hypertask-ai",
    VERCEL_GIT_REPO_SLUG: "hypertask",
    VERCEL_GIT_COMMIT_REF: "untrusted-preview-branch",
    POSTHOG_ROLLBACK_GITHUB_WORKFLOW: undefined,
    POSTHOG_ROLLBACK_GITHUB_REF: undefined,
    POSTHOG_ROLLBACK_GITHUB_TOKEN: "test-github-token",
    POSTHOG_ALERT_DISPATCH_SECRET: "test-dispatch-secret",
    ...overrides,
  };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  const originalFetch = global.fetch;
  calls.length = 0;
  claims.length = 0;
  try {
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    global.fetch = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { status };
    };
    const body = "{}";
    const timestamp = new Date();
    return await POST(new NextRequest("https://app.hypertask.ai/api/integrations/posthog/error-alert", {
      method: "POST",
      headers: {
        "webhook-id": "test-webhook-id",
        "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
        "webhook-signature": new Webhook(webhookSecret).sign("test-webhook-id", timestamp, body),
      },
      body,
    }));
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("dispatch defaults to the dedicated workflow on the trusted production ref", async () => {
  assert.equal((await dispatch()).status, 204);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.github.com/repos/hypertask-ai/hypertask/actions/workflows/posthog-error-alert.yml/dispatches");
  assert.equal(calls[0].body.ref, "production");
  assert.deepEqual(Object.keys(calls[0].body.inputs), ["posthog_payload"]);
  assert.equal(JSON.parse(calls[0].body.inputs.posthog_payload).environment, "preview");
  assert.deepEqual(claims, ["commit"]);
});

test("operator workflow and ref overrides remain supported", async () => {
  assert.equal((await dispatch({
    POSTHOG_ROLLBACK_GITHUB_WORKFLOW: "custom-alert.yaml",
    POSTHOG_ROLLBACK_GITHUB_REF: "trusted-alert-ref",
  })).status, 204);
  assert.match(calls[0].url, /\/custom-alert\.yaml\/dispatches$/);
  assert.equal(calls[0].body.ref, "trusted-alert-ref");
});

test("invalid workflow refs are rejected before GitHub dispatch", async () => {
  await assert.rejects(dispatch({ POSTHOG_ROLLBACK_GITHUB_REF: "unsafe ref" }), /GITHUB_REF is invalid/);
  assert.equal(calls.length, 0);
});

test("failed GitHub dispatch releases the claim for retry", async () => {
  assert.equal((await dispatch({}, 422)).status, 503);
  assert.deepEqual(claims, ["release"]);
});
