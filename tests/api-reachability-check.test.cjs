const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { chmod, mkdir, mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const yaml = require("js-yaml");

const SCRIPT = ".github/scripts/api-reachability.sh";
const URLS = [
  "https://mcp.hypertask.ai/mcp",
  "https://mcp.hypertask.ai/.well-known/oauth-protected-resource",
  "https://app.hypertask.ai/.well-known/oauth-authorization-server",
  "https://api.hypertask.ai/api/mcp/tasks",
  "https://app.hypertask.ai/api/mcp/tasks",
  "https://app.hypertask.ai/api/ai-chat/all-sessions",
  "https://app.hypertask.ai/api/ai/chat/stream",
];
const HEALTHY = [
  { status: "401", headers: 'WWW-Authenticate: Bearer resource_metadata="https://mcp.hypertask.ai/.well-known/oauth-protected-resource"\r\n', body: "{}" },
  { status: "200", body: JSON.stringify({ resource: URLS[0] }) },
  { status: "200", body: '{"token_endpoint":"https://app.hypertask.ai/api/oauth/token"}' },
  ...Array.from({ length: 4 }, () => ({ status: "401", body: '{"error":"Unauthorized"}' })),
];

const PROJECT_ID = "prj_oEok2iMNFPzj6AWe1KQBaIAcPaAf";
const TEAM_ID = "team_yureFlJZ6ibwebaOOkKc5whs";
const BYPASS_URL = `https://api.vercel.com/v1/security/firewall/bypass?projectId=${PROJECT_ID}&teamId=${TEAM_ID}`;
const BYPASS_RULES = ["0.0.0.0/0", "::/0"].map((Ip) => ({ Domain: "mcp.hypertask.ai", Action: "bypass", Ip }));
const firewallResponse = (result) => ({ status: "200", body: JSON.stringify({ result }) });

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
if (response.exit) console.error(args.join(" "));
process.stdout.write(response.status || "000");
process.exit(response.exit || 0);
`;

async function runProbe(overrides = {}, telegram = true, firewall = null) {
  const directory = await mkdtemp(join(tmpdir(), "api-reachability-"));
  try {
    const bin = join(directory, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "curl"), CURL_STUB);
    await writeFile(join(bin, "sleep"), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$SLEEP_LOG"\n');
    await writeFile(join(bin, "node"), `#!/bin/sh
if [ "$1" = ".github/scripts/production-alert.mjs" ]; then
  exec "$REAL_NODE" -e 'require("node:fs").appendFileSync(process.env.CURL_LOG, JSON.stringify(["report", process.argv[2], process.argv[3], "text=" + process.argv[4]]) + "\\n")' "$@"
fi
exec "$REAL_NODE" "$@"
`);
    await chmod(join(bin, "node"), 0o755);
    await chmod(join(bin, "curl"), 0o755);
    await chmod(join(bin, "sleep"), 0o755);
    const responses = Object.fromEntries(URLS.map((url, index) => [url, overrides[index] || [HEALTHY[index]]]));
    if (firewall) responses[BYPASS_URL] = firewall;
    const output = spawnSync("bash", [SCRIPT], {
      encoding: "utf8",
      timeout: 10000,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        REAL_NODE: process.execPath,
        CURL_LOG: join(directory, "requests"),
        SLEEP_LOG: join(directory, "sleeps"),
        RESPONSES: JSON.stringify(responses),
        VERCEL_TOKEN: firewall ? "stub-vercel-token" : "",
        PROJECT_ID: PROJECT_ID,
        TEAM_ID: TEAM_ID,
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
    assert.doesNotMatch(output.stdout + output.stderr, /stub-secret-token|stub-secret-chat|stub-vercel-token/);
    return { ...output, calls, sleeps: sleeps.trim() ? sleeps.trim().split("\n") : [] };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("API reachability job uses the five-minute schedule, bounded runner and existing Vercel and Telegram secrets", async () => {
  const workflow = yaml.load(await readFile(".github/workflows/prod-health.yml", "utf8"));
  const job = workflow.jobs["api-reachability"];
  const pusher = workflow.jobs["pusher-status"];
  assert.ok(job);
  const schedule = workflow.on.schedule.find((item) => item.cron.includes("/5"));
  assert.ok(schedule);
  assert.equal(job.if, "${{ github.event_name == 'push' || (github.event_name == 'schedule' && github.event.schedule == '" + schedule.cron + "') || github.event_name == 'workflow_dispatch' }}");
  assert.equal(job["runs-on"], pusher["runs-on"]);
  assert.equal(job["timeout-minutes"], 10);
  assert.deepEqual(job.permissions, { contents: "read" });
  assert.equal(workflow.env.PROJECT_ID, PROJECT_ID);
  assert.equal(workflow.env.TEAM_ID, TEAM_ID);
  assert.equal(job.steps[0].uses, workflow.jobs.health.steps[0].uses);
  const step = job.steps.find((item) => item.run);
  assert.equal(step.run, `bash ${SCRIPT}`);
  assert.deepEqual(step.env, {
    ALERT_GITHUB_TOKEN: '${{ secrets.AUTOMERGE_TOKEN }}',
    HYPERTASK_MCP_TOKEN: '${{ secrets.HYPERTASK_MCP_TOKEN }}',
    TG_TOKEN: '${{ secrets.TELEGRAM_BOT_TOKEN }}',
    TG_CHAT: '${{ secrets.TELEGRAM_CHAT_ID }}',
    VERCEL_TOKEN: '${{ secrets.VERCEL_TOKEN }}',
  });
  const script = await readFile(SCRIPT, "utf8");
  assert.match(script, /set -euo pipefail/);
  assert.match(script, /x-vercel-mitigated/);
  assert.match(script, /401 initialize/);
  assert.match(script, /www-authenticate:.*resource_metadata=/);
  for (const url of URLS) assert.ok(script.includes(url));
});

test("healthy probes use unauthenticated MCP, CLI/API and AI chat requests with pinned statuses and bounded requests", async () => {
  const output = await runProbe({}, false);
  assert.equal(output.status, 0, output.stdout + output.stderr);
  assert.match(output.stdout, /API reachability checks passed/);
  assert.equal(output.calls.length, URLS.length);
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
  for (const call of output.calls.slice(1, -1)) assert.ok(!call.includes("-X") && !call.includes("-d"));
  const stream = output.calls.at(-1);
  assert.equal(stream[stream.indexOf("-X") + 1], "POST");
  assert.ok(stream.includes("content-type: application/json"));
  assert.equal(stream[stream.indexOf("-d") + 1], "{}");
  assert.match(output.stdout, /No VERCEL_TOKEN; skipped firewall bypass setting guard/);
});

test("persistent challenges and invalid expectations retry and send exactly one actionable alert", async () => {
  const cases = [
    ...URLS.map((_, index) => [index, { ...HEALTHY[index], headers: "X-Vercel-Mitigated: challenge\r\n", status: "403" }]),
    ...URLS.map((_, index) => [index, { ...HEALTHY[index], headers: (HEALTHY[index].headers || "") + "x-vercel-mitigated: other\r\n" }]),
    ...URLS.map((_, index) => [index, { ...HEALTHY[index], status: "500" }]),
    ...URLS.map((_, index) => [index, { status: "000", exit: 28 }]),
    ...URLS.slice(3).flatMap((_, index) => ["200", "400", "403"].map((status) => [index + 3, { ...HEALTHY[index + 3], status }])),
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
    const alerts = output.calls.filter((call) => call[0] === "report");
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0][1], "live");
    const text = alerts[0].find((arg) => arg.startsWith("text="));
    assert.ok(text.includes(URLS[index]));
    assert.ok(text.includes(`status=${response.status}`));
    assert.match(text, /x-vercel-mitigated=/);
    assert.match(text, /Likely fix: the Vercel firewall system bypass for the affected host on project hypertasks-prod/);
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
  assert.equal(output.calls.length, URLS.length * 3);
  assert.equal(output.sleeps.length, URLS.length * 2);
  assert.match(output.stdout, /status=000, x-vercel-mitigated=none/);
});

test("multiple failed URLs share one alert and local failure needs no Telegram secrets", async () => {
  const overrides = Object.fromEntries(URLS.map((_, index) => [index, [{ status: "403", headers: "x-vercel-mitigated:\r\n" }]]));
  for (const telegram of [true, false]) {
    const output = await runProbe(overrides, telegram);
    assert.equal(output.status, 1, output.stdout + output.stderr);
    const alerts = output.calls.filter((call) => call[0] === "report");
    assert.equal(alerts.length, 1);
    assert.match(output.stdout, /x-vercel-mitigated=\(empty\)/);
    if (telegram) {
      const text = alerts[0].find((arg) => arg.startsWith("text="));
      for (const url of URLS) assert.ok(text.includes(`${url}: status=403, x-vercel-mitigated=(empty)`));
      assert.match(text, /Ensure all-sources bypass entries for mcp\.hypertask\.ai\./);
      assert.doesNotMatch(text, /BOTH|bypass entries for app\.hypertask\.ai/);
    }
  }
});

test("firewall guard accepts MCP IPv4 and IPv6 all-sources entries without requiring an app bypass and authenticates only the Vercel request", async () => {
  for (const rules of [
    BYPASS_RULES,
    [...BYPASS_RULES, { Domain: "app.hypertask.ai", Action: "bypass", Ip: "80.190.82.74" }],
  ]) {
    const output = await runProbe({}, false, [firewallResponse(rules)]);
    assert.equal(output.status, 0, output.stdout + output.stderr);
    assert.equal(output.calls.length, URLS.length + 1);
    assert.deepEqual(output.sleeps, []);
    for (const call of output.calls.slice(0, -1)) {
      assert.ok(!call.some((arg) => /^authorization:/i.test(arg) || arg.includes("stub-vercel-token")));
    }
    const call = output.calls.at(-1);
    assert.ok(call.includes(BYPASS_URL));
    assert.ok(call.includes("Authorization: Bearer stub-vercel-token"));
    assert.equal(call[call.indexOf("--max-time") + 1], "20");
    assert.ok(!call.includes("-X") && !call.includes("-d"));
  }
});

test("firewall guard rejects missing, IP-scoped, malformed, challenged and failed settings with one safe alert", async () => {
  const cases = [
    firewallResponse([]),
    ...BYPASS_RULES.map((_, index) => firewallResponse(BYPASS_RULES.filter((_, other) => index !== other))),
    firewallResponse([{ Domain: "mcp.hypertask.ai", Action: "bypass", Ip: "80.190.82.74" }]),
    firewallResponse([{ Domain: "app.hypertask.ai", Action: "bypass", Ip: "80.190.82.74" }]),
    ...BYPASS_RULES.map((_, index) => firewallResponse(BYPASS_RULES.map((rule, other) => index === other ? { ...rule, Ip: "192.0.2.1" } : rule))),
    ...BYPASS_RULES.map((_, index) => firewallResponse(BYPASS_RULES.map((rule, other) => index === other ? { ...rule, Action: "block" } : rule))),
    firewallResponse(BYPASS_RULES.map((rule) => ({ ...rule, Action: "block" }))),
    ...["app.hypertask.ai", "wrong.example"].map((Domain) => firewallResponse(BYPASS_RULES.map((rule) => ({ ...rule, Domain })))),
    ...BYPASS_RULES.map((_, index) => firewallResponse(BYPASS_RULES.map((rule, other) => index === other ? { ...rule, Domain: "app.hypertask.ai" } : rule))),
    firewallResponse(BYPASS_RULES.map(({ Domain, Action }) => ({ Domain, Action }))),
    { status: "200", body: "not JSON" },
    { status: "200", body: "{}" },
    { status: "200", body: '{"result":null}' },
    { status: "200", body: '{"result":{"error":"stub-vercel-token"}}' },
    { ...firewallResponse(BYPASS_RULES), headers: "X-Vercel-Mitigated: challenge\r\n" },
    { ...firewallResponse(BYPASS_RULES), headers: "x-vercel-mitigated:\r\n" },
    { ...firewallResponse(BYPASS_RULES), status: "401" },
    { ...firewallResponse(BYPASS_RULES), status: "500" },
    { status: "000", exit: 28 },
  ];
  for (const response of cases) {
    const output = await runProbe({}, true, [response]);
    assert.equal(output.status, 1, output.stdout + output.stderr);
    assert.equal(output.calls.filter((call) => call.includes(BYPASS_URL)).length, 3);
    assert.deepEqual(output.sleeps, ["2", "2"]);
    const alerts = output.calls.filter((call) => call[0] === "report");
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0][1], "setup", "settings alone are not a proven outage");
    const text = alerts[0].find((arg) => arg.startsWith("text="));
    assert.ok(text.includes(`${BYPASS_URL}: status=${response.status}, x-vercel-mitigated=`));
    assert.match(text, /Vercel firewall system bypass.*project hypertasks-prod/);
    assert.match(text, /Ensure all-sources bypass entries for mcp\.hypertask\.ai\./);
    assert.doesNotMatch(text, /BOTH|bypass entries for app\.hypertask\.ai/);
    assert.doesNotMatch(text, /stub-vercel-token/);
  }
});

test("firewall retries clear stale headers and combined probe and guard failures are all listed", async () => {
  const recovered = await runProbe({}, true, [
    { ...firewallResponse(BYPASS_RULES), headers: "x-vercel-mitigated: challenge\r\n" },
    { status: "000", exit: 28 },
    firewallResponse(BYPASS_RULES),
  ]);
  assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
  assert.equal(recovered.calls.length, URLS.length + 3);
  assert.deepEqual(recovered.sleeps, ["2", "2"]);
  assert.match(recovered.stdout, /status=000, x-vercel-mitigated=none/);

  const overrides = Object.fromEntries(URLS.map((_, index) => [index, [{ status: "503", headers: "x-vercel-mitigated: challenge\r\n" }]]));
  const output = await runProbe(overrides, true, [firewallResponse([])]);
  assert.equal(output.status, 1, output.stdout + output.stderr);
  const alerts = output.calls.filter((call) => call[0] === "report");
  assert.equal(alerts.length, 1);
  const text = alerts[0].find((arg) => arg.startsWith("text="));
  for (const url of URLS) assert.ok(text.includes(`${url}: status=503, x-vercel-mitigated=challenge`));
  assert.ok(text.includes(`${BYPASS_URL}: status=200, x-vercel-mitigated=none`));
});
