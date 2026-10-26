const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { createJiti } = require("jiti");
const path = require("node:path");
const jiti = createJiti(__filename, { alias: { "@": path.resolve(__dirname, "../src") } });
const { safeErrorExtra } = jiti("../src/lib/telemetry/errorSanitization.ts");
const ID = "01a128a7-88f1-7753-b94b-4f8ec8f7cbdf";
const FLAG = "htpr-6238-posthog-error-alert";
const NOW = "2026-10-26T12:00:00Z";
Object.assign(process.env, {
  ERROR_ALERT_APP_URL: "https://app.hypertask.ai",
  ERROR_ALERT_BOARD_ID: "15",
  ERROR_ALERT_BUGS_SECTION_ID: "4389",
  ERROR_ALERT_VERCEL_PROJECT: "hypertasks-prod",
});

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

async function replay(featureFlag, { relationStatus = 200 } = {}) {
  const { handlePostHogAlert } = await import("../.github/scripts/posthog-error-alert.mjs");
  const tasks = [], calls = [], relations = new Map(), comments = new Map();
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    const parsed = new URL(url);
    const body = options.body ? JSON.parse(options.body) : undefined;
    if (parsed.hostname === "eu.posthog.com") {
      if (url.includes("/issues/")) return response({ id: ID, name: "Error" });
      assert.match(body.query.query, /ht_featureFlag/);
      return response({ results: [[1, 1, NOW, NOW, [{ value: "Feature failed" }], "server", "/api/test", 0, featureFlag]] });
    }
    if (url.endsWith("/labels")) return response({ labels: ["P1", "P2", "P3"].map((name) => ({ id: name, name })) });
    if (parsed.pathname === "/api/mcp/tasks") return response({ tasks: tasks.filter((task) => parsed.searchParams.has("task_id") ? task.id === Number(parsed.searchParams.get("task_id")) : task.status === parsed.searchParams.get("status")) });
    if (url.endsWith("/tasks/create")) {
      const task = { ...body, id: 100, ticketNumber: "HTPR-9999", status: "Normal", labels: body.labels.map((id) => ({ id, name: id })) };
      tasks.push(task);
      return response({ task });
    }
    if (url.endsWith("/tasks/relations")) {
      if (relationStatus !== 200) return response({ error: "relation failed" }, relationStatus);
      assert.deepEqual(body, { source_task_id: 100, target_ticket_number: "HTPR-6238", target_project_id: 15, relation_type: "RelatedTo" });
      relations.set(`${body.source_task_id}:${body.target_ticket_number}`, body);
      return response({ success: true, relation: { id: 1 } });
    }
    if (url.endsWith("/comments")) {
      comments.set(options.headers["Idempotency-Key"], body);
      return response({ success: true });
    }
    if (url.includes("/projects?")) return response({ projects: [{ id: 15, sections: [{ id: 999, section_title: "Done" }] }] });
    if (url.endsWith("/tasks/update")) {
      assert.equal(Object.hasOwn(body, "description"), false);
      Object.assign(tasks[0], body);
      return response({ success: true });
    }
    assert.fail(`Unexpected request ${url}`);
  };
  const send = async (kind = "issue_created") => {
    const payload = { alert_kind: kind, issue_id: ID, event_id: ID, environment: "production", timestamp: NOW, dispatched_at: NOW };
    payload.dispatch_signature = createHmac("sha256", "fixture-secret").update(JSON.stringify(Object.entries(payload).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))).digest("hex");
    return handlePostHogAlert(payload, { fetchImpl, now: Date.parse(NOW), dispatchSecret: "fixture-secret", apiKey: "fixture", mcpToken: "fixture" });
  };
  return { send, tasks, calls, relations, comments, recover: () => { relationStatus = 200; } };
}

test("signed created and reopened alerts relate an explicitly attributed flag once", async () => {
  const state = await replay(FLAG);
  assert.equal((await state.send()).action, "created");
  assert.equal(state.relations.size, 1);
  assert.equal(state.comments.size, 1);
  assert.match([...state.comments.values()][0].text, new RegExp(`https://app.hypertask.ai/admin/flags/${FLAG}`));
  state.tasks[0].description += "<p>Human notes stay.</p>";
  const description = state.tasks[0].description;
  state.tasks[0].status = "Archive";
  state.tasks[0].sectionId = 999;
  assert.equal((await state.send("issue_reopened")).action, "updated");
  assert.equal((await state.send("issue_reopened")).action, "updated");
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].status, "Normal");
  assert.equal(state.tasks[0].description, description);
  assert.equal(state.relations.size, 1);
  assert.equal([...state.comments.values()].filter((comment) => comment.text.includes(`/admin/flags/${FLAG}`)).length, 1);
  state.tasks[0].status = "Deleted";
  const writes = state.calls.filter((call) => call.options.method === "POST").length;
  assert.equal((await state.send()).action, "skip");
  assert.equal(state.calls.filter((call) => call.options.method === "POST").length, writes + 1);
});

test("missing, malformed, unrelated enabled flags and unknown attribution never create relations", async () => {
  for (const flag of [undefined, null, "", "htpr-999999-nonexistent", `${FLAG}/../../secrets`, [FLAG], { [FLAG]: true }]) {
    const state = await replay(flag);
    assert.equal((await state.send()).action, "created");
    assert.equal(state.relations.size, 0);
    assert.match(state.tasks[0].description, /No confirmed feature flag/);
    assert.equal(state.calls.some((call) => call.url.endsWith("/tasks/relations")), false);
  }
});

test("relation API failure is visible rather than claiming an unlinked issue succeeded", async () => {
  const state = await replay(FLAG, { relationStatus: 503 });
  await assert.rejects(state.send(), /HTTP 503/);
  assert.equal(state.relations.size, 0);
  assert.equal(state.comments.size, 0);
  state.recover();
  assert.equal((await state.send()).action, "updated");
  assert.equal(state.tasks.length, 1);
  assert.equal(state.relations.size, 1);
});

test("server error sanitization retains only a well-formed explicit feature attribution", () => {
  assert.deepEqual(safeErrorExtra({ featureFlag: FLAG, secret: "never publish" }), { ht_featureFlag: FLAG });
  for (const flag of ["htpr-1-a/../../secret", "customer@example.com", "", true, 123]) {
    assert.deepEqual(safeErrorExtra({ featureFlag: flag }), {});
  }
});
