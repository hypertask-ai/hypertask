const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import(new URL("../.github/scripts/required-check-publishers.mjs", `file://${__filename}`));

const MINUTE = 60_000;
const now = Date.parse("2026-11-16T15:00:00Z");
const checks = (...contexts) => ({ rules: [{ type: "required_status_checks", parameters: { required_status_checks: contexts.map((context) => ({ context })) } }] });
const ruleset = { rules: [{ type: "deletion" }, ...checks("ci-tests", "premerge-evidence", "ci-tests").rules] };

function fakeGitHub(overrides = {}) {
  const calls = [];
  const gh = (endpoint) => {
    calls.push(endpoint);
    if (endpoint in overrides) return overrides[endpoint];
    if (endpoint === "repos/test/repo/rulesets?per_page=100") return [{ id: 42, name: "production-required-checks", enforcement: "active" }];
    if (endpoint === "repos/test/repo/rulesets/42") return ruleset;
    if (endpoint.startsWith("repos/test/repo/pulls?")) return [{ number: 7, updated_at: "2026-11-16T14:50:00Z", head: { sha: "a".repeat(40) } }];
    if (endpoint.includes("/check-runs?")) return { check_runs: [{ name: "ci-tests", started_at: "2026-11-16T14:40:00Z", completed_at: "2026-11-16T14:45:00Z" }] };
    if (endpoint.includes("/statuses?")) return [{ context: "pr-title", created_at: "2026-11-16T14:41:00Z" }];
    throw new Error(`unexpected read ${endpoint}`);
  };
  return { gh, calls };
}

function fakeBoard(tasks = [], storedStatus = "Normal") {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes("/tasks?")) return { ok: true, status: 200, json: async () => ({ tasks: url.includes(`status=${storedStatus}`) ? tasks : [] }) };
    if (url.includes("/projects?")) return { ok: true, status: 200, json: async () => ({ projects: [{ id: 11514, sections: [{ id: 7, section_title: "Backlog" }, { id: 9, section_title: "Done" }] }] }) };
    if (url.includes("/tasks/create")) return { ok: true, status: 200, json: async () => ({ success: true, task: { id: 900 } }) };
    if (url.includes("/tasks/update") || url.includes("/comments")) return { ok: true, status: 200, json: async () => ({ success: true }) };
    throw new Error(`unexpected board call ${url}`);
  };
  return { fetchImpl, calls };
}

const boardCall = (board, suffix) => JSON.parse(board.calls.find((call) => call.url.endsWith(suffix)).options.body);

test("the required contexts come from the live ruleset and are deduplicated", async () => {
  const { requiredContexts } = await load();
  assert.deepEqual(requiredContexts(ruleset), ["ci-tests", "premerge-evidence"]);
  assert.deepEqual(requiredContexts(checks()), []);
});

test("check runs and commit statuses are both read as published results", async () => {
  const { observations } = await load();
  const seen = observations(
    [{ name: "ci-tests", started_at: "2026-11-16T14:40:00Z" }, { name: "browser-smoke", started_at: null, completed_at: "2026-11-16T14:30:00Z" }],
    [{ context: "premerge-evidence", created_at: "2026-11-16T12:10:00Z" }, { context: "" }],
  );
  assert.deepEqual(seen.map((entry) => entry.context), ["ci-tests", "browser-smoke", "premerge-evidence"]);
});

test("a required check with no fresh result is silent while its neighbours keep reporting", async () => {
  const { silentRequiredChecks } = await load();
  const required = ["ci-tests", "premerge-evidence"];
  assert.deepEqual(silentRequiredChecks({ required, seen: [{ context: "ci-tests", at: now - 5 * MINUTE }], now }), { judged: true, silent: ["premerge-evidence"] });
  assert.deepEqual(silentRequiredChecks({ required, seen: [{ context: "ci-tests", at: now - MINUTE }, { context: "premerge-evidence", at: now - 300 * MINUTE }], now }).silent, ["premerge-evidence"]);
  assert.deepEqual(silentRequiredChecks({ required, seen: [{ context: "ci-tests", at: now - MINUTE }], now }).silent, ["premerge-evidence"]);
});

test("a quiet repository is never judged, so a real outage cannot be invented", async () => {
  const { silentRequiredChecks } = await load();
  const required = ["ci-tests"];
  assert.deepEqual(silentRequiredChecks({ required, seen: [{ context: "ci-tests", at: now - 600 * MINUTE }], now }), { judged: false, silent: [] });
  assert.deepEqual(silentRequiredChecks({ required, seen: [], now }), { judged: false, silent: [] });
  assert.deepEqual(silentRequiredChecks({ required, seen: [{ context: "ci-tests", at: now - 5 * MINUTE }], now }), { judged: true, silent: [] });
});

test("a silent required check comments once on the existing reporting ticket", async () => {
  const { run } = await load();
  const board = fakeBoard([{ id: 501, title: "[INFRA] A required check has no publisher" }]);
  const lines = [];
  const verdict = await run({ gh: fakeGitHub().gh, fetchImpl: board.fetchImpl, now, env: { REPO: "test/repo", HYPERTASK_MCP_TOKEN: "t" }, log: (line) => lines.push(line) });
  assert.deepEqual(verdict, { judged: true, silent: ["premerge-evidence"] });
  const body = boardCall(board, "/comments");
  assert.equal(body.task_id, 501);
  assert.equal(body.content_type, "html");
  assert.match(body.text, /<li><p>premerge-evidence<\/p><\/li>/);
  assert.doesNotMatch(body.text, /ci-tests/);
  assert.match(board.calls.find((call) => call.url.endsWith("/comments")).options.headers["Idempotency-Key"], /^required-check-publishers-[0-9a-f]{24}$/);
  assert.ok(lines.some((line) => line.includes("::warning::") && line.includes("premerge-evidence")));
});

test("the first silent check opens the reporting ticket on the monitoring board", async () => {
  const { run, TICKET_TITLE } = await load();
  const board = fakeBoard();
  await run({ gh: fakeGitHub().gh, fetchImpl: board.fetchImpl, now, env: { REPO: "test/repo", HYPERTASK_MCP_TOKEN: "t" }, log: () => {} });
  const created = boardCall(board, "/tasks/create");
  assert.equal(created.project_id, 11514);
  assert.equal(created.title, TICKET_TITLE);
  assert.match(created.description, /What's wrong or wanted/);
});

test("the first silent check posts its names as the first comment on the new ticket", async () => {
  const { run } = await load();
  const board = fakeBoard();
  await run({ gh: fakeGitHub().gh, fetchImpl: board.fetchImpl, now, env: { REPO: "test/repo", HYPERTASK_MCP_TOKEN: "t" }, log: () => {} });
  const order = board.calls.map((call) => call.url.split("/api/mcp")[1].split("?")[0]);
  assert.ok(order.indexOf("/tasks/create") < order.indexOf("/comments"));
  const body = boardCall(board, "/comments");
  assert.equal(body.task_id, 900);
  assert.match(body.text, /<li><p>premerge-evidence<\/p><\/li>/);
});

test("an archived reporting ticket is reopened before the comment lands on it", async () => {
  const { run } = await load();
  const board = fakeBoard([{ id: 501, title: "[INFRA] A required check has no publisher" }], "Archive");
  await run({ gh: fakeGitHub().gh, fetchImpl: board.fetchImpl, now, env: { REPO: "test/repo", HYPERTASK_MCP_TOKEN: "t" }, log: () => {} });
  const order = board.calls.map((call) => call.url.split("/api/mcp")[1].split("?")[0]);
  assert.deepEqual(order, ["/tasks", "/tasks", "/projects", "/tasks/update", "/tasks/update", "/comments"]);
  const updates = board.calls.filter((call) => call.url.endsWith("/tasks/update")).map((call) => JSON.parse(call.options.body));
  assert.deepEqual(updates, [{ task_id: 501, status: "Normal" }, { task_id: 501, sectionId: 7 }]);
  assert.equal(boardCall(board, "/comments").task_id, 501);
});

test("a healthy set of required checks writes nothing to the board", async () => {
  const { run } = await load();
  const board = fakeBoard();
  const github = fakeGitHub({ "repos/test/repo/rulesets/42": checks("ci-tests", "pr-title") });
  const result = await run({ gh: github.gh, fetchImpl: board.fetchImpl, now, env: { REPO: "test/repo", HYPERTASK_MCP_TOKEN: "t" }, log: () => {} });
  assert.deepEqual(result, { judged: true, silent: [] });
  assert.deepEqual(board.calls, []);
  assert.equal(github.calls.filter((endpoint) => endpoint.includes("/check-runs?")).length, 1);
});

test("a repository with no pull request in the last day is reported as nothing to judge", async () => {
  const { run } = await load();
  const board = fakeBoard();
  const github = fakeGitHub({ "repos/test/repo/pulls?state=all&sort=updated&direction=desc&per_page=20": [{ number: 7, updated_at: "2026-11-10T14:50:00Z", head: { sha: "a".repeat(40) } }] });
  const result = await run({ gh: github.gh, fetchImpl: board.fetchImpl, now, env: { REPO: "test/repo", HYPERTASK_MCP_TOKEN: "t" }, log: () => {} });
  assert.deepEqual(result, { judged: false, silent: [] });
  assert.deepEqual(board.calls, []);
  assert.deepEqual(github.calls.filter((endpoint) => endpoint.includes("/commits/")), []);
});

test("a missing credential or a ruleset without the monitoring name refuses to report", async () => {
  const { run } = await load();
  const board = fakeBoard();
  await assert.rejects(run({ gh: fakeGitHub().gh, fetchImpl: board.fetchImpl, now, env: { REPO: "test/repo" }, log: () => {} }), /HYPERTASK_MCP_TOKEN/);
  const github = fakeGitHub({ "repos/test/repo/rulesets?per_page=100": [] });
  await assert.rejects(run({ gh: github.gh, fetchImpl: board.fetchImpl, now, env: { REPO: "test/repo", HYPERTASK_MCP_TOKEN: "t" }, log: () => {} }), /one active production-required-checks ruleset/);
  assert.deepEqual(board.calls, []);
});
