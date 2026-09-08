const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

process.env.ERROR_ALERT_APP_URL = "https://app.hypertask.ai";
process.env.ERROR_ALERT_BOARD_ID = "15";
process.env.ERROR_ALERT_BUGS_SECTION_ID = "4389";
process.env.ERROR_ALERT_MANAGER_AGENT_ID = "cca791d8-b96d-4f1e-8abf-e2344263aa21";
process.env.ERROR_ALERT_MANAGER_THREAD = "6225";
process.env.ERROR_ALERT_VERCEL_PROJECT = "hypertasks-prod";

const root = path.resolve(__dirname, "..");
const scriptUrl = pathToFileURL(
  path.join(root, ".github/scripts/posthog-error-alert.mjs"),
).href;
const NOW = Date.parse("2026-09-08T00:10:00.000Z");
const RELEASE = "a".repeat(40);
const DISPATCH_SECRET = "test-dispatch-secret";

function dispatchSignature(value) {
  return createHmac("sha256", DISPATCH_SECRET)
    .update(
      JSON.stringify(
        Object.entries(value).sort(([left], [right]) =>
          left < right ? -1 : left > right ? 1 : 0,
        ),
      ),
    )
    .digest("hex");
}

function payload(overrides = {}) {
  const value = {
    alert_kind: "server_error_spike",
    count: 21,
    dispatched_at: "2026-09-08T00:10:00.000Z",
    environment: "production",
    event_id: "0199aa11-bb22-7c33-8d44-ee5566778899",
    fingerprint: "b".repeat(64),
    issue_url: "https://eu.posthog.com/project/123/error_tracking",
    message: "Database <timeout>",
    name: "Error",
    release: RELEASE,
    timestamp: "2026-09-08T00:10:00.000Z",
    ...overrides,
  };
  if (!("dispatch_signature" in overrides)) {
    value.dispatch_signature = dispatchSignature(value);
  }
  return value;
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  };
}

function workflowFetch(liveCreatedAt = NOW - 5 * 60 * 1000) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("api.vercel.com/v9/projects")) {
      return response(200, {
        targets: {
          production: {
            id: "dpl_live",
            createdAt: liveCreatedAt,
            meta: { githubCommitSha: RELEASE },
          },
        },
      });
    }
    if (url.endsWith("/api/mcp/tasks/create")) {
      return response(200, { task: { uniqueIndex: 7001 } });
    }
    if (url.endsWith("/api/mcp/comments")) return response(200, { success: true });
    throw new Error(`unexpected fetch ${url}`);
  };
  return { fetchImpl, calls };
}

test("preview alert verifies the complete relay without board writes or rollback", async () => {
  const { handlePostHogAlert } = await import(scriptUrl);
  let fetched = false;
  const result = await handlePostHogAlert(
    payload({ environment: "preview", alert_kind: "new_server_error", count: 1 }),
    {
      now: NOW,
      dispatchSecret: DISPATCH_SECRET,
      fetchImpl: async () => { fetched = true; },
    },
  );
  assert.deepEqual(result, { action: "preview_verified", release: RELEASE });
  assert.equal(fetched, false);
});

test("rejects unsigned and modified workflow dispatches", async () => {
  const { handlePostHogAlert } = await import(scriptUrl);
  await assert.rejects(
    handlePostHogAlert(payload({ dispatch_signature: undefined }), {
      now: NOW,
      dispatchSecret: DISPATCH_SECRET,
    }),
    /signature is invalid/,
  );
  const modified = payload();
  modified.count = 22;
  await assert.rejects(
    handlePostHogAlert(modified, {
      now: NOW,
      dispatchSecret: DISPATCH_SECRET,
    }),
    /signature is invalid/,
  );
});

test("accepts a producer-signed spike without duplicating its threshold policy", async () => {
  const { validatePostHogPayload } = await import(scriptUrl);
  assert.equal(validatePostHogPayload(payload({ count: 1 }), NOW).count, 1);
});

test("accepts a delayed event when its signed dispatch is fresh", async () => {
  const { validatePostHogPayload } = await import(scriptUrl);
  const result = validatePostHogPayload(
    payload({ timestamp: "2026-09-07T23:40:00.000Z" }),
    NOW,
  );
  assert.equal(result.timestamp, "2026-09-07T23:40:00.000Z");
  assert.throws(
    () =>
      validatePostHogPayload(
        payload({ dispatched_at: "2026-09-07T23:40:00.000Z" }),
        NOW,
      ),
    /dispatch timestamp is stale/,
  );
});

test("validates the complete Manager agent id", async () => {
  const { isUuid } = await import(scriptUrl);
  assert.equal(isUuid("cca791d8-b96d-4f1e-8abf-e2344263aa21"), true);
  assert.equal(isUuid("deadbeef---------------------------"), false);
});

test("fresh spike rolls back, files one incident, and alerts the Manager thread", async () => {
  const { handlePostHogAlert } = await import(scriptUrl);
  const { fetchImpl, calls } = workflowFetch();
  const rollbackCalls = [];
  const result = await handlePostHogAlert(payload(), {
    now: NOW,
    dispatchSecret: DISPATCH_SECRET,
    fetchImpl,
    vercelToken: "vercel-test",
    mcpToken: "mcp-test",
    rollbackImpl: async (...args) => {
      rollbackCalls.push(args);
      return { action: "requested", deploymentId: "dpl_previous" };
    },
  });

  assert.equal(result.action, "alerted");
  assert.equal(result.incident.number, 7001);
  assert.equal(rollbackCalls.length, 1);
  const creates = calls.filter((call) => call.url.endsWith("/api/mcp/tasks/create"));
  const comments = calls.filter((call) => call.url.endsWith("/api/mcp/comments"));
  assert.equal(creates.length, 1);
  assert.equal(comments.length, 2);
  const [create] = creates;
  const managerComment = comments.find((call) =>
    call.options.body.includes('"unique_index":6225'),
  );
  const incidentComment = comments.find((call) =>
    call.options.body.includes('"unique_index":7001'),
  );
  assert.ok(managerComment);
  assert.ok(incidentComment);
  assert.equal(create.options.headers["Idempotency-Key"], `posthog-incident-${payload().event_id}`);
  assert.match(create.options.body, /"section_id":4389/);
  assert.match(create.options.body, /Database &lt;timeout&gt;/);
  assert.match(managerComment.options.body, /agent-cca791d8-b96d-4f1e-8abf-e2344263aa21/);
  assert.match(managerComment.options.body, /https:\/\/app\.hypertask\.ai\/detail\/project-15\/7001/);
  assert.match(incidentComment.options.body, /previous ready release/);
});

test("spike outside the post-deploy window alerts but does not roll back", async () => {
  const { handlePostHogAlert } = await import(scriptUrl);
  const { fetchImpl } = workflowFetch(NOW - 20 * 60 * 1000);
  let rollbackCalled = false;
  const result = await handlePostHogAlert(payload(), {
    now: NOW,
    dispatchSecret: DISPATCH_SECRET,
    fetchImpl,
    vercelToken: "vercel-test",
    mcpToken: "mcp-test",
    rollbackImpl: async () => {
      rollbackCalled = true;
    },
  });
  assert.equal(result.action, "alerted");
  assert.equal(result.rollback.action, "not_eligible");
  assert.match(result.rollback.reason, /older than 15 minutes/);
  assert.equal(rollbackCalled, false);
});

test("a delayed old spike cannot roll back a deployment after its safety window", async () => {
  const { handlePostHogAlert } = await import(scriptUrl);
  const deployedAt = NOW - 24 * 60 * 60 * 1000;
  const { fetchImpl } = workflowFetch(deployedAt);
  let rollbackCalled = false;
  const result = await handlePostHogAlert(
    payload({ timestamp: new Date(deployedAt + 5 * 60 * 1000).toISOString() }),
    {
      now: NOW,
      dispatchSecret: DISPATCH_SECRET,
      fetchImpl,
      vercelToken: "vercel-test",
      mcpToken: "mcp-test",
      rollbackImpl: async () => {
        rollbackCalled = true;
      },
    },
  );

  assert.equal(result.rollback.action, "not_eligible");
  assert.match(result.rollback.reason, /older than 15 minutes/);
  assert.equal(rollbackCalled, false);
});

test("a spike before the current deployment reports the correct no-rollback reason", async () => {
  const { handlePostHogAlert } = await import(scriptUrl);
  const { fetchImpl, calls } = workflowFetch(NOW);
  const result = await handlePostHogAlert(
    payload({ timestamp: "2026-09-08T00:09:00.000Z" }),
    {
      now: NOW,
      dispatchSecret: DISPATCH_SECRET,
      fetchImpl,
      vercelToken: "vercel-test",
      mcpToken: "mcp-test",
    },
  );

  assert.equal(result.rollback.action, "not_eligible");
  assert.match(result.rollback.reason, /started before the current deployment/);
  const comments = calls.filter((call) => call.url.endsWith("/api/mcp/comments"));
  assert.equal(comments.length, 1);
  assert.match(comments[0].options.body, /started before the current deployment/);
});

test("stale release neither writes to the board nor rolls back", async () => {
  const { handlePostHogAlert } = await import(scriptUrl);
  const { fetchImpl, calls } = workflowFetch();
  const result = await handlePostHogAlert(payload({ release: "c".repeat(40) }), {
    now: NOW,
    dispatchSecret: DISPATCH_SECRET,
    fetchImpl,
    vercelToken: "vercel-test",
    mcpToken: "mcp-test",
  });
  assert.deepEqual(result, {
    action: "skip",
    reason: "production already serves a different release",
  });
  assert.equal(calls.length, 1);
});

test("incident filing failure does not block an eligible rollback", async () => {
  const { handlePostHogAlert } = await import(scriptUrl);
  const { fetchImpl: baseFetch, calls } = workflowFetch();
  let rollbackCalled = false;
  const fetchImpl = async (url, options) => {
    if (url.endsWith("/api/mcp/tasks/create")) return response(503, {});
    return baseFetch(url, options);
  };

  await assert.rejects(
    handlePostHogAlert(payload(), {
      now: NOW,
      dispatchSecret: DISPATCH_SECRET,
      fetchImpl,
      vercelToken: "vercel-test",
      mcpToken: "mcp-test",
      rollbackImpl: async () => {
        rollbackCalled = true;
        return { action: "requested" };
      },
    }),
    /returned HTTP 503/,
  );
  assert.equal(rollbackCalled, true);
  const comments = calls.filter((call) => call.url.endsWith("/api/mcp/comments"));
  assert.equal(comments.length, 1);
  assert.match(comments[0].options.body, /incident ticket could not be created/);
  assert.match(comments[0].options.body, /previous ready release/);
});

test("rejects a malformed incident number before building its link", async () => {
  const { handlePostHogAlert } = await import(scriptUrl);
  const { fetchImpl: baseFetch, calls } = workflowFetch();
  const fetchImpl = async (url, options) => {
    if (url.endsWith("/api/mcp/tasks/create")) {
      return response(200, { task: { uniqueIndex: '7001\"><img src=x>' } });
    }
    return baseFetch(url, options);
  };

  await assert.rejects(
    handlePostHogAlert(payload({ alert_kind: "new_server_error", count: 1 }), {
      now: NOW,
      dispatchSecret: DISPATCH_SECRET,
      fetchImpl,
      vercelToken: "vercel-test",
      mcpToken: "mcp-test",
    }),
    /no valid ticket number/,
  );
  const comments = calls.filter((call) => call.url.endsWith("/api/mcp/comments"));
  assert.equal(comments.length, 1);
  assert.doesNotMatch(comments[0].options.body, /img src/);
});

test("rollback failures are reported as failures", async () => {
  const { handlePostHogAlert } = await import(scriptUrl);
  const { fetchImpl, calls } = workflowFetch();
  const result = await handlePostHogAlert(payload(), {
    now: NOW,
    dispatchSecret: DISPATCH_SECRET,
    fetchImpl,
    vercelToken: "vercel-test",
    mcpToken: "mcp-test",
    rollbackImpl: async () => {
      throw new Error("Vercel unavailable");
    },
  });

  assert.equal(result.rollback.action, "failed");
  const comments = calls.filter((call) => call.url.endsWith("/api/mcp/comments"));
  assert.equal(comments.length, 2);
  assert.match(comments[0].options.body, /Automatic rollback failed/);
  assert.doesNotMatch(comments[0].options.body, /stopped safely/);
});
