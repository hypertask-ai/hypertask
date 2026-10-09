const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
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
    previousStreak: JSON.stringify({ version: 1, streak: 1, episode: null }),
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

test("second confirmed red files an incident and authorizes rollback, never a second Telegram", async () => {
  const { handleSmokeResult } = await import(scriptUrl);
  const { fetchImpl, calls } = alarmFetch();
  const directory = await mkdtemp(path.join(tmpdir(), "alarm-"));
  try {
    const output = path.join(directory, "output");
    assert.equal((await handleSmokeResult(config({ githubOutput: output }), fetchImpl)).action, "alarm");
    assert.match(await readFile(output, "utf8"), /rollback=true/);
    const create = calls.find((call) => call.url.endsWith("/tasks/create"));
    assert.equal(JSON.parse(create.options.body).project_id, 15);
    assert.equal(calls.filter((call) => isTelegramUrl(call.url)).length, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("unrunnable reds never increment the streak, alert, or authorize rollback", async () => {
  const { handleSmokeResult } = await import(scriptUrl);
  const { fetchImpl, calls } = alarmFetch();
  assert.equal((await handleSmokeResult(config({ failingViews: "" }), fetchImpl)).action, "none");
  assert.equal(calls.length, 0);
});

test("the legacy expired-login streak is discarded before counting real failures", async () => {
  const { handleSmokeResult } = await import(scriptUrl);
  const { fetchImpl } = alarmFetch();
  const previousStreak = JSON.stringify({ streak: 125, episode: { failingViews: "", incident: false, telegram: true } });
  const decision = await handleSmokeResult(config({ previousStreak }), fetchImpl);
  assert.equal(decision.streak, 1);
  assert.equal(decision.action, "none");
});

test("existing episode incidents are reused and later reds remain silent", async () => {
  const { handleSmokeResult } = await import(scriptUrl);
  const { fetchImpl, calls } = alarmFetch({ existing: true });
  await handleSmokeResult(config(), fetchImpl);
  assert.equal(calls.some((call) => call.url.endsWith("/tasks/create")), false);
  const last = calls.filter((call) => call.url.endsWith("/actions/variables/PROD_SMOKE_STREAK")).at(-1);
  const previousStreak = JSON.parse(last.options.body).value;
  const next = alarmFetch();
  assert.equal((await handleSmokeResult(config({ previousStreak }), next.fetchImpl)).streak, 3);
  assert.equal(next.calls.some((call) => call.url.includes("/api/mcp/")), false);
});

test("incident failures remain pending and retry original evidence on recovery without Telegram", async () => {
  const { handleSmokeResult } = await import(scriptUrl);
  const failed = alarmFetch({ incidentStatus: 503 });
  await assert.rejects(handleSmokeResult(config(), failed.fetchImpl), /incident creation/);
  const last = failed.calls.filter((call) => call.url.endsWith("/actions/variables/PROD_SMOKE_STREAK")).at(-1);
  const next = alarmFetch();
  await handleSmokeResult(config({ previousStreak: JSON.parse(last.options.body).value, outcome: "green" }), next.fetchImpl);
  assert.equal(next.calls.filter((call) => isTelegramUrl(call.url)).length, 0);
  const create = next.calls.find((call) => call.url.endsWith("/tasks/create"));
  assert.match(JSON.parse(create.options.body).description, /actions\/runs\/42/);
  assert.equal(JSON.parse(JSON.parse(next.calls.at(-1).options.body).value).streak, 0);
});

test("failed streak reservation fails closed without rollback or Telegram", async () => {
  const { handleSmokeResult } = await import(scriptUrl);
  const directory = await mkdtemp(path.join(tmpdir(), "alarm-"));
  try {
    const output = path.join(directory, "output");
    await assert.rejects(handleSmokeResult(config({ githubOutput: output }), async () => response(503)), /streak update/);
    await assert.rejects(readFile(output), { code: "ENOENT" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("unversioned numeric streaks cannot trigger rollback on the first actual failure", async () => {
  const { handleSmokeResult } = await import(scriptUrl);
  for (const previousStreak of ["1", "125"]) {
    const { fetchImpl } = alarmFetch();
    const first = await handleSmokeResult(config({ previousStreak }), fetchImpl);
    assert.equal(first.streak, 1);
    assert.equal(first.action, "none");
  }
});
