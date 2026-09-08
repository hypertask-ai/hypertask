// The Hypertask PostHog project (id 215180) lives in the US region. Every
// default in the error-tracking pipeline used to point at the EU cluster, so an
// unset POSTHOG_SERVER_HOST sent captures to a cluster that silently drops
// them: the pipeline looked healthy and no error ever arrived (HTPR-6238).
const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const constructed = [];

const posthogNodeFilename = require.resolve("posthog-node");
require.cache[posthogNodeFilename] = {
  id: posthogNodeFilename,
  filename: posthogNodeFilename,
  loaded: true,
  exports: {
    PostHog: class {
      constructor(token, options) {
        constructed.push({ token, options });
      }
      async captureExceptionImmediate() {}
    },
  },
};

const jiti = createJiti(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

function loadServerCapture() {
  // The module memoizes its client, so each host assertion needs a fresh copy.
  for (const key of Object.keys(require.cache)) {
    if (key.includes(path.join("src", "lib", "telemetry"))) {
      delete require.cache[key];
    }
  }
  return jiti(
    path.join(root, "src/lib/telemetry/posthogErrorTracking.server.ts"),
  ).capturePostHogExceptionOnServer;
}

async function captureWith(environmentOverrides) {
  const previous = { ...process.env };
  Object.assign(process.env, {
    VERCEL_ENV: "production",
    POSTHOG_SERVER_PROJECT_TOKEN: "phc_test_token",
    POSTHOG_ERROR_EVENT_SECRET: "event-secret",
    VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
  });
  for (const [key, value] of Object.entries(environmentOverrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    constructed.length = 0;
    const capture = loadServerCapture();
    const captured = await capture({
      message: "boom",
      stack: "Error: boom",
      source: "server",
    });
    return { captured, client: constructed[0] };
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key];
    }
    Object.assign(process.env, previous);
  }
}

test("server capture defaults to the US ingestion host", async () => {
  const { captured, client } = await captureWith({
    POSTHOG_SERVER_HOST: undefined,
  });

  assert.equal(captured, true);
  assert.equal(client.options.host, "https://us.i.posthog.com");
});

test("an explicit POSTHOG_SERVER_HOST still wins", async () => {
  const { client } = await captureWith({
    POSTHOG_SERVER_HOST: "https://eu.i.posthog.com",
  });

  assert.equal(client.options.host, "https://eu.i.posthog.com");
});

test("no error-tracking default points at the EU cluster", () => {
  const fs = require("node:fs");
  const sources = [
    "src/lib/telemetry/posthogErrorTracking.server.ts",
    "src/app/api/integrations/posthog/error-alert/route.ts",
    "scripts/configure-posthog-error-alert.mjs",
  ];
  for (const source of sources) {
    const text = fs.readFileSync(path.join(root, source), "utf8");
    const defaults = [...text.matchAll(/\|\|\s*"(https:\/\/[^"]+posthog\.com)"/g)];
    assert.notEqual(defaults.length, 0, `${source} declares no PostHog default`);
    for (const [, host] of defaults) {
      assert.match(host, /^https:\/\/(us|us\.i)\.posthog\.com$/, source);
    }
  }
});
