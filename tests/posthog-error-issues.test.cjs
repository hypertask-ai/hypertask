const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const yaml = require("js-yaml");
const script = new URL("../.github/scripts/posthog-error-poll.mjs", `file://${__filename}`);
const ID = "01a128a7-88f1-7753-b94b-4f8ec8f7cbdf";
const SINCE = "2026-10-10T00:00:00Z";
const config = { appUrl: "https://app.hypertask.ai", boardId: 15, bugsSectionId: 4389, severityLabels: { P1: "label-p1", P2: "label-p2", P3: "label-p3" } };
function response(body, status = 200) { return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }; }
function row(id = ID, count = 12, users = 2, message = "No output generated.") { return [id, count, users, "2026-10-11T00:00:00Z", "2026-10-12T00:00:00Z", JSON.stringify([{ value: message }]), "handled", "/api/ai/task-writer", 0]; }
function issue(overrides = {}) { return { issue_id: ID, count: 12, users: 2, unidentified_hits: 0, severity: "P2", severity_reason: "Feature failed", name: "Error", message: "No output generated.", timestamp: "2026-10-11T00:00:00Z", last_seen: "2026-10-12T00:00:00Z", issue_url: `https://eu.posthog.com/project/236160/error_tracking/${ID}`, ...overrides }; }

function board() {
  const tasks = [];
  const calls = [];
  const comments = new Map();
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    const parsed = new URL(url);
    const body = options.body ? JSON.parse(options.body) : null;
    if (parsed.pathname === "/api/mcp/tasks") return response({ tasks: tasks.filter((task) => task.status === parsed.searchParams.get("status") && task.description.includes(parsed.searchParams.get("search"))) });
    if (parsed.pathname === "/api/mcp/tasks/create") {
      const task = { ...body, id: tasks.length + 1000, status: "Normal", ticketNumber: `HTPR-${tasks.length + 7001}`, labels: body.labels.map((id) => ({ id, name: Object.keys(config.severityLabels).find((key) => config.severityLabels[key] === id) })) };
      tasks.push(task); return response({ success: true, task });
    }
    if (parsed.pathname === "/api/mcp/comments") { comments.set(options.headers["Idempotency-Key"], body); return response({ success: true }); }
    if (parsed.pathname === "/api/mcp/tasks/update") { Object.assign(tasks.find((task) => task.id === body.task_id), body, { labels: body.labels?.map((id) => ({ id, name: Object.keys(config.severityLabels).find((key) => config.severityLabels[key] === id) || "human-label" })) }); return response({ success: true }); }
    throw new Error(`unexpected request ${url}`);
  };
  return { tasks, calls, comments, fetchImpl };
}

test("issue-id dedupe persists through repeated polls, releases and archived tickets", async () => {
  const { upsertIssue } = await import(script);
  const state = board();
  assert.equal((await upsertIssue(state.fetchImpl, "fixture", config, issue())).action, "created");
  assert.equal((await upsertIssue(state.fetchImpl, "fixture", config, issue())).action, "unchanged");
  const task = state.tasks[0];
  task.title = "Human edited title";
  task.description += "<p>Human investigation</p>";
  task.labels.push({ id: "custom-label", name: "manual" });
  task.status = "Archive";
  task.assignees = ["human"];
  assert.equal((await upsertIssue(state.fetchImpl, "fixture", config, issue({ count: 30, users: 10, severity: "P1" }))).action, "updated");
  assert.equal((await upsertIssue(state.fetchImpl, "fixture", config, issue({ count: 30, users: 10, severity: "P1" }))).action, "unchanged");
  assert.equal(state.tasks.length, 1);
  assert.equal(state.comments.size, 1);
  assert.match([...state.comments.values()][0].text, /30 production hits, 10 known users/);
  assert.match(task.description, /posthog-count:30/);
  assert.match(task.description, /Human investigation/);
  assert.equal(task.title, "Human edited title");
  assert.equal(task.status, "Archive");
  assert.deepEqual(task.assignees, ["human"]);
  assert.deepEqual(task.labels.map((label) => label.id), ["custom-label", "label-p1"]);
});

test("same text on different PostHog issues is not deduplicated by message or title", async () => {
  const { upsertIssue } = await import(script);
  const state = board();
  await upsertIssue(state.fetchImpl, "fixture", config, issue());
  await upsertIssue(state.fetchImpl, "fixture", config, issue({ issue_id: "01a11c15-dcdc-7c01-baaf-34a5fb318228" }));
  assert.equal(state.tasks.length, 2);
});

test("ambiguous successful create is recovered from its saved issue marker without refiling", async () => {
  const { upsertIssue } = await import(script);
  const state = board();
  const fetchImpl = async (url, options) => {
    const result = await state.fetchImpl(url, options);
    return url.endsWith("/tasks/create") ? response({ task: { id: 1000 } }) : result;
  };
  await assert.rejects(upsertIssue(fetchImpl, "fixture", config, issue()), /no valid ticket number/);
  assert.equal((await upsertIssue(state.fetchImpl, "fixture", config, issue())).action, "unchanged");
  assert.equal(state.tasks.length, 1);
});

test("all new production issues are read with paging, old known issues excluded and counts attached", async () => {
  const { readProductionIssues } = await import(script);
  const old = "01a11c15-dcdc-7c01-baaf-34a5fb318228";
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes("offset=100")) return response({ next: null, results: [{ id: ID, name: "Error", first_seen: "2026-10-11T00:00:00Z" }] });
    if (url.includes("/issues/")) return response({ next: "?limit=100&offset=100", results: [{ id: old, first_seen: "2026-10-01T00:00:00Z" }] });
    return response({ results: [row(), row(old)], hasMore: false });
  };
  const result = await readProductionIssues(fetchImpl, "fixture", SINCE);
  assert.equal(result.length, 1);
  assert.equal(result[0].issue_id, ID);
  assert.equal(result[0].count, 12);
  assert.equal(result[0].users, 2);
  assert.equal(result[0].severity, "P2");
  assert.equal(calls.length, 3);
  const query = JSON.parse(calls[2].options.body).query.query;
  assert.match(query, /ht_environment = 'production'/);
  assert.match(query, /https:\/\/app.hypertask.ai\/%/);
  assert.match(query, /ht_environment IS NULL/);
  assert.doesNotMatch(query, /ht_release|ht_source = 'server'/);
  assert.match(query, /distinct_id != 'hypertask-app'/);
  assert.match(result[0].issue_url, new RegExp(ID));
});

test("malformed, truncated and credential-redirecting PostHog responses fail closed", async () => {
  const { readProductionIssues, issueQuery } = await import(script);
  assert.throws(() => issueQuery("' OR 1=1"), /ISO timestamp/);
  await assert.rejects(readProductionIssues(async () => response({ next: "https://attacker.test/", results: [] }), "fixture", SINCE), /pagination is invalid/);
  await assert.rejects(readProductionIssues(async (url) => response(url.includes("/query/") ? { results: [row()], hasMore: true } : { results: [], next: null }), "fixture", SINCE), /truncated/);
  await assert.rejects(readProductionIssues(async (url) => response(url.includes("/query/") ? { results: [row(ID, -1)] } : { results: [{ id: ID, first_seen: SINCE }], next: null }), "fixture", SINCE), /counts are invalid/);
});

test("severity separates crashes, durable data failures, broad impact, feature failures and expected limits", async () => {
  const { rateIssue } = await import(script);
  for (const [message, users, source, expected] of [["AI usage persistence failed", 0, "server", "P1"], ["No output generated.", 1, "handled", "P2"], ["Invalid prisma.team.findUnique invocation", 1, "server", "P2"], ["Uncaught TypeError: cannot read", 1, "client", "P1"], ["Unexpected error", 10, "handled", "P1"], ["A dedicated team AI Gateway key or direct BYOK key is required for openai text inference.", 1, "handled", "P3"], ["This team has used its included AI allowance for this month.", 12, "handled", "P3"], ["Validation error", 1, "handled", "P3"], ["PostHog pipeline canary yper4-331-123-1", 0, "server", "P3"]]) {
    assert.equal(rateIssue(message, users, source).severity, expected, message);
  }
  assert.equal(rateIssue("Expected ',' after JSON from a model", 1, "handled").severity, "P2");
});

test("missing severity labels are created once through the supported project API", async () => {
  const { severityLabels } = await import(script);
  const calls = [];
  const result = await severityLabels(async (url, options) => {
    calls.push({ url, options });
    if (!options.method) return response({ labels: [{ name: "P1", id: "one" }] });
    const name = JSON.parse(options.body).name;
    return response({ label: { name, id: name } });
  }, "fixture", config);
  assert.deepEqual(result, { P1: "one", P2: "P2", P3: "P3" });
  assert.equal(calls.length, 3);
});

test("deleted issue tickets receive field counts without a forbidden comment or a replacement ticket", async () => {
  const { upsertIssue } = await import(script);
  const state = board();
  await upsertIssue(state.fetchImpl, "fixture", config, issue());
  state.tasks[0].status = "Deleted";
  state.tasks[0].description = state.tasks[0].description.replace(/posthog-count:\d+; posthog-users:\d+/, "");
  await upsertIssue(state.fetchImpl, "fixture", config, issue({ count: 30 }));
  await upsertIssue(state.fetchImpl, "fixture", config, issue({ count: 30 }));
  assert.equal(state.comments.size, 0);
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].status, "Deleted");
  assert.match(state.tasks[0].description, /posthog-count:30/);
});

test("whole poll continues after one failed issue and retries without duplicating successful issues", async () => {
  const { pollIssues } = await import(script);
  const state = board();
  const second = "01a11c15-dcdc-7c01-baaf-34a5fb318228";
  let fail = true;
  const labels = [];
  const fetchImpl = async (url, options = {}) => {
    if (url.includes("posthog.com") && url.includes("/issues/")) return response({ results: [{ id: ID, first_seen: SINCE }, { id: second, first_seen: SINCE }], next: null });
    if (url.includes("posthog.com") && url.includes("/query/")) return response({ results: [row(), row(second)] });
    if (url.endsWith("/labels")) {
      if (!options.method) return response({ labels });
      const name = JSON.parse(options.body).name;
      const label = { name, id: `label-${name.toLowerCase()}` };
      labels.push(label); return response({ label });
    }
    if (fail && url.endsWith("/tasks/create") && JSON.parse(options.body).description.includes(ID)) return response({}, 503);
    return state.fetchImpl(url, options);
  };
  await assert.rejects(pollIssues({ fetchImpl, apiKey: "fixture", token: "fixture", since: SINCE, config }), /1 PostHog issue ticket writes failed/);
  assert.equal(state.tasks.length, 1);
  fail = false;
  const result = await pollIssues({ fetchImpl, apiKey: "fixture", token: "fixture", since: SINCE, config });
  assert.equal(state.tasks.length, 2);
  assert.equal(result.created, 1);
  assert.equal(labels.length, 3);
  await assert.rejects(pollIssues({ fetchImpl, apiKey: "fixture", token: "fixture", since: "", config }), /activation timestamp/);
});

test("poll is scheduled every five minutes on trusted production with one writer", () => {
  const workflow = yaml.load(readFileSync(new URL("../.github/workflows/posthog-error-poll.yml", `file://${__filename}`), "utf8"));
  assert.equal(workflow.on.schedule[0].cron, "*/5 * * * *");
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.equal(workflow.jobs.issues.if, "github.ref == 'refs/heads/production'");
  assert.equal(workflow.jobs.issues.steps[0].with.ref, "production");
  assert.equal(workflow.jobs.issues.steps[1].env.POSTHOG_ISSUES_SINCE, "${{ vars.POSTHOG_ISSUES_SINCE }}");
});
