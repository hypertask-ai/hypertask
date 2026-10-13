const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const test = require("node:test");

async function fixture(t, status, body) {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { base: `http://127.0.0.1:${server.address().port}`, requests: () => requests };
}

const helpers = import("../scripts/mcp-cli-api-contract.mjs");
const core = ["hypertask_tasks"];
const tool = { name: core[0], inputSchema: { type: "object" } };

test("real HTTP positive control accepts a nonempty core catalog", async t => {
  const { requestLocal, responseJson, assertRpcResult, assertTools } = await helpers;
  const server = await fixture(t, 200, { jsonrpc: "2.0", id: "1", result: { tools: [tool] } });
  const body = await responseJson(await requestLocal(server.base, "/mcp"), "tools/list");
  assertTools(assertRpcResult(body, "1", "tools/list"), core);
  assert.equal(server.requests(), 1);
});

test("an HTTP 200 empty tools/list fails", async t => {
  const { requestLocal, responseJson, assertRpcResult, assertTools } = await helpers;
  const server = await fixture(t, 200, { jsonrpc: "2.0", id: "1", result: { tools: [] } });
  const body = await responseJson(await requestLocal(server.base, "/mcp"), "tools/list");
  assert.throws(() => assertTools(assertRpcResult(body, "1", "tools/list"), core), /empty catalog/);
});

test("nonempty tools/list without the core schema fails", async () => {
  const { assertTools } = await helpers;
  assert.throws(() => assertTools({ tools: [{ name: "unrelated", inputSchema: { type: "object" } }] }, core), /missing core tool/);
  assert.throws(() => assertTools({ tools: [{ name: core[0] }] }, core), /missing core tool/);
});

test("an HTTP 200 isError result fails without echoing its sensitive content", async t => {
  const { requestLocal, responseJson, assertRpcResult } = await helpers;
  const server = await fixture(t, 200, { jsonrpc: "2.0", id: "1", result: { isError: true, content: [{ type: "text", text: "private-placeholder" }] } });
  const body = await responseJson(await requestLocal(server.base, "/mcp"), "tools/call");
  assert.throws(() => assertRpcResult(body, "1", "tools/call"), error => {
    assert.match(error.message, /JSON-RPC\/tool error/);
    assert.doesNotMatch(error.message, /private-placeholder/);
    return true;
  });
});

test("an HTTP 401 fails even with a successful-looking body", async t => {
  const { requestLocal, responseJson } = await helpers;
  const server = await fixture(t, 401, { success: true, tools: [tool] });
  await assert.rejects(responseJson(await requestLocal(server.base, "/mcp"), "tools/list"), /HTTP 401/);
});

test("production URLs are refused before a request, including redirects and origin overrides", async t => {
  const { loopbackUrl, requestLocal } = await helpers;
  const server = await fixture(t, 200, {});
  assert.equal(loopbackUrl("http://localhost:3100/oauth/consent", "http://127.0.0.1:3100").hostname, "127.0.0.1");
  for (const value of ["https://app.hypertask.ai", "http://app.hypertask.ai", "http://127.0.0.1.example.invalid", `http://${["user", "x"].join(":")}@127.0.0.1`, "https://127.0.0.1"]) {
    assert.throws(() => loopbackUrl(value), /Refused non-loopback/);
    await assert.rejects(requestLocal(server.base, value), /Refused non-loopback/);
  }
  await assert.rejects(requestLocal(server.base, "http://127.0.0.1:1"), /different loopback origin/);
  assert.equal(server.requests(), 0);
});

test("JSON-RPC errors, mismatched ids and failed nested tool payloads fail", async () => {
  const { assertRpcResult, toolData } = await helpers;
  assert.throws(() => assertRpcResult({ jsonrpc: "2.0", id: "1", error: { message: "private-placeholder" } }, "1", "get"), /JSON-RPC\/tool error/);
  assert.throws(() => assertRpcResult({ jsonrpc: "2.0", id: "2", result: {} }, "1", "get"), /invalid JSON-RPC/);
  for (const data of [{ success: false }, { error: "private-placeholder" }]) {
    assert.throws(() => toolData({ structuredContent: { data } }, "get"), /unsuccessful tool data/);
  }
  assert.deepEqual(toolData({ content: [{ type: "text", text: '{"success":true,"tasks":[]}' }] }, "get"), { success: true, tasks: [] });
  assert.deepEqual(toolData({ structuredContent: { data: { success: true } } }, "get"), { success: true });
});

test("CLI network trace allows only the configured local app, never a production fallback", async () => {
  const { assertCliTrace } = await helpers;
  const local = 'connect(3, {sa_family=AF_INET, sin_port=htons(3100), sin_addr=inet_addr("127.0.0.1")}, 16) = 0';
  assertCliTrace(local, "http://127.0.0.1:3100");
  assert.throws(() => assertCliTrace("", "http://127.0.0.1:3100"), /no traced HTTP/);
  for (const other of [local.replace("127.0.0.1", "203.0.113.1"), local.replace("3100", "443"), 'connect(4, {sa_family=AF_INET6, sin6_port=htons(443), inet_pton(AF_INET6, "::1", &sin6_addr)}, 28) = 0']) {
    assert.throws(() => assertCliTrace(`${local}\n${other}`, "http://127.0.0.1:3100"), /unexpected network destination/);
  }
});

test("opt-in seed creates accepted guest without a team and an invite-only control, with private cookies", async () => {
  const fs = require("node:fs/promises");
  const path = require("node:path");
  const source = await fs.readFile(path.join(__dirname, "../scripts/seed-browser-smoke.mjs"), "utf8");
  const start = source.indexOf("  let contract;");
  const end = source.indexOf("  await writeFile(fixtureFile", start);
  assert.ok(start > 0 && end > start);
  const run = new (Object.getPrototypeOf(async function () {}).constructor)(
    "contractEnabled", "prisma", "createBoard", "writeFile", "path", "stateFile", "randomUUID", "signSession", "runKey", "user", "team", "googleAccount", "state", "flags",
    `${source.slice(start, end)}\nreturn contract;`,
  );
  for (const enabled of [false, true]) {
    const users = [];
    const memberships = [];
    const teams = [];
    const invites = [];
    const files = [];
    const prisma = {
      user: { create: async ({ data }) => {
        const id = users.length + 10;
        users.push(data);
        return { ...data, id, UserSetting: { id } };
      }, update: async () => {} },
      userPicture: { create: async () => {} },
      user_Activity: { create: async ({ data }) => assert.equal(data.totalTeamsOwned, 0) },
      member_Team: { create: async ({ data }) => teams.push(data), count: async ({ where }) => teams.filter(row => where.userId.in.includes(row.userId)).length },
      member: { createMany: async ({ data }) => memberships.push(...data) },
      invite: { createMany: async ({ data }) => invites.push(...data) },
      label: { create: async ({ data }) => ({ id: "label", value: data.value }) },
    };
    let boardId = 100;
    const result = await run(enabled, prisma, async () => ({ id: boardId++, task: { id: boardId }, columns: [{ id: 1 }, { id: 2 }], title: "contract" }),
      async (file, text, options) => files.push({ file, data: JSON.parse(text), options }), path, "/private/smoke-state.json", () => "disposable-key", () => "disposable-cookie", "run", { id: 1 }, { id: "team" }, { id: "account" }, { cookies: [] }, { "htpr-6804-mcp-tools": true });
    if (!enabled) {
      assert.equal(result, undefined);
      assert.equal(users.length + memberships.length + teams.length + invites.length + files.length, 0);
      continue;
    }
    assert.equal(users.length, 3);
    assert.deepEqual(teams.map(row => row.userId), [result.callers.member.id]);
    for (const board of result.boards) {
      assert.deepEqual(memberships.filter(row => row.projectId === board.id).map(row => [row.userId, row.status]),
        [[result.callers.member.id, "Accepted"], [result.callers.guest.id, "Accepted"]]);
      assert.ok(!memberships.some(row => row.userId === result.callers.unaccepted.id));
      assert.equal(invites.filter(row => row.projectId === board.id).length, 2);
    }
    assert.equal(files.length, 1);
    assert.equal(files[0].options.mode, 0o600);
    assert.equal(files[0].options.flag, "wx");
    assert.ok(result.callers.guest.cookies.some(cookie => cookie.name === "ht_session"));
  }
});

test("unexpected fixture parsing failures never print credential-shaped contents", async t => {
  const { mkdtemp, writeFile, rm } = require("node:fs/promises");
  const { tmpdir } = require("node:os");
  const path = require("node:path");
  const { spawnSync } = require("node:child_process");
  const directory = await mkdtemp(path.join(tmpdir(), "contract-private-error-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixtureFile = path.join(directory, "fixture.json");
  await writeFile(fixtureFile, '{"token":"private-placeholder", malformed}', { mode: 0o600 });
  const child = spawnSync(process.execPath, [path.join(__dirname, "../scripts/mcp-cli-api-contract.mjs")], {
    encoding: "utf8", cwd: directory,
    env: { PATH: process.env.PATH, BASE_URL: "http://127.0.0.1:3100", MCP_CONTRACT_FIXTURE: fixtureFile },
  });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /unexpected runner failure \(details withheld\)/);
  assert.doesNotMatch(child.stdout + child.stderr, /private-placeholder/);
});
