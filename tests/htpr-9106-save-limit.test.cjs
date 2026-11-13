const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const save = loadModule("src/lib/tasks/saveLimit.ts");
const { createMcpTimingPool } = loadModule("src/lib/mcp/dbTiming.ts");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

test("HTPR-9106 real agent saves, stalled HTTP bodies and pool connections share the short limit", { timeout: 20_000 }, async () => {
  const sockets = new Set();
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const data = JSON.parse(body || "{}");
      requests.push({ url: req.url, cookie: req.headers.cookie, data });
      const mode = data.newTask?.title ?? req.url.slice(1);
      if (mode === "hang") return;
      if (mode === "gateway") { res.writeHead(504); res.end("gateway"); return; }
      res.writeHead(200, { "content-type": "application/json" });
      if (mode === "body-hang") { res.flushHeaders(); return; }
      res.end(JSON.stringify({ id: 101, title: data.newTask?.title ?? "Saved" }));
    });
  });
  const db = net.createServer(() => {});
  for (const s of [server, db]) s.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await Promise.all([listen(server), listen(db)]);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const pool = createMcpTimingPool({ host: "127.0.0.1", port: db.address().port, connectionTimeoutMillis: save.TASK_SAVE_LIMIT_MS, max: 1 });
  const { updateTaskText } = loadModule("src/lib/mcp/tasks/fields/text.ts", {
    "@/lib/media/inlineAgentImages.server": { inlineAgentImagesForUser: async (html) => html },
    "@/utils/controllers/urls/extractUrlsFromContent": { persistUrlsForDescription: async () => {} },
    "@/utils/helperFunctions/sanitizeRichHtml": { sanitizeRichHtml: (html) => html },
  });
  const context = (title) => ({
    requestBody: { title }, hasTextOrParentUpdate: true, hasDescriptionUpdate: false,
    baseUrl, ctx: { user: { id: 7 }, agentId: "test-agent" }, authCookieHeader: "test-session=fixture",
  });
  try {
    assert.equal(save.isTaskSaveTimeout(new Error("Task not found")), false);
    assert.equal(save.isTaskSaveTimeout({ cause: { code: "55P03" } }), true);
    assert.equal(save.isTaskSaveTimeout(new Error("Connection terminated due to connection timeout")), true);
    await updateTaskText(context("Healthy save"), { id: 101 });
    assert.equal(requests[0].url, "/api/tasks/single");
    assert.equal(requests[0].cookie, "test-session=fixture");
    assert.equal(requests[0].data.newTask.title, "Healthy save");
    assert.equal(requests[0].data.agentId, "test-agent");
    await assert.rejects(updateTaskText(context("gateway"), { id: 101 }), { message: save.TASK_SAVE_TOO_LONG });
    const started = Date.now();
    const failures = await Promise.all([
      updateTaskText(context("hang"), { id: 101 }),
      save.fetchTaskSave(`${baseUrl}/body-hang`),
      pool.query("select 1"),
    ].map((pending) => pending.then(() => null, (error) => error)));
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 5_000 && elapsed < 10_000, `stuck saves waited ${elapsed}ms`);
    assert.equal(failures[0]?.message, save.TASK_SAVE_TOO_LONG);
    assert.equal(failures[1]?.message, save.TASK_SAVE_TOO_LONG);
    assert.equal(save.isTaskSaveTimeout(failures[2]), true);
    const healthy = await save.fetchTaskSave(`${baseUrl}/ok`);
    assert.deepEqual(healthy, { ok: true, status: 200, data: { id: 101, title: "Saved" } });
    const cancelled = new AbortController();
    const reason = new Error("Caller cancelled");
    cancelled.abort(reason);
    await assert.rejects(save.fetchTaskSave(`${baseUrl}/ok`, { signal: cancelled.signal }), (error) => error === reason);
    console.log(`save limit ok: stalled HTTP, response body and pg connection rejected in ${elapsed}ms`);
  } finally {
    for (const socket of sockets) socket.destroy();
    await pool.end();
    await Promise.all([server, db].map((s) => new Promise((resolve) => s.close(resolve))));
  }
});

test("HTPR-9106 a shared budget never starts another phase after expiry", async () => {
  const budget = save.taskSaveBudget(Date.now() + 30);
  await assert.rejects(budget.run(() => new Promise(() => {})), { message: save.TASK_SAVE_TOO_LONG });
  let started = false;
  await assert.rejects(budget.run(async () => { started = true; }), { message: save.TASK_SAVE_TOO_LONG });
  assert.equal(started, false);
});
