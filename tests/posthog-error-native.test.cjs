const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");
const { NextRequest } = require("next/server");
const { Webhook } = require("svix");

const root = path.resolve(__dirname, "..");
const ISSUE = "01a128a7-88f1-7753-b94b-4f8ec8f7cbdf";
const webhookSecret = `whsec_${Buffer.from("test-webhook-secret").toString("base64")}`;
const redis = new Map();
function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
stubModule("src/lib/flags.ts", { isFeatureEnabled: async () => true });
stubModule("src/lib/redis.ts", { getRedis: async () => ({
  set: async (key, owner) => { if (redis.has(key)) return null; redis.set(key, { owner, ttl: 300 }); return "OK"; },
  ttl: async (key) => redis.get(key)?.ttl ?? -2,
  eval: async (script, _, key, owner, ttl) => {
    if (redis.get(key)?.owner !== owner) return 0;
    if (script.includes("EXPIRE")) redis.get(key).ttl = ttl;
    else redis.delete(key);
    return 1;
  },
}) });
const jiti = createJiti(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });
const { POST } = jiti(path.join(root, "src/app/api/integrations/posthog/error-alert/route.ts"));
const { parsePostHogIssueAlert } = jiti(path.join(root, "src/lib/telemetry/posthogErrorAlert.ts"));
const { errorFingerprint } = jiti(path.join(root, "src/lib/errors/errorFingerprint.ts"));

function event(kind = "created", n = 1, properties = {}) {
  return { event: { event: `$error_tracking_issue_${kind}`, distinct_id: ISSUE, uuid: `0199aa11-bb22-7c33-8d44-${String(n).padStart(12, "0")}`, timestamp: new Date().toISOString(), properties: { ht_environment: "production", ...properties } } };
}
function request(payload, validSignature = true) {
  const body = JSON.stringify(payload);
  const timestamp = new Date();
  return new NextRequest("https://app.hypertask.ai/api/integrations/posthog/error-alert", {
    method: "POST", body, headers: {
      "webhook-id": "native-test", "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "webhook-signature": validSignature ? new Webhook(webhookSecret).sign("native-test", timestamp, body) : "v1,invalid",
    },
  });
}
function response(body, status = 200) { return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }; }

async function withEnv(run) {
  const env = { POSTHOG_ERROR_WEBHOOK_SECRET: webhookSecret, POSTHOG_ERROR_EVENT_SECRET: "test-event-secret", POSTHOG_SERVER_PROJECT_ID: "236160", VERCEL_GIT_REPO_OWNER: "hypertask-ai", VERCEL_GIT_REPO_SLUG: "hypertask", POSTHOG_ROLLBACK_GITHUB_TOKEN: "test-github-token", POSTHOG_ALERT_DISPATCH_SECRET: "test-dispatch-secret", ERROR_ALERT_APP_URL: "https://app.hypertask.ai", ERROR_ALERT_BOARD_ID: "15", ERROR_ALERT_BUGS_SECTION_ID: "4389", ERROR_ALERT_VERCEL_PROJECT: "hypertasks-prod" };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  const originalFetch = global.fetch;
  Object.assign(process.env, env);
  redis.clear();
  try { await run(); }
  finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}

test("signed native created, reopened and spiking alerts relay into one rated ticket writer end to end", async () => withEnv(async () => {
  const { handlePostHogAlert } = await import("../.github/scripts/posthog-error-alert.mjs");
  let payload;
  const tasks = [];
  const comments = [];
  let hits = 1;
  const fetchImpl = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    if (url.includes("posthog.com") && url.includes("/issues/")) return response({ id: ISSUE, name: "Error" });
    if (url.includes("posthog.com") && url.includes("/query/")) return response({ results: [[hits, 1, new Date().toISOString(), new Date().toISOString(), [{ value: "No output generated." }], "handled", "/api/ai/task-writer", 0]] });
    if (url.endsWith("/labels")) return response({ labels: ["P1", "P2", "P3"].map((name) => ({ name, id: name })) });
    if (url.includes("/tasks?")) return response({ tasks: tasks.filter((task) => new URL(url).searchParams.has("task_id") ? task.id === Number(new URL(url).searchParams.get("task_id")) : task.status === new URL(url).searchParams.get("status")) });
    if (url.endsWith("/tasks/create")) { const task = { ...body, id: 100, ticketNumber: "HTPR-7001", status: "Normal", labels: body.labels.map((id) => ({ name: id, id })) }; tasks.push(task); return response({ task }); }
    if (url.includes("/projects?")) return response({ projects: [{ id: 15, sections: [{ id: 999, section_title: "Done" }] }] });
    if (url.endsWith("/comments")) { comments.push(body); return response({ success: true }); }
    if (url.endsWith("/tasks/update")) { Object.assign(tasks[0], body, { labels: body.labels.map((id) => ({ id, name: id })) }); return response({ success: true }); }
    assert.fail(`unexpected API ${url}`);
  };
  global.fetch = async (url, options) => { assert.match(url, /posthog-error-alert.yml\/dispatches$/); payload = JSON.parse(JSON.parse(options.body).inputs.posthog_payload); return { status: 204 }; };
  for (const [kind, n, properties] of [["created", 1, {}], ["reopened", 2, {}], ["spiking", 3, { current_bucket_value: 550, computed_baseline: 10 }]]) {
    if (kind === "reopened") { tasks[0].sectionId = 999; tasks[0].assignees = ["human"]; tasks[0].description += "<p>Human notes</p>"; }
    if (kind === "spiking") hits = 600;
    const raw = event(kind, n, properties);
    assert.equal((await POST(request(raw))).status, 204);
    assert.equal(payload.alert_kind, `issue_${kind}`);
    assert.equal(payload.issue_id, ISSUE);
    const result = await handlePostHogAlert(payload, { fetchImpl, dispatchSecret: "test-dispatch-secret", apiKey: "test-posthog-key", mcpToken: "test-mcp-token", rollbackImpl: async () => assert.fail("native issue triggered rollback") });
    assert.equal(result.action, kind === "created" ? "created" : "updated");
    assert.equal((await POST(request(raw))).status, 204);
  }
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].sectionId, 4389);
  assert.deepEqual(tasks[0].assignees, ["human"]);
  assert.deepEqual(tasks[0].labels.map((l) => l.name), ["P2"]);
  assert.match(tasks[0].description, /Human notes/);
  assert.match(tasks[0].description, /requested AI reply or draft is empty/);
  assert.match(tasks[0].description, /posthog-count:600/);
  assert.equal(comments.length, 2);
  assert.match(comments[1].text, /spike: 550 hits.*baseline 10/);
}));

test("native authentication and retry claims fail closed, and failed dispatch can be redelivered", async () => withEnv(async () => {
  global.fetch = async () => ({ status: 422 });
  const raw = event();
  assert.equal((await POST(request(raw, false))).status, 401);
  assert.equal(redis.size, 0);
  assert.equal((await POST(request(raw))).status, 503);
  assert.equal(redis.size, 0);
  const key = `posthog:issue-alert:event:${raw.event.uuid}`;
  redis.set(key, { owner: "other", ttl: 300 });
  assert.equal((await POST(request(raw))).status, 503);
  redis.clear();
  global.fetch = async () => ({ status: 204 });
  assert.equal((await POST(request(raw))).status, 204);
  assert.equal(redis.get(key).ttl, 7 * 24 * 60 * 60);
}));

test("native parser uses issue distinct_id, ignores preview errors and rejects invalid event contracts", () => {
  assert.equal(parsePostHogIssueAlert(event()).issue_id, ISSUE);
  assert.equal(parsePostHogIssueAlert(event("created", 1, { ht_environment: "preview" })).environment, "preview");
  const client = event(); delete client.event.properties.ht_environment;
  client.event.properties.$current_url = "https://app.hypertask.ai/kanban";
  assert.equal(parsePostHogIssueAlert(client).environment, "production");
  for (const raw of [{}, { event: { ...event().event, event: "toString" } }, { event: { ...event().event, distinct_id: "invalid" } }, event("spiking"), event("spiking", 1, { current_bucket_value: -1, computed_baseline: 2 })]) assert.equal(parsePostHogIssueAlert(raw), undefined);
});

test("nightly run-specific messages produce distinct explicit PostHog fingerprints", () => {
  const stack = "Error\n    at POST (route.ts:54:11)";
  const a = errorFingerprint("PostHog pipeline canary yper4-331-123-1", stack);
  const b = errorFingerprint("PostHog pipeline canary yper4-331-124-1", stack);
  assert.notEqual(a, b);
  assert.equal(a, errorFingerprint("PostHog pipeline canary yper4-331-123-1", stack));
});
