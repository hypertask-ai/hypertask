const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");

const script = new URL("../.github/scripts/posthog-error-issues.mjs", `file://${__filename}`);
const ID = "01a128a7-88f1-7753-b94b-4f8ec8f7cbdf";
const NOW = "2026-10-27T00:00:00Z";
const row = [12, 2, NOW, NOW, [{ value: "Database timeout" }], "server", "/api/tasks", 0];
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });

for (const status of [502, 503, 504]) {
  test(`PostHog query HTTP ${status} recovers without rereading the issue`, async () => {
    const { readProductionIssue } = await import(script);
    const calls = [];
    const waits = [];
    let cancelled = 0;
    const result = await readProductionIssue(async (url, options) => {
      calls.push({ url, options });
      if (url.includes("/issues/")) return response(200, { id: ID, name: "Error" });
      if (calls.length === 2) return { ...response(status, {}), body: { cancel: async () => cancelled++ } };
      return response(200, { results: [row] });
    }, "fixture", ID, { wait: async (delay) => waits.push(delay) });
    assert.equal(result.issue_id, ID);
    assert.equal(result.count, 12);
    assert.equal(calls.length, 3);
    assert.equal(calls[1].url, calls[2].url);
    assert.equal(calls[1].options.body, calls[2].options.body);
    assert.deepEqual(waits, [1000]);
    assert.equal(cancelled, 1);
  });
}

test("persistent query timeouts fail after three reads", async () => {
  const { readProductionIssue } = await import(script);
  let queries = 0;
  const waits = [];
  await assert.rejects(readProductionIssue(async (url) => {
    if (url.includes("/issues/")) return response(200, { id: ID });
    queries++;
    return response(504, {});
  }, "fixture", ID, { wait: async (delay) => waits.push(delay) }), /returned HTTP 504/);
  assert.equal(queries, 3);
  assert.deepEqual(waits, [1000, 2000]);
});

for (const status of [400, 401, 403, 429]) {
  test(`query refusal HTTP ${status} is not retried`, async () => {
    const { readProductionIssue } = await import(script);
    let queries = 0;
    await assert.rejects(readProductionIssue(async (url) => {
      if (url.includes("/issues/")) return response(200, { id: ID });
      queries++;
      return response(status, {});
    }, "fixture", ID, { wait: async () => assert.fail("unexpected retry") }), new RegExp(`returned HTTP ${status}`));
    assert.equal(queries, 1);
  });
}

test("native dispatch recovers query timeouts and creates one ticket", async () => {
  const { handlePostHogAlert } = await import("../.github/scripts/posthog-error-alert.mjs");
  const secret = "fixture-secret";
  const payload = { alert_kind: "issue_created", issue_id: ID, environment: "production", event_id: ID, dispatched_at: NOW, timestamp: NOW };
  payload.dispatch_signature = createHmac("sha256", secret).update(JSON.stringify(Object.entries(payload).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))).digest("hex");
  let queries = 0;
  let creates = 0;
  const waits = [];
  Object.assign(process.env, { ERROR_ALERT_APP_URL: "https://app.hypertask.ai", ERROR_ALERT_BOARD_ID: "15", ERROR_ALERT_BUGS_SECTION_ID: "4389", ERROR_ALERT_VERCEL_PROJECT: "hypertasks-prod" });
  const result = await handlePostHogAlert(payload, {
    now: Date.parse(NOW), dispatchSecret: secret, apiKey: "fixture", mcpToken: "fixture",
    wait: async (delay) => waits.push(delay),
    fetchImpl: async (url, options = {}) => {
      const parsed = new URL(url);
      if (parsed.pathname.includes("/error_tracking/issues/")) return response(200, { id: ID, name: "Error" });
      if (parsed.pathname.endsWith("/query/")) return ++queries < 3 ? response(504, {}) : response(200, { results: [row] });
      if (parsed.pathname.endsWith("/labels")) return response(200, { labels: ["P1", "P2", "P3"].map((name) => ({ id: name, name })) });
      if (parsed.pathname === "/api/mcp/tasks") return response(200, { tasks: creates && parsed.searchParams.get("status") === "Normal" ? [{ id: 55555, description: `PostHog issue ID: <code>${ID}</code>` }] : [] });
      if (parsed.pathname === "/api/mcp/tasks/create") {
        creates++;
        assert.equal(options.headers["Idempotency-Key"], `posthog-issue-${ID}`);
        return response(200, { task: { id: 55555, ticketNumber: "HTPR-7001" } });
      }
      assert.fail(`unexpected request ${url}`);
    },
    rollbackImpl: async () => assert.fail("issue alerts must not roll back"),
  });
  assert.equal(result.action, "created");
  assert.equal(queries, 3);
  assert.equal(creates, 1);
  assert.deepEqual(waits, [1000, 2000]);
});
