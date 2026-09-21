const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const scriptUrl = pathToFileURL(
  path.resolve(__dirname, "../.github/scripts/prod-smoke-alarm.mjs"),
).href;

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  };
}

function config(overrides = {}) {
  return {
    appUrl: "https://app.hypertask.ai",
    outcome: "red",
    previousStreak: "1",
    githubToken: "github-test",
    repository: "hypertask-ai/hypertask",
    mcpToken: "mcp-test",
    telegramToken: "telegram-test",
    telegramChat: "123",
    runUrl: "https://github.com/hypertask-ai/hypertask/actions/runs/42",
    sha: "a".repeat(40),
    failingViews: "Desktop › inbox loads",
    ...overrides,
  };
}

function alarmFetch({ existing = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("/api/mcp/tasks?")) {
      return response(200, {
        tasks: existing
          ? [{ id: 77, title: "[INCIDENT] Production smoke red on consecutive deploys" }]
          : [],
      });
    }
    if (url.endsWith("/api/mcp/projects?limit=100")) {
      return response(200, {
        projects: [{ id: 15, sections: [{ id: 4311, title: "Valentin Review" }] }],
      });
    }
    if (url.endsWith("/api/mcp/tasks/create")) {
      return response(200, { task: { id: 78 } });
    }
    if (url.includes("api.telegram.org")) return response(200, { ok: true });
    if (url.endsWith("/actions/variables/PROD_SMOKE_STREAK")) return response(204);
    throw new Error(`Unexpected fetch: ${url}`);
  };
  return { fetchImpl, calls };
}

test("streak decision alarms only when the second consecutive red arrives", async () => {
  const { decideSmokeAlarm } = await import(scriptUrl);
  assert.deepEqual(decideSmokeAlarm("0", "red"), {
    previousStreak: 0,
    streak: 1,
    action: "none",
  });
  assert.deepEqual(decideSmokeAlarm("1", "red"), {
    previousStreak: 1,
    streak: 2,
    action: "alarm",
  });
  assert.deepEqual(decideSmokeAlarm("2", "red"), {
    previousStreak: 2,
    streak: 3,
    action: "none",
  });
});

test("green resets the streak and recovers only an active alarm", async () => {
  const { decideSmokeAlarm } = await import(scriptUrl);
  assert.deepEqual(decideSmokeAlarm("1", "green"), {
    previousStreak: 1,
    streak: 0,
    action: "none",
  });
  assert.deepEqual(decideSmokeAlarm("4", "green"), {
    previousStreak: 4,
    streak: 0,
    action: "recovery",
  });
  assert.deepEqual(decideSmokeAlarm("invalid", "red"), {
    previousStreak: 0,
    streak: 1,
    action: "none",
  });
});

test("second red files one HTML incident, alerts Telegram, and persists two", async () => {
  const { handleSmokeResult } = await import(scriptUrl);
  const { fetchImpl, calls } = alarmFetch();
  const result = await handleSmokeResult(config(), fetchImpl);

  assert.equal(result.action, "alarm");
  const create = calls.find((call) => call.url.endsWith("/api/mcp/tasks/create"));
  assert.ok(create);
  const body = JSON.parse(create.options.body);
  assert.equal(body.project_id, 15);
  assert.equal(body.section_id, 4311);
  assert.equal(body.content_type, "html");
  assert.match(body.description, /^<p><strong>Production smoke failed/);
  assert.match(body.description, /Desktop › inbox loads/);
  assert.match(body.description, new RegExp("a{40}"));
  assert.equal(calls.filter((call) => call.url.includes("api.telegram.org")).length, 1);
  const update = calls.find((call) => call.url.endsWith("/actions/variables/PROD_SMOKE_STREAK"));
  assert.deepEqual(JSON.parse(update.options.body), { name: "PROD_SMOKE_STREAK", value: "2" });
});

test("an existing open incident suppresses duplicate creation", async () => {
  const { handleSmokeResult } = await import(scriptUrl);
  const { fetchImpl, calls } = alarmFetch({ existing: true });
  await handleSmokeResult(config(), fetchImpl);

  assert.equal(calls.some((call) => call.url.endsWith("/api/mcp/projects?limit=100")), false);
  assert.equal(calls.some((call) => call.url.endsWith("/api/mcp/tasks/create")), false);
  assert.equal(calls.filter((call) => call.url.includes("api.telegram.org")).length, 1);
});

test("later red runs stay silent while still updating the count", async () => {
  const { handleSmokeResult } = await import(scriptUrl);
  const { fetchImpl, calls } = alarmFetch();
  const result = await handleSmokeResult(config({ previousStreak: "2" }), fetchImpl);

  assert.deepEqual(result, { previousStreak: 2, streak: 3, action: "none" });
  assert.equal(calls.some((call) => call.url.includes("api.telegram.org")), false);
  assert.equal(calls.some((call) => call.url.includes("/api/mcp/")), false);
  const update = calls.find((call) => call.url.endsWith("/actions/variables/PROD_SMOKE_STREAK"));
  assert.equal(JSON.parse(update.options.body).value, "3");
});

test("first green after an alarm sends one recovery and resets the variable", async () => {
  const { handleSmokeResult } = await import(scriptUrl);
  const { fetchImpl, calls } = alarmFetch();
  const result = await handleSmokeResult(
    config({ outcome: "green", previousStreak: "3" }),
    fetchImpl,
  );

  assert.equal(result.action, "recovery");
  const telegram = calls.find((call) => call.url.includes("api.telegram.org"));
  assert.match(telegram.options.body.get("text"), /returned to green after 3/);
  const update = calls.find((call) => call.url.endsWith("/actions/variables/PROD_SMOKE_STREAK"));
  assert.equal(JSON.parse(update.options.body).value, "0");
});

test("creates the repository variable when it does not exist", async () => {
  const { handleSmokeResult } = await import(scriptUrl);
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/actions/variables/PROD_SMOKE_STREAK")) return response(404);
    if (url.endsWith("/actions/variables")) return response(201, { name: "PROD_SMOKE_STREAK" });
    throw new Error(`Unexpected fetch: ${url}`);
  };
  await handleSmokeResult(config({ outcome: "green", previousStreak: "0" }), fetchImpl);
  assert.deepEqual(calls.map((call) => call.options.method), ["PATCH", "POST"]);
});
