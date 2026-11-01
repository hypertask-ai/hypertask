const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const yaml = require("js-yaml");
process.env.GITHUB_RUN_ATTEMPT = "1";
const script = new URL("../.github/scripts/posthog-error-monitor.mjs", `file://${__filename}`);
function response(body, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => body }; }

const ISSUE_ID = "01a128a7-88f1-7753-b94b-4f8ec8f7cbdf";

function canaryFetch(ticketAt = 2) {
  const calls = [];
  let searches = 0;
  return { calls, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/error-test")) return response({}, 500);
    if (url.includes("/error_tracking/issues/?")) return response({ results: [], next: null });
    if (url.includes("/tasks?")) return response({ tasks: ++searches < ticketAt ? [] : [
      { id: 99, description: "legacy reporter yper4-331-123-1" },
      { id: 98, description: `Former poll yper4-331-123-1 PostHog issue ID: <code>${ISSUE_ID}</code>` },
      { id: 100, description: `PostHog issue ID: <code>${ISSUE_ID}</code> PostHog pipeline canary yper4-331-123-1 posthog-alert:issue_created:alert-id` },
    ] });
    if (url.includes("/projects?")) return response({ projects: [{ id: 15, sections: [{ id: 777, section_title: "Done" }] }] });
    if (url.endsWith("/tasks/update")) return response({ success: true });
    if (url.includes("posthog.com/api/projects/236160/error_tracking/issues/")) return response({ id: ISSUE_ID, description: "PostHog pipeline canary yper4-331-123-1", status: options.method === "PATCH" ? "resolved" : "active" });
    assert.fail(url);
  } };
}

test("nightly canary throws on production, polls for the PostHog ticket, then moves only it to Done", async () => {
  const { runCanary } = await import(script);
  const state = canaryFetch();
  let clock = 0;
  const result = await runCanary({ ...state, token: "mcp-fixture", testToken: "test-fixture", apiKey: "ph-fixture", runId: "123", attempt: "1", now: () => clock, wait: async (ms) => { clock += ms; } });
  assert.equal(result.action, "verified");
  assert.equal(result.ticketId, 100);
  assert.equal(clock, 30_000);
  assert.equal(state.calls[0].options.headers["x-error-test-token"], "test-fixture");
  assert.equal(state.calls[0].options.headers["x-posthog-canary"], "yper4-331-123-1");
  const closeBody = JSON.parse(state.calls.find((call) => call.url.endsWith("/tasks/update")).options.body);
  assert.deepEqual(closeBody, { task_id: 100, sectionId: 777 });
  const ts = require("typescript");
  const vm = require("node:vm");
  const code = ts.transpileModule(readFileSync(new URL("../src/lib/mcp/tasks/fields/validateFields.ts", `file://${__filename}`), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} };
  const stubs = {
    "next/server": require("next/server"),
    "@/lib/mcp/tasks/validators": {},
    "@/lib/mcp/normalizeBlockHtml": {},
    "@/utils/helperFunctions/markdownToHtml": {},
    "@/lib/mcp/fieldError": { buildFieldError: () => ({ success: false }) },
    "@/lib/mcp/tasks/contractFields": {},
    "@/lib/mcp/tasks/updateFields": { hasSingleTaskUpdate: (body) => body.title !== undefined || body.description !== undefined || body.parent_task_id !== undefined },
    "@/lib/pullRequests/githubPullRequests": {},
  };
  vm.runInNewContext(code, { module: mod, exports: mod.exports, require: (id) => stubs[id] || require(id), console });
  const valid = await mod.exports.validateTaskUpdateFields(closeBody, false);
  assert.equal(valid instanceof Response, false);
  const invalid = await mod.exports.validateTaskUpdateFields({ task_id: 100, section_id: 777 }, false);
  assert.equal(invalid.status, 400);
  assert.equal(state.calls.at(-1).options.method, "PATCH");
  assert.deepEqual(JSON.parse(state.calls.at(-1).options.body), { status: "resolved" });
  assert.equal(state.calls.find((call) => call.url.endsWith("/tasks/update")).options.headers["Idempotency-Key"], "posthog-canary-close-yper4-331-123-1");
});

test("missing ticket reaches exactly the fifteen-minute deadline and fails loudly", async () => {
  const { runCanary } = await import(script);
  const state = canaryFetch(Infinity);
  let clock = 0;
  await assert.rejects(runCanary({ ...state, token: "fixture", testToken: "fixture", apiKey: "ph-fixture", runId: "123", now: () => clock, wait: async (ms) => { clock += ms; } }), /No matching board 15 PostHog ticket within 15 minutes/);
  assert.equal(clock, 15 * 60_000);
  assert.equal(state.calls.filter((call) => call.url.includes("/tasks?")).length, 30);
  assert.equal(state.calls.filter((call) => call.url.endsWith("/tasks/update")).length, 0);
});

test("authentication, API and close failures cannot look like a passed canary", async () => {
  const { runCanary } = await import(script);
  await assert.rejects(runCanary({ token: "", testToken: "fixture", apiKey: "ph-fixture", runId: "123" }), /credentials/);
  await assert.rejects(runCanary({ token: "fixture", testToken: "fixture", apiKey: "ph-fixture", runId: "123", fetchImpl: async () => response({}, 401) }), /error-test returned HTTP 401/);
  const state = canaryFetch(1);
  await assert.rejects(runCanary({ token: "fixture", testToken: "fixture", apiKey: "ph-fixture", runId: "123", fetchImpl: async (url, options) => url.endsWith("/tasks/update") ? response({}, 403) : state.fetchImpl(url, options) }), /HTTP 403/);
});

test("canary refuses mismatched issues, failed resolution and late alert delivery", async () => {
  const { runCanary } = await import(script);
  const state = canaryFetch(1);
  const options = { token: "fixture", testToken: "fixture", apiKey: "ph-fixture", runId: "123" };
  await assert.rejects(runCanary({ ...options, fetchImpl: async (url, opts) => new URL(url).hostname === "eu.posthog.com" ? response({ id: ISSUE_ID, description: "another error" }) : state.fetchImpl(url, opts) }), /does not match the nightly canary/);
  assert.equal(state.calls.filter((call) => call.url.endsWith("/tasks/update")).length, 0);
  await assert.rejects(runCanary({ ...options, fetchImpl: async (url, opts) => opts.method === "PATCH" ? response({}, 403) : state.fetchImpl(url, opts) }), /resolution failed/);
  let clock = 0;
  await assert.rejects(runCanary({ ...options, now: () => clock, fetchImpl: async (url, opts) => {
    if (new URL(url).hostname === "eu.posthog.com") clock = 15 * 60_000;
    return state.fetchImpl(url, opts);
  } }), /arrived after fifteen minutes/);
});

test("watchdog directly creates one infra ticket and comments on it for subsequent failing runs", async () => {
  const { reportFailure, FAILURE_TITLE } = await import(script);
  const tasks = [];
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const body = options.body ? JSON.parse(options.body) : undefined;
    if (url.includes("/tasks?")) return response({ tasks });
    if (url.endsWith("/tasks/create")) { tasks.push({ ...body, id: 100, status: "Normal" }); return response({ task: { id: 100, ticketNumber: "YPER4-999" } }); }
    if (url.includes("/projects?")) return response({ projects: [{ id: 4060, sections: [{ id: 10, title: "Backlog" }, { id: 20, title: "Done" }] }] });
    if (url.endsWith("/comments")) return response({ success: true });
    assert.fail(url);
  };
  for (const runId of ["10001", "10002", "10003"]) await reportFailure({ fetchImpl, token: "fixture", runId, runUrl: `https://github.com/hypertask-ai/hypertask/actions/runs/${runId}`, workflow: "PostHog Error Alert" });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].project_id, 4060);
  assert.equal(tasks[0].title, FAILURE_TITLE);
  assert.equal(calls.filter((call) => call.url.endsWith("/comments")).length, 2);
  assert.equal(JSON.parse(calls.at(-1).options.body).task_id, 100);
  assert.ok(calls.every((call) => !["eu.posthog.com", "api.github.com"].includes(new URL(call.url).hostname) && !call.url.includes("integrations/posthog")));
});

test("watchdog reuses archived incidents and rejects untrusted run links", async () => {
  const { reportFailure, FAILURE_TITLE } = await import(script);
  const writes = [];
  const fetchImpl = async (url, options) => {
    if (url.includes("status=Normal")) return response({ tasks: [] });
    if (url.includes("status=Archive")) return response({ tasks: [{ title: FAILURE_TITLE, id: 100, status: "Archive" }] });
    if (url.includes("/projects?")) return response({ projects: [{ id: 4060, sections: [{ id: 10, title: "Backlog" }, { id: 20, title: "Done" }] }] });
    writes.push(JSON.parse(options.body)); return response({ success: true });
  };
  await reportFailure({ fetchImpl, token: "fixture", runId: "10001", runUrl: "https://github.com/hypertask-ai/hypertask/actions/runs/10001" });
  assert.equal(writes.length, 2);
  assert.equal(writes[0].status, "Normal");
  await assert.rejects(reportFailure({ fetchImpl, token: "fixture", runId: "10001", runUrl: "https://attacker.test/10001" }), /identity are invalid/);
});

test("nightly and independent workflow_run watchdog use trusted production code and existing CI identity", () => {
  const nightly = yaml.load(readFileSync(new URL("../.github/workflows/posthog-error-nightly.yml", `file://${__filename}`), "utf8"));
  const watcher = yaml.load(readFileSync(new URL("../.github/workflows/posthog-error-watchdog.yml", `file://${__filename}`), "utf8"));
  assert.equal(nightly.on.schedule[0].cron, "17 2 * * *");
  assert.equal(nightly.jobs.canary["timeout-minutes"], 20);
  assert.deepEqual(watcher.on.workflow_run.workflows, ["PostHog Error Alert", "PostHog Error Nightly Canary"]);
  assert.deepEqual(watcher.on.workflow_run.types, ["completed"]);
  assert.deepEqual(watcher.on.workflow_run.branches, ["production"]);
  assert.ok(String(watcher.jobs.report.if).includes("failure"));
  assert.ok(String(watcher.jobs.report.if).includes("timed_out"));
  assert.equal(watcher.concurrency["cancel-in-progress"], false);
  for (const job of [nightly.jobs.canary, watcher.jobs.report]) {
    assert.equal(job["runs-on"], "ubuntu-latest");
    assert.equal(job.steps[0].with.ref, "production");
    assert.equal(job.steps[1].env.HYPERTASK_MCP_TOKEN, "${{ secrets.HYPERTASK_MCP_TOKEN }}");
  }
});


test("review watchdog reopen returns Normal Done tickets to board 4060 active sections", async () => {
  const { reportFailure, FAILURE_TITLE } = await import(script);
  for (const sections of [
    [{ id: 11, section_title: "In Progress" }, { id: 20, section_title: "Done" }, { id: 10, section_title: "Backlog" }],
    [{ id: 20, title: "Done" }, { id: 11, title: "Todo" }],
  ]) {
    const writes = [];
    const fetchImpl = async (url, options) => {
      if (url.includes("/tasks?")) return response({ tasks: [{ title: FAILURE_TITLE, id: 100, status: "Normal", sectionId: 20 }] });
      if (url.includes("/projects?")) return response({ projects: [{ id: 15, sections: [{ id: 99, title: "Backlog" }] }, { id: 4060, sections }] });
      writes.push({ url, body: JSON.parse(options.body) });
      return response({ success: true });
    };
    assert.equal((await reportFailure({ fetchImpl, token: "fixture", runId: "10001", runUrl: "https://github.com/hypertask-ai/hypertask/actions/runs/10001" })).action, "updated");
    assert.deepEqual(writes[0].body, { task_id: 100, status: "Normal", sectionId: sections.length === 3 ? 10 : 11 });
    assert.match(writes[0].url, /tasks\/update$/);
    assert.match(writes[1].url, /comments$/);
  }
  await assert.rejects(reportFailure({ token: "fixture", runId: "10001", runUrl: "https://github.com/hypertask-ai/hypertask/actions/runs/10001", fetchImpl: async (url) => response(url.includes("/tasks?") ? { tasks: [{ title: FAILURE_TITLE, id: 100, status: "Normal", sectionId: 20 }] } : { projects: [{ id: 4060, sections: [{ id: 20, title: "Done" }] }] }) }), /active section is unavailable/);
});


test("canary verifies and closes an independent fallback only after matching the real PostHog issue", async () => {
  const { runCanary } = await import(script);
  const writes = [];
  const receipt = `<p>posthog-dispatch-fallback:issue:${ISSUE_ID}:0199aa11-bb22-7c33-8d44-000000000001</p>`;
  const fetchImpl = async (url, options) => {
    if (url.endsWith("/error-test")) return response({}, 500);
    if (url.includes("/error_tracking/issues/?")) { assert.equal(options.method, "GET"); return response({ results: [{ id: ISSUE_ID, description: "PostHog pipeline canary yper4-331-123-1" }], next: null }); }
    if (url.includes("/tasks?")) return response({ tasks: new URL(url).searchParams.get("project_id") === "4060" ? [{ id: 101, description: receipt }] : [] });
    if (url.includes("/issues/")) return response({ id: ISSUE_ID, description: "PostHog pipeline canary yper4-331-123-1", status: options.method === "PATCH" ? "resolved" : "active" });
    if (url.includes("/projects?")) return response({ projects: [{ id: 15, sections: [{ id: 777, section_title: "Done" }] }, { id: 4060, sections: [{ id: 888, section_title: "Done" }] }] });
    if (url.endsWith("/tasks/update")) { writes.push(JSON.parse(options.body)); return response({ success: true }); }
    assert.fail(url);
  };
  const options = { fetchImpl, token: "fixture", testToken: "fixture", apiKey: "ph-fixture", runId: "123", attempt: "1" };
  const result = await runCanary(options);
  assert.equal(result.delivery, "fallback");
  assert.equal(result.boardId, 4060);
  assert.deepEqual(writes, [{ task_id: 101, sectionId: 888 }]);
  writes.length = 0;
  await assert.rejects(runCanary({ ...options, fetchImpl: async (url, opts) => url.includes(`/issues/${ISSUE_ID}/`) ? response({ id: ISSUE_ID, description: "another customer's error" }) : fetchImpl(url, opts) }), /does not match the nightly canary/);
  assert.equal(writes.length, 0);
  await assert.rejects(runCanary({ ...options, fetchImpl: async (url, opts) => url.includes("/error_tracking/issues/?") ? response({ results: [{ id: ISSUE_ID, description: "yper4-331-123-1" }, { id: "01a128a7-88f1-7753-b94b-4f8ec8f7cbde", description: "yper4-331-123-1" }], next: null }) : fetchImpl(url, opts) }), /ambiguous/);
});

test("canary issue discovery uses only bounded same-origin REST reads", async () => {
  const { findCanaryIssue } = await import(script);
  const endpoint = "https://eu.posthog.com/api/projects/236160/error_tracking/issues/";
  const calls = [];
  const options = { apiKey: "fixture", marker: "yper4-331-123-1", deadline: 900_000, now: () => 0 };
  const found = await findCanaryIssue({ ...options, fetchImpl: async (url, request) => {
    assert.equal(request.method, "GET");
    assert.equal(Object.hasOwn(request, "body"), false);
    calls.push(url);
    return response({ results: url.includes("offset=100") ? [{ id: ISSUE_ID, description: "yper4-331-123-1" }] : [], next: url.includes("offset=100") ? null : `${endpoint}?limit=100&offset=100` });
  } });
  assert.equal(found, ISSUE_ID);
  assert.equal(calls.length, 2);
  let refusedCalls = 0;
  for (const next of ["https://untrusted.example/issues/", `${endpoint}?limit=100`, "https://eu.posthog.com/api/projects/another/issues/"]) {
    await assert.rejects(findCanaryIssue({ ...options, fetchImpl: async () => {
      refusedCalls++;
      return response({ results: [], next });
    } }), /pagination is invalid/);
  }
  assert.equal(refusedCalls, 3);
  await assert.rejects(findCanaryIssue({ ...options, fetchImpl: async () => response({}, 403) }), /HTTP 403/);
  await assert.rejects(findCanaryIssue({ ...options, deadline: 0, fetchImpl: async () => assert.fail("expired lookup fetched") }), /exceeded fifteen minutes/);
});
