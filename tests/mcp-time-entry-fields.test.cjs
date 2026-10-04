const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
function load(relativePath, stubs) {
  const javascript = ts.transpileModule(
    fs.readFileSync(path.join(root, relativePath), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } },
  ).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", "require", javascript)(loaded, loaded.exports, (name) => {
    assert.ok(Object.hasOwn(stubs, name), `Unexpected dependency: ${name}`);
    return stubs[name];
  });
  return loaded.exports;
}

function harness({ authenticated = true, limited = false, accessible = true, enabled = true } = {}) {
  const writes = [];
  const scopes = [];
  let stored = {
    id: 17, userId: 6, taskId: 42, note: "old note", pausedAt: null,
    startedAt: new Date("2026-10-03T09:00:00.000Z"),
    endedAt: new Date("2026-10-03T09:30:27.000Z"),
    task: { projectId: 15 },
  };
  const prisma = {
    project: { findFirst: async () => accessible ? { id: 15 } : null },
    task: {
      findFirst: async () => ({ project: { status: "Normal", timeTrackingEnabled: enabled } }),
      findUnique: async () => ({ projectId: 15 }),
    },
    timeEntry: {
      create: async ({ data }) => {
        writes.push(data);
        stored = { id: 17, note: null, pausedAt: null, ...data };
        return stored;
      },
      findFirst: async () => accessible ? { ...stored, task: { projectId: 15 } } : null,
      updateMany: async ({ data }) => {
        writes.push(data);
        stored = { ...stored, ...data };
        return { count: 1 };
      },
      findUnique: async () => ({ ...stored, user: { displayName: "Tester" } }),
    },
    $transaction: async (operation) => operation(prisma),
  };
  const stubs = {
    "next/server": { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } },
    "@prisma/client": require("@prisma/client"),
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/realtime/server": { broadcastTimeChange: async () => {} },
    "@/utils/controllers/projects/getAllIncludes": {
      getProjectWhere: (userId, agentId) => { scopes.push([userId, agentId]); return { ownerId: userId }; },
    },
    "@/utils/controllers/projects/isProjectAdmin": { __esModule: true, default: async () => false },
    "@/lib/flags": {},
    "@/lib/mcp/auth": {
      checkMcpRateLimit: async () => limited ? { status: 429 } : null,
      validateMcpAuth: async () => authenticated ? { user: { id: 6 }, agentId: "agent-1" } : null,
    },
    "@/lib/mcp/tasks/resolveTask": { findTaskByStringIdentifier: async () => ({ id: 42, projectId: 15 }) },
  };
  stubs["@/lib/timeDuration"] = load("src/lib/timeDuration.ts", stubs);
  stubs["@/lib/timeManualEntry"] = load("src/lib/timeManualEntry.ts", stubs);
  stubs["@/lib/timeEntryWriter"] = load("src/lib/timeEntryWriter.ts", stubs);
  stubs["@/lib/timeTracking"] = load("src/lib/timeTracking.ts", stubs);
  stubs["../_lib"] = stubs["@/lib/mcp/operations/time/helpers"] = load("src/lib/mcp/operations/time/helpers.ts", stubs);
  return {
    writes, scopes,
    log: load("src/lib/mcp/operations/time/log/operation.ts", stubs).POST,
    update: load("src/app/api/mcp/time/update/route.ts", stubs).POST,
  };
}
const request = (body) => ({ json: async () => body });

test("create stores note and date with the same local-noon semantics as update", async () => {
  const h = harness();
  const response = await h.log(request({ task: "HTPR-6870", minutes: 30, note: " x ", date: "2026-09-30", timezone_offset_minutes: -120 }));
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body), ["success", "entry"]);
  assert.equal(response.body.entry.note, "x");
  assert.equal(response.body.entry.startedAt.toISOString(), "2026-09-30T10:00:00.000Z");
  assert.equal(response.body.entry.endedAt.toISOString(), "2026-09-30T10:30:00.000Z");
  assert.deepEqual(h.scopes.at(-1), [6, "agent-1"]);
});

test("create without date keeps the existing now-ending interval", async () => {
  const h = harness();
  const before = Date.now();
  const response = await h.log(request({ task: "42", minutes: 30, note: "note" }));
  assert.equal(response.status, 200);
  assert.equal(response.body.entry.note, "note");
  const { startedAt, endedAt } = response.body.entry;
  assert.ok(endedAt.getTime() >= before && endedAt.getTime() <= Date.now());
  assert.equal(endedAt - startedAt, 30 * 60 * 1000);
});

test("create defaults note to null and normalizes notes like update", async () => {
  for (const [note, expected] of [[undefined, null], [null, null], ["   ", null], ["x".repeat(501), "x".repeat(500)]]) {
    const h = harness();
    const response = await h.log(request({ task: "42", minutes: 1, note }));
    assert.equal(response.status, 200);
    assert.equal(response.body.entry.note, expected);
  }
});

test("update note only preserves timestamps and response shape", async () => {
  const h = harness();
  const response = await h.update(request({ entry_id: 17, note: " corrected " }));
  assert.equal(response.status, 200);
  assert.deepEqual(h.writes, [{ note: "corrected" }]);
  assert.equal(response.body.entry.startedAt.toISOString(), "2026-10-03T09:00:00.000Z");
  assert.equal(response.body.entry.endedAt.toISOString(), "2026-10-03T09:30:27.000Z");
  assert.equal(response.body.entry.userName, "Tester");
  assert.equal(response.body.entry.user, undefined);
  assert.deepEqual(h.scopes.at(-1), [6, "agent-1"]);
});

test("update date only preserves exact duration, including timer seconds", async () => {
  const h = harness();
  const response = await h.update(request({ entry_id: 17, date: "2026-09-30", timezone_offset_minutes: 330 }));
  assert.equal(response.status, 200);
  assert.equal(response.body.entry.startedAt.toISOString(), "2026-09-30T17:30:00.000Z");
  assert.equal(response.body.entry.endedAt.toISOString(), "2026-09-30T18:00:27.000Z");
  assert.equal(response.body.entry.note, "old note");
});

test("update note and date together without minutes", async () => {
  const h = harness();
  const response = await h.update(request({ entry_id: 17, date: "2026-09-30", note: null }));
  assert.equal(response.status, 200);
  assert.equal(response.body.entry.note, null);
  assert.equal(response.body.entry.startedAt.toISOString(), "2026-09-30T12:00:00.000Z");
  assert.equal(response.body.entry.endedAt - response.body.entry.startedAt, 1827000);
});

test("update supplied minutes retains old behavior and numeric-string compatibility", async () => {
  for (const minutes of [1, 1440, "30"]) {
    const h = harness();
    const response = await h.update(request({ entry_id: "17", minutes }));
    assert.equal(response.status, 200);
    assert.equal(response.body.entry.endedAt - response.body.entry.startedAt, Number(minutes) * 60000);
    assert.equal(response.body.entry.note, "old note");
  }
});

test("create and update combined fields use identical date and timezone semantics", async () => {
  for (const offset of [-840, 840, undefined, 900, "120"]) {
    const h = harness();
    const fields = { minutes: 30, date: "2026-09-30", note: "same", timezone_offset_minutes: offset };
    const created = await h.log(request({ task: "42", ...fields }));
    const updated = await h.update(request({ entry_id: 17, ...fields }));
    assert.equal(created.status, 200);
    assert.equal(updated.status, 200);
    assert.equal(created.body.entry.startedAt.getTime(), updated.body.entry.startedAt.getTime());
    assert.equal(created.body.entry.endedAt.getTime(), updated.body.entry.endedAt.getTime());
  }
});

test("invalid supplied minutes answer 400 without writing", async () => {
  for (const value of [null, 0, -1, 1441, 1.5, true, "junk", ""]) {
    const h = harness();
    for (const [handler, body] of [[h.log, { task: "42" }], [h.update, { entry_id: 17, note: "x" }]]) {
      const response = await handler(request({ ...body, minutes: value }));
      assert.equal(response.status, 400, JSON.stringify(value));
      assert.match(response.body.error, /minutes/i);
    }
    assert.deepEqual(h.writes, []);
  }
  const h = harness();
  assert.equal((await h.log(request({ task: "42" }))).status, 400);
});

test("invalid date or note answers 400 on both endpoints", async () => {
  for (const fields of [{ date: 42 }, { date: null }, { date: "" }, { date: "2026-02-30" }, { date: "2026-9-30" }, { note: 42 }, { note: {} }]) {
    const h = harness();
    for (const [handler, body] of [[h.log, { task: "42" }], [h.update, { entry_id: 17 }]]) {
      const response = await handler(request({ ...body, minutes: 30, ...fields }));
      assert.equal(response.status, 400, JSON.stringify(fields));
      assert.equal(response.body.success, false);
    }
    assert.deepEqual(h.writes, []);
  }
});

test("update with no changeable field, including timezone alone, answers a clear 400", async () => {
  for (const fields of [{}, { timezone_offset_minutes: 60 }, { unknown: true }]) {
    const h = harness();
    const response = await h.update(request({ entry_id: 17, ...fields }));
    assert.equal(response.status, 400);
    assert.match(response.body.error, /minutes.*date.*note/);
    assert.deepEqual(h.writes, []);
  }
});

test("authentication, rate limits, access checks and disabled-board responses are preserved", async () => {
  for (const [options, status] of [[{ authenticated: false }, 401], [{ limited: true }, 429], [{ accessible: false }, 404]]) {
    const h = harness(options);
    assert.equal((await h.log(request({ task: "42", minutes: 30, note: "x" }))).status, status);
    assert.equal((await h.update(request({ entry_id: 17, note: "x" }))).status, status);
    assert.deepEqual(h.writes, []);
  }
  const h = harness({ enabled: false });
  assert.equal((await h.log(request({ task: "42", minutes: 30, date: "2026-09-30" }))).status, 403);
  assert.deepEqual(h.writes, []);
});

test("MCP tool schema and service forward optional log fields end to end", async () => {
  const stubs = {
    zod: require("zod"),
    "../../utils/logger": { logger: { debug() {}, error() {} } },
    "../../utils/correlation": { generateCorrelationId: () => "test" },
  };
  const validation = load("src/lib/mcp-server/validations/time.validation.ts", stubs);
  const { TimeService } = load("src/lib/mcp-server/lib/services/time.service.ts", stubs);
  let payload;
  const service = new TimeService({ makeRequest: async (url, options) => {
    assert.equal(url, "/mcp/time/log");
    payload = JSON.parse(options.body);
    return { success: true };
  } });
  Object.assign(stubs, {
    "../lib/services/time.service": { TimeService },
    "../validations/time.validation": validation,
    "../config/tool-metadata": { TOOL_METADATA: { TIME: { name: "time", description: "time" } } },
    "../utils/executeWithService": { executeWithService: async (_context, _service, operation, input) => operation(service, input) },
  });
  const { timeTool } = load("src/lib/mcp-server/tools/time.tool.ts", stubs);
  const input = { action: "log", task: "42", minutes: 30, note: "x", date: "2026-09-30", timezone_offset_minutes: -120 };
  await timeTool.execute(input, {});
  const { action, ...fields } = input;
  assert.deepEqual(payload, fields);
  for (const minutes of [0, 1441, 1.5]) {
    assert.equal(validation.TimeBaseSchema.safeParse({ ...input, minutes }).success, false);
  }
});
