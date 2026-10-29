const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const yaml = require("js-yaml");
const path = require("node:path");
const jiti = require("jiti").createJiti(__filename, { alias: { "@": path.resolve(__dirname, "../src") } });
const { sanitizeRichHtml } = jiti("../src/utils/helperFunctions/sanitizeRichHtml.ts");
const { normalizeBlockHtml } = jiti("../src/lib/mcp/normalizeBlockHtml.ts");
const script = new URL("../.github/scripts/posthog-error-issues.mjs", `file://${__filename}`);
const ID = "01a128a7-88f1-7753-b94b-4f8ec8f7cbdf";
const SINCE = "2026-10-10T00:00:00Z";
const config = { appUrl: "https://app.hypertask.ai", boardId: 15, bugsSectionId: 4389, severityLabels: { P1: "label-p1", P2: "label-p2", P3: "label-p3" } };
function response(body, status = 200) { return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }; }
function row(count = 12, users = 2, message = "No output generated.") { return [count, users, "2026-10-11T00:00:00Z", "2026-10-12T00:00:00Z", JSON.stringify([{ value: message }]), "handled", "/api/ai/task-writer", 0]; }
function issue(overrides = {}) { return { issue_id: ID, count: 12, users: 2, unidentified_hits: 0, severity: "P2", severity_reason: "Feature failed", name: "Error", message: "No output generated.", timestamp: "2026-10-11T00:00:00Z", last_seen: "2026-10-12T00:00:00Z", issue_url: `https://eu.posthog.com/project/236160/error_tracking/${ID}`, ...overrides }; }

function board() {
  const tasks = [];
  const calls = [];
  const comments = new Map();
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    const parsed = new URL(url);
    const body = options.body ? JSON.parse(options.body) : null;
    if (parsed.pathname === "/api/mcp/tasks") return response({ tasks: tasks.filter((task) => parsed.searchParams.has("task_id") ? task.id === Number(parsed.searchParams.get("task_id")) : task.status === parsed.searchParams.get("status") && task.description.includes(parsed.searchParams.get("search"))) });
    if (body?.description) body.description = normalizeBlockHtml(sanitizeRichHtml(body.description));
    if (parsed.pathname === "/api/mcp/tasks/create") {
      const task = { ...body, id: tasks.length + 1000, status: "Normal", ticketNumber: `HTPR-${tasks.length + 7001}`, labels: body.labels.map((id) => ({ id, name: Object.keys(config.severityLabels).find((key) => config.severityLabels[key] === id) })) };
      tasks.push(task); return response({ success: true, task });
    }
    if (parsed.pathname === "/api/mcp/comments") { comments.set(options.headers["Idempotency-Key"], body); return response({ success: true }); }
    if (parsed.pathname === "/api/mcp/tasks/update") {
      assert.equal(Object.hasOwn(body, "description"), false, "repeat must not write the description");
      assert.equal(Object.hasOwn(body, "labels"), false, "severity must use per-label mutations");
      const task = tasks.find((task) => task.id === body.task_id);
      Object.assign(task, body);
      task.labels = task.labels.filter((label) => !body.remove_labels?.includes(label.id));
      for (const id of body.add_labels || []) {
        if (!task.labels.some((label) => label.id === id)) task.labels.push({ id, name: Object.keys(config.severityLabels).find((key) => config.severityLabels[key] === id) });
      }
      return response({ success: true });
    }
    throw new Error(`unexpected request ${url}`);
  };
  return { tasks, calls, comments, fetchImpl };
}

test("issue-id dedupe persists through repeated polls, releases and archived tickets", async () => {
  const { upsertIssue } = await import(script);
  const state = board();
  assert.equal((await upsertIssue(state.fetchImpl, "fixture", config, issue())).action, "created");
  assert.equal((await upsertIssue(state.fetchImpl, "fixture", config, issue())).action, "updated");
  const task = state.tasks[0];
  task.title = "Human edited title";
  task.description += "<p>Human investigation</p>";
  task.labels.push({ id: "custom-label", name: "manual" });
  task.status = "Archive";
  task.assignees = ["human"];
  assert.equal((await upsertIssue(state.fetchImpl, "fixture", config, issue({ count: 30, users: 10, severity: "P1" }))).action, "updated");
  assert.equal((await upsertIssue(state.fetchImpl, "fixture", config, issue({ count: 30, users: 10, severity: "P1" }))).action, "updated");
  assert.equal(state.tasks.length, 1);
  assert.equal(state.comments.size, 2);
  assert.match([...state.comments.values()][1].text, /30 production hits, 10 known users/);
  assert.match(task.description, /Production hits: 12/);
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
  assert.equal((await upsertIssue(state.fetchImpl, "fixture", config, issue())).action, "updated");
  assert.equal(state.tasks.length, 1);
});

test("native alerts read only their issue, with production counts and ingestion-lag retries", async () => {
  const { readProductionIssue } = await import(script);
  const calls = [];
  const waits = [];
  let queries = 0;
  const result = await readProductionIssue(async (url, options) => {
    calls.push({ url, options });
    if (url.includes("/issues/")) return response({ id: ID, name: "Error" });
    return response({ results: [++queries === 1 ? [0, 0, null, null, null, null, null, 0] : row()] });
  }, "fixture", ID, { wait: async (ms) => waits.push(ms) });
  assert.equal(result.issue_id, ID);
  assert.equal(result.count, 12);
  assert.equal(result.users, 2);
  assert.equal(result.severity, "P2");
  assert.deepEqual(waits, [10_000]);
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, new RegExp(`/issues/${ID}/$`));
  const query = JSON.parse(calls[1].options.body).query.query;
  assert.match(query, new RegExp(ID));
  assert.match(query, /ht_environment = 'production'/);
  assert.match(query, /https:\/\/app.hypertask.ai\/%/);
  assert.match(query, /ht_environment IS NULL/);
  assert.doesNotMatch(query, /ht_release|ht_source = 'server'/);
  assert.match(query, /distinct_id != 'hypertask-app'/);
});

test("malformed counts, wrong issues and unsafe IDs fail loudly", async () => {
  const { readProductionIssue, issueQuery } = await import(script);
  assert.throws(() => issueQuery("' OR 1=1"), /issue ID is invalid/);
  await assert.rejects(readProductionIssue(async () => response({ id: "wrong" }), "fixture", ID), /different issue/);
  for (const bad of [{ results: [row()], hasMore: true }, { results: [row(-1)] }, { results: [] }]) {
    await assert.rejects(readProductionIssue(async (url) => response(url.includes("/issues/") ? { id: ID } : bad), "fixture", ID), /missing or truncated|counts are invalid/);
  }
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

test("deleted issue tickets are left untouched without comments or a replacement ticket", async () => {
  const { upsertIssue } = await import(script);
  const state = board();
  await upsertIssue(state.fetchImpl, "fixture", config, issue());
  const task = state.tasks[0];
  task.status = "Deleted";
  const before = JSON.stringify(task);
  assert.equal((await upsertIssue(state.fetchImpl, "fixture", config, issue({ count: 30, users: 15 }))).action, "skip");
  assert.equal(state.comments.size, 0);
  assert.equal(state.tasks.length, 1);
  assert.equal(JSON.stringify(task), before);
});

test("native reopen updates the same Done or archived ticket even when counts have not increased", async () => {
  const { upsertIssue } = await import(script);
  const state = board();
  await upsertIssue(state.fetchImpl, "fixture", config, issue());
  state.tasks[0].sectionId = 999;
  state.tasks[0].status = "Archive";
  const fetchImpl = async (url, options) => url.includes("/projects?") ? response({ projects: [{ id: 15, sections: [{ id: 999, section_title: "Done" }] }] }) : state.fetchImpl(url, options);
  const reopened = issue({ alert_kind: "issue_reopened", event_id: "01a11c15-dcdc-7c01-baaf-34a5fb318228" });
  assert.equal((await upsertIssue(fetchImpl, "fixture", config, reopened)).action, "updated");
  assert.equal((await upsertIssue(fetchImpl, "fixture", config, reopened)).action, "updated");
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].status, "Normal");
  assert.equal(state.tasks[0].sectionId, 4389);
  assert.equal(state.comments.size, 1);
  assert.match([...state.comments.values()][0].text, /reopened/);
});

test("spikes add their native count and baseline once, or create the same issue-rated ticket", async () => {
  const { upsertIssue } = await import(script);
  const state = board();
  const spike = issue({ alert_kind: "issue_spiking", event_id: "01a11c15-dcdc-7c01-baaf-34a5fb318228", spike_count: 51, spike_baseline: 2 });
  await upsertIssue(state.fetchImpl, "fixture", config, spike);
  assert.match(state.tasks[0].description, /spike: 51 hits.*baseline 2/);
  const nextSpike = { ...spike, event_id: "01a11c15-dcdc-7c01-baaf-34a5fb318229" };
  await upsertIssue(state.fetchImpl, "fixture", config, nextSpike);
  await upsertIssue(state.fetchImpl, "fixture", config, nextSpike);
  assert.equal(state.tasks.length, 1);
  assert.equal(state.comments.size, 1);
  assert.match([...state.comments.values()][0].text, /spike: 51 hits.*baseline 2/);
});


function signedPayload() {
  const { createHmac } = require("node:crypto");
  const payload = { alert_kind: "issue_created", issue_id: ID, event_id: ID, environment: "production", timestamp: SINCE, dispatched_at: SINCE };
  payload.dispatch_signature = createHmac("sha256", "fixture-secret").update(JSON.stringify(Object.entries(payload).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))).digest("hex");
  return payload;
}

function lagOptions(extra = {}) {
  return { now: Date.parse(SINCE), dispatchSecret: "fixture-secret", apiKey: "fixture", mcpToken: "fixture", githubToken: "fixture-github", githubRepository: "hypertask-ai/hypertask", githubRef: "production", ...extra };
}

const emptyRow = [0, 0, null, null, null, null, null, 0];

function issueFetch({ all = emptyRow, finalProduction = emptyRow, dispatchStatus = 204 } = {}, calls = []) {
  let productionReads = 0;
  return async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("/issues/")) return response({ id: ID });
    if (url.includes("/query/")) {
      const production = JSON.parse(options.body).query.query.includes("ht_environment = 'production'");
      return response({ results: [production ? (++productionReads > 5 ? finalProduction : emptyRow) : all] });
    }
    assert.match(url, /api\.github\.com\/repos\/hypertask-ai\/hypertask\/actions\/workflows\/posthog-error-alert.yml\/dispatches$/);
    return response({}, dispatchStatus);
  };
}

test("non-production-only issues skip after the full retry window without board writes", async () => {
  const { handlePostHogAlert } = await import("../.github/scripts/posthog-error-alert.mjs");
  const calls = [], waits = [];
  const result = await handlePostHogAlert(signedPayload(), lagOptions({ fetchImpl: issueFetch({ all: row() }, calls), wait: async (ms) => waits.push(ms) }));
  assert.equal(result.action, "skip");
  assert.match(result.reason, /only non-production/);
  assert.deepEqual(waits, [10000, 20000, 30000, 60000]);
  assert.equal(calls.length, 8);
  assert.doesNotMatch(JSON.parse(calls[6].options.body).query.query, /ht_environment|app\.hypertask\.ai/);
  assert.match(JSON.parse(calls[7].options.body).query.query, /ht_environment = 'production'/);
});

test("forced test errors marked [ht-forced-test] are skipped without board writes; unmarked errors still file (YPER4-384)", async () => {
  const { handlePostHogAlert } = await import("../.github/scripts/posthog-error-alert.mjs");
  const { readProductionIssue } = await import(script);
  const fetchFor = (message, calls) => async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("/issues/")) return response({ id: ID, name: "Error" });
    if (url.includes("/query/")) return response({ results: [row(1, 0, message)] });
    throw new Error(`unexpected write ${url}`);
  };
  const calls = [];
  const result = await handlePostHogAlert(signedPayload(), lagOptions({ fetchImpl: fetchFor("Error: [ht-forced-test] YPER4-384 forced browser test 1", calls), wait: async () => {} }));
  assert.equal(result.action, "skip");
  assert.match(result.reason, /forced test/i);
  assert.ok(calls.every((call) => !/\/tasks\//.test(call.url)));
  const real = await readProductionIssue(fetchFor("Error: YPER4-377 forced browser test 1", []), "fixture", ID, { wait: async () => {} });
  assert.equal(real.action, undefined);
  assert.equal(real.message, "Error: YPER4-377 forced browser test 1");
});

test("disposable QA intake fixture errors are skipped without board writes; unmarked errors still file (HTPR-8184)", async () => {
  const { readProductionIssue } = await import(script);
  const fetchFor = (message, calls) => async (url) => {
    calls.push(url);
    if (url.includes("/issues/")) return response({ id: ID, name: "Error" });
    if (url.includes("/query/")) return response({ results: [row(1, 0, message)] });
    throw new Error(`unexpected write ${url}`);
  };
  const calls = [];
  const fixture = await readProductionIssue(fetchFor("Error. YPER4-922 QA intake d5e54343 disposable error routing fixture", calls), "fixture", ID, { wait: async () => {} });
  assert.equal(fixture.action, "skip");
  assert.match(fixture.reason, /disposable QA intake/i);
  assert.ok(calls.every((url) => !/\/tasks\//.test(url)));
  const real = await readProductionIssue(fetchFor("Error. QA intake review did not finish", []), "fixture", ID, { wait: async () => {} });
  assert.equal(real.action, undefined);
});

test("lag dispatches attempts 2 and 3 with the unchanged signed payload and no ticket", async () => {
  const { handlePostHogAlert, verifyPostHogPayloadSignature } = await import("../.github/scripts/posthog-error-alert.mjs");
  const payload = signedPayload();
  for (const attempt of [1, 2]) {
    const calls = [], waits = [];
    const result = await handlePostHogAlert(payload, lagOptions({ attempt, fetchImpl: issueFetch({}, calls), wait: async (ms) => waits.push(ms) }));
    assert.equal(result.action, "retry_dispatched");
    assert.equal(result.attempt, attempt + 1);
    assert.deepEqual(waits, [10000, 20000, 30000, 60000]);
    const dispatch = calls.at(-1);
    const body = JSON.parse(dispatch.options.body);
    assert.equal(body.ref, "production");
    assert.equal(body.inputs.attempt, String(attempt + 1));
    assert.deepEqual(JSON.parse(body.inputs.posthog_payload), payload);
    assert.equal(verifyPostHogPayloadSignature(JSON.parse(body.inputs.posthog_payload), "fixture-secret"), true);
    assert.equal(dispatch.options.headers.Authorization, "Bearer fixture-github");
    assert.equal(calls.length, 8);
  }
});

test("production rows arriving at the final all-environment check are handled normally", async () => {
  const { readProductionIssue } = await import(script);
  const result = await readProductionIssue(issueFetch({ all: row(50, 20), finalProduction: row(12, 2) }), "fixture", ID, { wait: async () => {} });
  assert.equal(result.count, 12);
  assert.equal(result.users, 2);
  assert.equal(result.severity, "P2");
});

test("final lag attempt fails instead of dispatching again or creating a ticket", async () => {
  const { handlePostHogAlert } = await import("../.github/scripts/posthog-error-alert.mjs");
  const calls = [], waits = [];
  await assert.rejects(handlePostHogAlert(signedPayload(), lagOptions({ attempt: 3, fetchImpl: issueFetch({}, calls), wait: async (ms) => waits.push(ms) })), /no exceptions in any environment after 3 attempts.*watchdog/);
  assert.equal(calls.length, 7);
  assert.deepEqual(waits, [10000, 20000, 30000, 60000]);
});

test("final lag attempt CLI exits non-zero so the watchdog observes failure", () => {
  const { spawnSync } = require("node:child_process");
  const preload = `
    import timers from 'node:timers/promises';
    import { syncBuiltinESMExports } from 'node:module';
    timers.setTimeout = async () => {};
    syncBuiltinESMExports();
    globalThis.fetch = async (url) => {
      const body = url.includes('/issues/') ? { id: '${ID}' } : { results: [[0, 0, null, null, null, null, null, 0]] };
      if (!url.includes('posthog.com')) throw new Error('unexpected non-PostHog request');
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    };
  `;
  const payload = signedPayload();
  payload.dispatched_at = new Date().toISOString();
  const { createHmac } = require("node:crypto");
  payload.dispatch_signature = createHmac("sha256", "fixture-secret").update(JSON.stringify(Object.entries(payload).filter(([key]) => key !== "dispatch_signature").sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))).digest("hex");
  const result = spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(preload)}`, new URL("../.github/scripts/posthog-error-alert.mjs", `file://${__filename}`).pathname], {
    env: { ...process.env, POSTHOG_ALERT_PAYLOAD: JSON.stringify(payload), POSTHOG_ALERT_ATTEMPT: "3", POSTHOG_ALERT_DISPATCH_SECRET: "fixture-secret", POSTHOG_FULL_API_KEY: "fixture", HYPERTASK_MCP_TOKEN: "fixture" },
    encoding: "utf8", timeout: 10000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /::error::PostHog alert failed:.*after 3 attempts.*watchdog/);
  assert.equal(result.stdout, "");
});

test("failed lag dispatch and invalid attempts fail closed", async () => {
  const { handlePostHogAlert } = await import("../.github/scripts/posthog-error-alert.mjs");
  await assert.rejects(handlePostHogAlert(signedPayload(), lagOptions({ fetchImpl: issueFetch({ dispatchStatus: 403 }), wait: async () => {} })), /HTTP 403/);
  for (const attempt of [0, 4, 1.5, NaN]) {
    await assert.rejects(handlePostHogAlert(signedPayload(), lagOptions({ attempt, fetchImpl: async () => assert.fail("invalid attempt fetched") })), /attempt must be between 1 and 3/);
  }
});

test("repeat alerts leave descriptions byte-for-byte intact and produce one short HTML comment", async () => {
  const { upsertIssue } = await import(script);
  const state = board();
  await upsertIssue(state.fetchImpl, "fixture", config, issue());
  const task = state.tasks[0];
  task.description = task.description.replace("</ul>", "<li>Human note inside the original summary</li></ul>") + "<p>Human footer</p>";
  const description = task.description;
  const before = state.calls.length;
  await upsertIssue(state.fetchImpl, "fixture", config, issue({ count: 20, users: 3 }));
  assert.equal(task.description, description);
  assert.equal(state.comments.size, 1);
  const comment = [...state.comments.values()][0];
  assert.equal(comment.content_type, "html");
  assert.match(comment.text, /^<p><strong>[^<]+<\/strong><\/p>/);
  assert.match(comment.text, /20 production hits, 3 known users/);
  assert.match(comment.text, /<p>Next: [^<]+<\/p>$/);
  assert.equal(state.calls.slice(before).filter((call) => call.url.endsWith("/comments")).length, 1);
  assert.equal(state.calls.slice(before).some((call) => call.url.endsWith("/tasks/update")), false);
  assert.doesNotMatch(description, /posthog-count|posthog-users|posthog-issue-(?:start|end)/);
});

test("each later Actions alert run gets one comment even when counts are unchanged", async () => {
  const { upsertIssue } = await import(script);
  const state = board();
  await upsertIssue(state.fetchImpl, "fixture", config, issue());
  const previous = process.env.GITHUB_RUN_ID;
  try {
    for (const id of ["fixture-run-1", "fixture-run-2"]) {
      process.env.GITHUB_RUN_ID = id;
      await upsertIssue(state.fetchImpl, "fixture", config, issue({ event_id: ID, alert_kind: "issue_created" }));
    }
    assert.equal(state.comments.size, 2);
    assert.equal(state.calls.filter((call) => call.url.endsWith("/comments")).length, 2);
  } finally {
    if (previous === undefined) delete process.env.GITHUB_RUN_ID;
    else process.env.GITHUB_RUN_ID = previous;
  }
});

test("later alerts recompute severity in either direction with per-label updates and a comment", async () => {
  const { upsertIssue } = await import(script);
  const state = board();
  await upsertIssue(state.fetchImpl, "fixture", config, issue());
  const task = state.tasks[0];
  const description = task.description;
  task.labels.push({ id: "human-label", name: "Investigation" });
  for (const [users, old, next] of [[12, "P2", "P1"], [1, "P1", "P2"]]) {
    await upsertIssue(state.fetchImpl, "fixture", config, issue({ users }));
    assert.deepEqual(task.labels.map((label) => label.id), ["human-label", config.severityLabels[next]]);
    assert.match([...state.comments.values()].at(-1).text, new RegExp(`Severity changed from ${old} to ${next}`));
    const update = JSON.parse(state.calls.findLast((call) => call.url.endsWith("/tasks/update")).options.body);
    assert.deepEqual(update.remove_labels, [config.severityLabels[old]]);
    assert.deepEqual(update.add_labels, [config.severityLabels[next]]);
    assert.equal(task.description, description);
  }
});

test("a concurrent human label added after the refresh survives the severity mutation", async () => {
  const { upsertIssue } = await import(script);
  const state = board();
  await upsertIssue(state.fetchImpl, "fixture", config, issue());
  const fetchImpl = async (url, options) => {
    if (url.endsWith("/tasks/update")) state.tasks[0].labels.push({ id: "fresh-human-label", name: "Human investigation" });
    return state.fetchImpl(url, options);
  };
  await upsertIssue(fetchImpl, "fixture", config, issue({ users: 12 }));
  assert.deepEqual(state.tasks[0].labels.map((label) => label.id), ["fresh-human-label", "label-p1"]);
});

test("review lifecycle concurrency keeps every lifecycle run independent", () => {
  const workflow = yaml.load(readFileSync(new URL("../.github/workflows/posthog-error-alert.yml", `file://${__filename}`), "utf8"));
  assert.equal(workflow.concurrency.group, "${{ format('posthog-error-{0}', github.run_id) }}");
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
});

test("review racing creation rechecks before create and converges duplicates on the oldest ticket", async () => {
  const { upsertIssue } = await import(script);
  const state = board();
  let creations = 0;
  let release;
  const created = new Promise((resolve) => { release = resolve; });
  const fetchImpl = async (url, options) => {
    const result = await state.fetchImpl(url, options);
    if (url.endsWith("/tasks/create")) {
      if (++creations === 2) release();
      await created;
    }
    // Reverse search ordering to prove the canonical choice does not depend on it.
    if (url.includes("/tasks?")) {
      const page = JSON.parse(await result.text());
      return response({ tasks: page.tasks.reverse() });
    }
    return result;
  };
  await Promise.all([
    upsertIssue(fetchImpl, "fixture", config, issue({ count: 10, users: 1, alert_kind: "issue_created", event_id: ID })),
    upsertIssue(fetchImpl, "fixture", config, issue({ count: 60, users: 12, alert_kind: "issue_spiking", event_id: "01a11c15-dcdc-7c01-baaf-34a5fb318228", spike_count: 60, spike_baseline: 2 })),
  ]);
  assert.equal(creations, 2);
  const active = state.tasks.filter((task) => task.status === "Normal");
  assert.equal(active.length, 1);
  assert.equal(active[0].id, 1000);
  assert.match([...state.comments.values()].at(-1).text, /60 production hits, 12 known users/);
  assert.deepEqual(active[0].labels.map((label) => label.id), ["label-p1"]);
  assert.equal(state.tasks[1].status, "Archive");
  await upsertIssue(state.fetchImpl, "fixture", config, issue({ count: 61, users: 12 }));
  assert.equal(state.tasks.length, 2);
  assert.match([...state.comments.values()].at(-1).text, /61 production hits/);
  const beforeCreate = state.calls.slice(0, state.calls.findIndex((call) => call.url.endsWith("/tasks/create")));
  assert.equal(beforeCreate.filter((call) => call.url.includes("status=Deleted")).length, 4);
});


test("review racing creation avoids creating when the immediate recheck finds a ticket", async () => {
  const { upsertIssue } = await import(script);
  const state = board();
  await upsertIssue(state.fetchImpl, "fixture", config, issue());
  let searches = 0;
  const fetchImpl = async (url, options) => {
    if (url.includes("/tasks?") && !url.includes("task_id=")) {
      if (++searches <= 3) return response({ tasks: [] });
    }
    return state.fetchImpl(url, options);
  };
  assert.equal((await upsertIssue(fetchImpl, "fixture", config, issue({ count: 20 }))).action, "updated");
  assert.equal(state.tasks.length, 1);
  assert.equal(state.calls.filter((call) => call.url.endsWith("/tasks/create")).length, 1);
  assert.match([...state.comments.values()].at(-1).text, /20 production hits/);
});
