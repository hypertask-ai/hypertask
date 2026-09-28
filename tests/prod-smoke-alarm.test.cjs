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

function isTelegramUrl(value) {
  return new URL(value).origin === "https://api.telegram.org";
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

function alarmFetch({ existing = false, stale = false, incidentStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("/api/mcp/tasks?")) {
      return response(200, {
        tasks: existing
          ? [{ id: 77, title: "[INCIDENT] Production smoke red on consecutive deploys", description: stale ? "Old run evidence" : `Run: ${config().runUrl}` }]
          : [],
      });
    }
    if (url.endsWith("/api/mcp/projects?limit=100")) {
      return response(200, {
        projects: [{ id: 15, sections: [{ id: 4311, title: "Valentin Review" }] }],
      });
    }
    if (url.endsWith("/api/mcp/tasks/create")) {
      return response(incidentStatus, incidentStatus === 200 ? { task: { id: 78 } } : { error: "unavailable" });
    }
    if (isTelegramUrl(url)) return response(200, { ok: true });
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
  assert.equal(calls.filter((call) => isTelegramUrl(call.url)).length, 1);
  const update = calls.find((call) => call.url.endsWith("/actions/variables/PROD_SMOKE_STREAK"));
  const pending = JSON.parse(JSON.parse(update.options.body).value);
  assert.equal(pending.streak, 2);
  assert.equal(pending.episode.incident, false);
  assert.equal(pending.episode.telegram, false);
  const writes = calls.filter((call) => call.url.endsWith("/actions/variables/PROD_SMOKE_STREAK"));
  assert.deepEqual(JSON.parse(JSON.parse(writes.at(-1).options.body).value).episode,
    { runUrl: config().runUrl, sha: config().sha, failingViews: config().failingViews, incident: true, telegram: true });
});

test("an existing open incident suppresses duplicate creation", async () => {
  const { handleSmokeResult } = await import(scriptUrl);
  const { fetchImpl, calls } = alarmFetch({ existing: true });
  await handleSmokeResult(config(), fetchImpl);

  assert.equal(calls.some((call) => call.url.endsWith("/api/mcp/projects?limit=100")), false);
  assert.equal(calls.some((call) => call.url.endsWith("/api/mcp/tasks/create")), false);
  assert.equal(calls.filter((call) => isTelegramUrl(call.url)).length, 1);
});

test("later red runs stay silent while still updating the count", async () => {
  const { handleSmokeResult } = await import(scriptUrl);
  const { fetchImpl, calls } = alarmFetch();
  const result = await handleSmokeResult(config({ previousStreak: "2" }), fetchImpl);

  assert.deepEqual(result, { previousStreak: 2, streak: 3, action: "none" });
  assert.equal(calls.some((call) => isTelegramUrl(call.url)), false);
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
  const telegram = calls.find((call) => isTelegramUrl(call.url));
  assert.match(telegram.options.body.get("text"), /returned to green after 3/);
  const updates = calls.filter((call) => call.url.endsWith("/actions/variables/PROD_SMOKE_STREAK"));
  assert.equal(JSON.parse(updates.at(-1).options.body).value, "0");
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

test("incident API failure cannot suppress the Telegram alarm or streak update", async () => {
  const { handleSmokeResult } = await import(scriptUrl);
  for (const failedCall of ["search", "projects", "create"]) {
    const { fetchImpl, calls } = alarmFetch({ incidentStatus: failedCall === "create" ? 503 : 200 });
    const failingFetch = async (url, options) => {
      if (failedCall === "search" && url.includes("/api/mcp/tasks?")) return response(503);
      if (failedCall === "projects" && url.endsWith("/api/mcp/projects?limit=100")) return response(503);
      return fetchImpl(url, options);
    };
    await assert.rejects(handleSmokeResult(config(), failingFetch), /Hypertask (incident search|project lookup|incident creation) failed with HTTP 503/);
    assert.equal(calls.filter((call) => isTelegramUrl(call.url)).length, 1);
    const updates = calls.filter((call) => call.url.endsWith("/actions/variables/PROD_SMOKE_STREAK"));
    const saved = JSON.parse(JSON.parse(updates.at(-1).options.body).value);
    assert.equal(saved.streak, 2);
    assert.equal(saved.episode.incident, false);
    assert.equal(saved.episode.telegram, true);
  }
});

test("missing MCP token cannot suppress Telegram; independent failures are reported together", async () => {
  const { handleSmokeResult } = await import(scriptUrl);
  const { fetchImpl, calls } = alarmFetch();
  await assert.rejects(handleSmokeResult(config({ mcpToken: "" }), fetchImpl), /HYPERTASK_MCP_TOKEN is not configured/);
  assert.equal(calls.filter((call) => isTelegramUrl(call.url)).length, 1);
  const failingFetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/actions/variables/PROD_SMOKE_STREAK")) return response(204);
    return response(503);
  };
  await assert.rejects(handleSmokeResult(config(), failingFetch), (error) => {
    assert.equal(error.errors.length, 2);
    assert.match(error.message, /Hypertask incident search.*Telegram alert/);
    return true;
  });
});

test("new alarm episode creates fresh incident instead of reusing old evidence", async () => {
  const { handleSmokeResult } = await import(scriptUrl);
  const { fetchImpl, calls } = alarmFetch({ existing: true, stale: true });
  await handleSmokeResult(config(), fetchImpl);
  assert.equal(calls.filter((call) => call.url.endsWith("/api/mcp/tasks/create")).length, 1);
});


test("later red retries a failed incident without sending a duplicate Telegram alarm", async () => {
  const { handleSmokeResult } = await import(scriptUrl);
  const initial = alarmFetch();
  const failedIncident = async (url, options) =>
    url.includes("/api/mcp/tasks?") ? response(503) : initial.fetchImpl(url, options);
  await assert.rejects(handleSmokeResult(config(), failedIncident), /Hypertask incident search/);
  const saved = initial.calls.filter((call) => call.url.endsWith("/actions/variables/PROD_SMOKE_STREAK"));
  const previousStreak = JSON.parse(saved.at(-1).options.body).value;
  const retry = alarmFetch();
  await handleSmokeResult(config({ previousStreak, runUrl: "https://github.com/newer-run", sha: "b".repeat(40) }), retry.fetchImpl);
  assert.equal(retry.calls.filter((call) => isTelegramUrl(call.url)).length, 0);
  const create = retry.calls.find((call) => call.url.endsWith("/api/mcp/tasks/create"));
  assert.match(JSON.parse(create.options.body).description, /actions\/runs\/42/);
  const state = JSON.parse(JSON.parse(retry.calls.filter((call) => call.url.endsWith("/actions/variables/PROD_SMOKE_STREAK")).at(-1).options.body).value);
  assert.equal(state.streak, 3);
  assert.equal(state.episode.incident, true);
  assert.equal(state.episode.telegram, true);
});

test("later red retries a failed Telegram alarm without duplicating the incident", async () => {
  const { handleSmokeResult } = await import(scriptUrl);
  const initial = alarmFetch();
  const failedTelegram = async (url, options) =>
    isTelegramUrl(url) ? response(503) : initial.fetchImpl(url, options);
  await assert.rejects(handleSmokeResult(config(), failedTelegram), /Telegram alert/);
  const saved = initial.calls.filter((call) => call.url.endsWith("/actions/variables/PROD_SMOKE_STREAK"));
  const retry = alarmFetch();
  await handleSmokeResult(config({ previousStreak: JSON.parse(saved.at(-1).options.body).value }), retry.fetchImpl);
  assert.equal(retry.calls.filter((call) => call.url.includes("/api/mcp/")).length, 0);
  assert.equal(retry.calls.filter((call) => isTelegramUrl(call.url)).length, 1);
  assert.equal(JSON.parse(JSON.parse(retry.calls.filter((call) => call.url.endsWith("/actions/variables/PROD_SMOKE_STREAK")).at(-1).options.body).value).episode.telegram, true);
});

test("failed reservation cannot suppress the threshold alarm or incident", async () => {
  const { handleSmokeResult } = await import(scriptUrl);
  const { fetchImpl, calls } = alarmFetch();
  const failedStateWrites = async (url, options) => {
    if (url.endsWith("/actions/variables/PROD_SMOKE_STREAK")) {
      calls.push({ url, options });
      return response(403);
    }
    return fetchImpl(url, options);
  };
  await assert.rejects(
    handleSmokeResult(config(), failedStateWrites),
    /GitHub smoke streak update failed with HTTP 403/,
  );
  assert.equal(calls.filter((call) => isTelegramUrl(call.url)).length, 1);
  assert.equal(calls.filter((call) => call.url.endsWith("/api/mcp/tasks/create")).length, 1);
});

test("recovery delivery failure remains pending and is retried once", async () => {
  const { handleSmokeResult } = await import(scriptUrl);
  const initial = alarmFetch();
  await assert.rejects(handleSmokeResult(config({ outcome: "green", previousStreak: "2" }), async (url, options) =>
    isTelegramUrl(url) ? response(503) : initial.fetchImpl(url, options)), /Telegram alert/);
  const state = JSON.parse(initial.calls.filter((call) => call.url.endsWith("/actions/variables/PROD_SMOKE_STREAK")).at(-1).options.body).value;
  const retry = alarmFetch();
  await handleSmokeResult(config({ outcome: "green", previousStreak: state }), retry.fetchImpl);
  assert.equal(retry.calls.filter((call) => isTelegramUrl(call.url)).length, 1);
  assert.equal(JSON.parse(retry.calls.filter((call) => call.url.endsWith("/actions/variables/PROD_SMOKE_STREAK")).at(-1).options.body).value, "0");
});
