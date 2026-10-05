const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { chmod, mkdir, mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const yaml = require("js-yaml");

const SCRIPT = ".github/scripts/mcp-reachability.sh";
const URLS = [
  "https://mcp.hypertask.ai/mcp",
  "https://mcp.hypertask.ai/.well-known/oauth-protected-resource",
  "https://app.hypertask.ai/.well-known/oauth-authorization-server",
];
const HEALTHY = [
  { status: "401", headers: 'WWW-Authenticate: Bearer resource_metadata="https://mcp.hypertask.ai/.well-known/oauth-protected-resource"\r\n', body: "{}" },
  { status: "200", body: JSON.stringify({ resource: URLS[0] }) },
  { status: "200", body: '{"token_endpoint":"https://app.hypertask.ai/api/oauth/token"}' },
];

const CURL_STUB = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const log = process.env.CURL_LOG;
const previous = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\\n").filter(Boolean).map(JSON.parse) : [];
fs.appendFileSync(log, JSON.stringify(args) + "\\n");
const url = args.find((arg) => arg.startsWith("https://"));
if (url.startsWith("https://api.telegram.org/")) {
  // Curl errors can include the token-bearing URL; these must stay out of logs.
  console.error(url);
  process.exit(7);
}
const count = previous.filter((call) => call.includes(url)).length;
const sequence = JSON.parse(process.env.RESPONSES)[url];
const response = sequence[Math.min(count, sequence.length - 1)];
if (!response.exit) {
  fs.writeFileSync(args[args.indexOf("-D") + 1], response.headers || "");
  fs.writeFileSync(args[args.indexOf("-o") + 1], response.body || "");
}
process.stdout.write(response.status || "000");
process.exit(response.exit || 0);
`;

async function runProbe(overrides = {}, telegram = true) {
  const directory = await mkdtemp(join(tmpdir(), "mcp-reachability-"));
  try {
    const bin = join(directory, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "curl"), CURL_STUB);
    await writeFile(join(bin, "sleep"), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$SLEEP_LOG"\n');
    await chmod(join(bin, "curl"), 0o755);
    await chmod(join(bin, "sleep"), 0o755);
    const responses = Object.fromEntries(URLS.map((url, index) => [url, overrides[index] || [HEALTHY[index]]]));
    const output = spawnSync("bash", [SCRIPT], {
      encoding: "utf8",
      timeout: 10000,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CURL_LOG: join(directory, "requests"),
        SLEEP_LOG: join(directory, "sleeps"),
        RESPONSES: JSON.stringify(responses),
        TG_TOKEN: telegram ? "stub-secret-token" : "",
        TG_CHAT: telegram ? "stub-secret-chat" : "",
      },
    });
    assert.ifError(output.error);
    const calls = (await readFile(join(directory, "requests"), "utf8")).trim().split("\n").map(JSON.parse);
    const sleeps = await readFile(join(directory, "sleeps"), "utf8").catch((error) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    assert.doesNotMatch(output.stdout + output.stderr, /stub-secret-token|stub-secret-chat/);
    return { ...output, calls, sleeps: sleeps.trim() ? sleeps.trim().split("\n") : [] };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("MCP reachability job matches Pusher triggers, runner and Telegram secrets and runs the script", async () => {
  const workflow = yaml.load(await readFile(".github/workflows/prod-health.yml", "utf8"));
  const job = workflow.jobs["mcp-reachability"];
  const pusher = workflow.jobs["pusher-status"];
  assert.ok(job);
  assert.equal(job.if, pusher.if);
  assert.equal(job["runs-on"], pusher["runs-on"]);
  assert.equal(job["timeout-minutes"], pusher["timeout-minutes"]);
  assert.equal(job.steps[0].uses, workflow.jobs.health.steps[0].uses);
  const step = job.steps.find((item) => item.run);
  assert.equal(step.run, `bash ${SCRIPT}`);
  assert.deepEqual(step.env, pusher.steps[0].env);
  const script = await readFile(SCRIPT, "utf8");
  assert.match(script, /set -euo pipefail/);
  assert.match(script, /x-vercel-mitigated/);
  assert.match(script, /401 initialize/);
  assert.match(script, /www-authenticate:.*resource_metadata=/);
  for (const url of URLS) assert.ok(script.includes(url));
});

test("healthy probes use unauthenticated initialize and GET metadata with bounded requests", async () => {
  const output = await runProbe({}, false);
  assert.equal(output.status, 0, output.stdout + output.stderr);
  assert.match(output.stdout, /MCP reachability checks passed/);
  assert.equal(output.calls.length, 3);
  assert.deepEqual(output.sleeps, []);
  for (const [index, call] of output.calls.entries()) {
    assert.ok(call.includes(URLS[index]));
    assert.equal(call[call.indexOf("--max-time") + 1], "20");
    assert.ok(!call.some((arg) => /^authorization:/i.test(arg)));
  }
  const initialize = output.calls[0];
  assert.equal(initialize[initialize.indexOf("-X") + 1], "POST");
  assert.ok(initialize.includes("content-type: application/json"));
  assert.ok(initialize.includes("accept: application/json, text/event-stream"));
  const body = JSON.parse(initialize[initialize.indexOf("-d") + 1]);
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.method, "initialize");
  assert.ok(body.params.protocolVersion);
  assert.ok(body.params.capabilities);
  assert.ok(body.params.clientInfo.name);
  for (const call of output.calls.slice(1)) assert.ok(!call.includes("-X") && !call.includes("-d"));
});

test("persistent challenges and invalid expectations retry and send exactly one actionable alert", async () => {
  const cases = [
    ...URLS.map((_, index) => [index, { ...HEALTHY[index], headers: "X-Vercel-Mitigated: challenge\r\n", status: "403" }]),
    ...URLS.map((_, index) => [index, { ...HEALTHY[index], headers: (HEALTHY[index].headers || "") + "x-vercel-mitigated: other\r\n" }]),
    [0, { ...HEALTHY[0], status: "200" }],
    [0, { ...HEALTHY[0], headers: "WWW-Authenticate: Bearer\r\n" }],
    [0, { ...HEALTHY[0], headers: "Other: resource_metadata=wrong-header\r\n" }],
    [1, { status: "200", body: '{"resource":"https://wrong.example/mcp"}' }],
    [1, { ...HEALTHY[1], status: "500" }],
    [1, { status: "200", body: "not JSON" }],
    [2, { status: "200", body: "{}" }],
    [2, { status: "200", body: '{"token_endpoint":""}' }],
    [2, { ...HEALTHY[2], status: "500" }],
    [2, { status: "200", body: "not JSON" }],
    [0, { status: "000", exit: 28 }],
  ];
  for (const [index, response] of cases) {
    const output = await runProbe({ [index]: [response] });
    assert.equal(output.status, 1, output.stdout + output.stderr);
    assert.equal(output.calls.filter((call) => call.includes(URLS[index])).length, 3);
    assert.deepEqual(output.sleeps, ["2", "2"]);
    const alerts = output.calls.filter((call) => call.some((arg) => arg.startsWith("https://api.telegram.org/")));
    assert.equal(alerts.length, 1);
    const text = alerts[0].find((arg) => arg.startsWith("text="));
    assert.ok(text.includes(URLS[index]));
    assert.ok(text.includes(`status=${response.status}`));
    assert.match(text, /x-vercel-mitigated=/);
    assert.match(text, /Likely fix: the Vercel firewall system bypass for mcp\.hypertask\.ai on project hypertasks-prod/);
    if (response.headers?.includes("challenge")) assert.match(text, /x-vercel-mitigated=challenge/);
  }
});

test("transient failures recover without an alert and stale challenge headers do not leak", async () => {
  const output = await runProbe(Object.fromEntries(URLS.map((_, index) => [index, [
    { status: "403", headers: "x-vercel-mitigated: challenge\r\n" },
    { status: "000", exit: 28 },
    HEALTHY[index],
  ]])));
  assert.equal(output.status, 0, output.stdout + output.stderr);
  assert.equal(output.calls.length, 9);
  assert.equal(output.sleeps.length, 6);
  assert.match(output.stdout, /status=000, x-vercel-mitigated=none/);
});

test("multiple failed URLs share one alert and local failure needs no Telegram secrets", async () => {
  const overrides = Object.fromEntries(URLS.map((_, index) => [index, [{ status: "403", headers: "x-vercel-mitigated:\r\n" }]]));
  for (const telegram of [true, false]) {
    const output = await runProbe(overrides, telegram);
    assert.equal(output.status, 1, output.stdout + output.stderr);
    const alerts = output.calls.filter((call) => call.some((arg) => arg.startsWith("https://api.telegram.org/")));
    assert.equal(alerts.length, telegram ? 1 : 0);
    assert.match(output.stdout, /x-vercel-mitigated=\(empty\)/);
    if (telegram) {
      const text = alerts[0].find((arg) => arg.startsWith("text="));
      for (const url of URLS) assert.ok(text.includes(url));
    }
  }
});
