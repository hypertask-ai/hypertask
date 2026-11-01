const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { readFileSync } = require("node:fs");
const yaml = require("js-yaml");

const script = new URL("../.github/scripts/posthog-error-alert.mjs", `file://${__filename}`);
const NOW = Date.parse("2026-10-12T00:10:00Z");
const RELEASE = "a".repeat(40);
const SECRET = "test-dispatch-secret";
const config = { appUrl: "https://app.hypertask.ai", boardId: 15, bugsSectionId: 4389, severityLabels: { P2: "label-p2" } };
Object.assign(process.env, { ERROR_ALERT_APP_URL: config.appUrl, ERROR_ALERT_BOARD_ID: "15", ERROR_ALERT_BUGS_SECTION_ID: "4389", ERROR_ALERT_VERCEL_PROJECT: "hypertasks-prod" });

function payload(overrides = {}) {
  const value = { alert_kind: "server_error_spike", count: 21, dispatched_at: new Date(NOW).toISOString(), environment: "production", event_id: "0199aa11-bb22-7c33-8d44-ee5566778899", fingerprint: "b".repeat(64), issue_url: "https://eu.posthog.com/project/236160/error_tracking", message: "Database <timeout>", name: "Error", release: RELEASE, timestamp: new Date(NOW).toISOString(), ...overrides };
  value.dispatch_signature = createHmac("sha256", SECRET).update(JSON.stringify(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))).digest("hex");
  return value;
}
function response(status, body) { return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }; }
function liveFetch(age = 5 * 60_000, sha = RELEASE) {
  const calls = [];
  return { calls, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    assert.match(url, /^https:\/\/api\.vercel\.com\/v9\/projects/);
    return response(200, { targets: { production: { id: "dpl_live", createdAt: NOW - age, meta: { githubCommitSha: sha } } } });
  } };
}
function options(extra = {}) { return { now: NOW, dispatchSecret: SECRET, vercelToken: "vercel-test", mcpToken: "mcp-test", ...extra }; }

const issue = { issue_id: "01a128a7-88f1-7753-b94b-4f8ec8f7cbdf", message: "Database <timeout>", name: "Error", count: 12, users: 2, unidentified_hits: 0, severity: "P2", severity_reason: "Feature failed", timestamp: new Date(NOW).toISOString(), last_seen: new Date(NOW).toISOString(), issue_url: "https://eu.posthog.com/project/236160/error_tracking/01a128a7-88f1-7753-b94b-4f8ec8f7cbdf" };

test("regression: real create TaskDetail has ticketNumber and no uniqueIndex", async () => {
  const { createIncident } = await import(script);
  let request;
  const result = await createIncident(async (url, options) => { request = { url, options }; return response(200, { success: true, task: { id: 55555, ticketNumber: "HTPR-7001" } }); }, "fixture", issue, config);
  assert.equal(result.number, 7001);
  assert.equal(result.url, "https://app.hypertask.ai/detail/project-15/7001");
  assert.equal(result.id, 55555);
  assert.equal(request.options.headers["Idempotency-Key"], `posthog-issue-${issue.issue_id}`);
  const body = JSON.parse(request.options.body);
  assert.equal(body.project_id, 15);
  assert.equal(body.section_id, 4389);
  assert.deepEqual(body.labels, ["label-p2"]);
  assert.match(body.description, /Database &lt;timeout&gt;/);
  assert.match(body.description, /Known users: 2/);
});

test("malformed or absent create ticket numbers fail without building unsafe links", async () => {
  const { createIncident } = await import(script);
  for (const ticketNumber of [undefined, "HTPR-0", "OTHER-7001", 'HTPR-7001\"><img src=x>', "HTPR-9999999999"]) {
    await assert.rejects(createIncident(async () => response(200, { task: { ticketNumber } }), "fixture", issue, config), /no valid ticket number/);
  }
  await assert.rejects(createIncident(async () => response(503, {}), "fixture", issue, config), /HTTP 503/);
});

test("preview verifies the signature without board writes or rollback", async () => {
  const { handlePostHogAlert } = await import(script);
  const result = await handlePostHogAlert(payload({ environment: "preview" }), options({ fetchImpl: async () => assert.fail("preview fetch") }));
  assert.deepEqual(result, { action: "preview_verified", release: RELEASE });
});

test("rejects unsigned, modified, stale dispatches and untrusted issue hosts", async () => {
  const { handlePostHogAlert, validatePostHogPayload } = await import(script);
  const unsigned = payload(); delete unsigned.dispatch_signature;
  await assert.rejects(handlePostHogAlert(unsigned, options()), /signature is invalid/);
  const modified = payload(); modified.count++;
  await assert.rejects(handlePostHogAlert(modified, options()), /signature is invalid/);
  assert.throws(() => validatePostHogPayload(payload({ dispatched_at: new Date(NOW - 16 * 60_000).toISOString() }), NOW), /timestamp is stale/);
  assert.throws(() => validatePostHogPayload(payload({ issue_url: "https://attacker.test/" }), NOW), /host is invalid/);
  assert.equal(validatePostHogPayload(payload({ timestamp: new Date(NOW - 30 * 60_000).toISOString() }), NOW).count, 21);
});

test("fresh server spike retains rollback-only safety without a second ticket writer", async () => {
  const { handlePostHogAlert } = await import(script);
  const { fetchImpl, calls } = liveFetch();
  let rolledBack = 0;
  const result = await handlePostHogAlert(payload(), options({ fetchImpl, rollbackImpl: async () => { rolledBack++; return { action: "requested" }; } }));
  assert.equal(result.action, "rollback_checked");
  assert.equal(result.rollback.action, "requested");
  assert.equal(rolledBack, 1);
  assert.equal(calls.length, 1);
});

test("first occurrence, old spikes, pre-deployment events and stale releases never roll back", async () => {
  const { handlePostHogAlert } = await import(script);
  for (const [change, age] of [[{ alert_kind: "new_server_error", count: 1 }, 60_000], [{}, 20 * 60_000], [{ timestamp: new Date(NOW - 6 * 60_000).toISOString() }, 5 * 60_000], [{ release: "c".repeat(40) }, 60_000], [{ timestamp: new Date(NOW - 24 * 60 * 60_000 + 5 * 60_000).toISOString() }, 24 * 60 * 60_000]]) {
    const { fetchImpl, calls } = liveFetch(age);
    await handlePostHogAlert(payload(change), options({ fetchImpl, rollbackImpl: async () => assert.fail("unsafe rollback") }));
    assert.equal(calls.length, change.alert_kind === "new_server_error" ? 0 : 1);
  }
});

test("rollback failure fails loudly so the independent watchdog runs", async () => {
  const { handlePostHogAlert } = await import(script);
  await assert.rejects(handlePostHogAlert(payload(), options({ fetchImpl: liveFetch().fetchImpl, rollbackImpl: async () => ({ action: "failed" }) })), /rollback failed/);
  await assert.rejects(handlePostHogAlert(payload(), options({ fetchImpl: liveFetch().fetchImpl, rollbackImpl: async () => { throw new Error("Vercel unavailable"); } })), /Vercel unavailable/);
});

test("relay remains a separate dispatch-only hosted workflow", () => {
  const workflow = yaml.load(readFileSync(new URL("../.github/workflows/posthog-error-alert.yml", `file://${__filename}`), "utf8"));
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.equal(workflow.jobs["posthog-error-alert"]["runs-on"], "ubuntu-latest");
  assert.equal(workflow.jobs["posthog-error-alert"].steps[1].run, "node .github/scripts/posthog-error-alert.mjs");
  assert.equal(workflow.jobs["posthog-error-alert"].steps[1].env.POSTHOG_ALERT_DISPATCH_SECRET, "${{ secrets.POSTHOG_ALERT_DISPATCH_SECRET }}");
  assert.equal(workflow.on.workflow_dispatch.inputs.attempt.default, "1");
  assert.equal(workflow.permissions, undefined);
  assert.deepEqual(workflow.jobs["posthog-error-alert"].permissions, { contents: "read", actions: "write" });
  assert.equal(workflow.jobs["posthog-error-alert"].steps[1].env.POSTHOG_ALERT_ATTEMPT, "${{ inputs.attempt }}");
  assert.equal(workflow.jobs["posthog-error-alert"].steps[1].env.GITHUB_TOKEN, "${{ github.token }}");
});
