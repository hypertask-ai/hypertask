const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false });
const save = load(path.join(root, "src/lib/tasks/saveLimit.ts"));
const { createMcpTimingPool } = load(path.join(root, "src/lib/mcp/dbTiming.ts"));

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

test("HTPR-9106 stuck save fails under ten seconds with the plain reason", { timeout: 20_000 }, async () => {
  assert.ok(save.TASK_SAVE_LIMIT_MS < 10_000);
  assert.ok(save.TASK_SAVE_LIMIT_MS >= 5_000);
  assert.equal(save.isTaskSaveTimeout(new Error("Task not found")), false);
  assert.equal(save.isTaskSaveTimeout(Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" })), true);
  const prismaSource = fs.readFileSync(path.join(root, "src/lib/prisma.ts"), "utf8");
  const singleSource = fs.readFileSync(path.join(root, "src/utils/controllers/tasks/single.ts"), "utf8");
  assert.match(prismaSource, /connectionTimeoutMillis:\s*TASK_SAVE_LIMIT_MS/);
  assert.match(singleSource, /applyTaskSaveDbLimits\(tx\)/);

  const calls = [];
  await save.applyTaskSaveDbLimits({
    $executeRaw: (strings, ...values) => {
      calls.push({ text: strings.join("?"), values });
      return Promise.resolve(0);
    },
  });
  assert.equal(calls.length, 2);
  assert.match(calls[0].text, /lock_timeout/);
  assert.match(calls[1].text, /statement_timeout/);
  assert.equal(calls[0].values[0], String(save.TASK_SAVE_LIMIT_MS));
  assert.equal(calls[1].values[0], String(save.TASK_SAVE_LIMIT_MS));

  const okServer = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
  const gateway = http.createServer((_req, res) => {
    res.writeHead(504);
    res.end("gateway");
  });
  const hungHttp = http.createServer(() => {});
  const hungDb = net.createServer(() => {});
  await Promise.all([listen(okServer), listen(gateway), listen(hungHttp), listen(hungDb)]);
  const pool = createMcpTimingPool({
    host: "127.0.0.1",
    port: hungDb.address().port,
    connectionTimeoutMillis: save.TASK_SAVE_LIMIT_MS,
    max: 1,
  });
  try {
    const ok = await save.fetchTaskSave(`http://127.0.0.1:${okServer.address().port}/`);
    assert.equal(ok.status, 200);
    await assert.rejects(
      () => save.fetchTaskSave(`http://127.0.0.1:${gateway.address().port}/`),
      (error) => error.message === save.TASK_SAVE_TOO_LONG && !String(error.message).includes("504"),
    );
    const started = Date.now();
    const [fetchError, poolError] = await Promise.all([
      save.fetchTaskSave(`http://127.0.0.1:${hungHttp.address().port}/`).then(() => null, (error) => error),
      pool.query("select 1").then(() => null, (error) => error),
    ]);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 10_000, `stuck save waited ${elapsed}ms`);
    assert.ok(elapsed + 1_500 >= save.TASK_SAVE_LIMIT_MS, `stuck save failed too early at ${elapsed}ms`);
    assert.equal(fetchError && fetchError.message, save.TASK_SAVE_TOO_LONG);
    assert.equal(String(fetchError && fetchError.message).includes("504"), false);
    assert.equal(save.isTaskSaveTimeout(poolError), true, String(poolError && poolError.message));
  } finally {
    await Promise.race([pool.end(), new Promise((resolve) => setTimeout(resolve, 1_000))]);
    okServer.close();
    gateway.close();
    hungHttp.close();
    hungDb.close();
  }
  console.log("save limit ok");
});
