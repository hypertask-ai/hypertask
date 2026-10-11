const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const ts = require("typescript");
const { z } = require("zod");

const root = path.resolve(__dirname, "..");
const flag = "htpr-7048-ctrlj-chat-lease";
const agentId = "00000000-0000-4000-8000-000000000001";
const taskSession = "00000000-0000-4000-8000-000000000002";
const agentSession = "00000000-0000-4000-8000-000000000003";
const streamId = "00000000-0000-4000-8000-000000000004";
const assistantId = "00000000-0000-4000-8000-000000000005";

function load(relativePath, stubs, globals = {}) {
  const filename = path.join(root, relativePath);
  const source = process.env.HTPR_7048_BASE && relativePath.startsWith("src/app/api/ai/chat/")
    ? execFileSync("git", ["show", `${process.env.HTPR_7048_BASE}:${relativePath}`], { cwd: root, encoding: "utf8" })
    : fs.readFileSync(filename, "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: false },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(code, {
    module: loadedModule, exports: loadedModule.exports,
    require(id) {
      if (Object.hasOwn(stubs, id)) return stubs[id];
      if (id.startsWith("node:")) return require(id);
      throw new Error(`Unstubbed import: ${id}`);
    },
    Response, ReadableStream, TextEncoder, TextDecoder, AbortController,
    setTimeout, clearTimeout, setInterval, clearInterval, console, ...globals,
  }, { filename });
  return loadedModule.exports;
}

function memoryRedis() {
  const values = new Map();
  return {
    values,
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      if (values.has(key)) return null;
      values.set(key, value);
      return "OK";
    },
    eval: async (script, keyCount, ...args) => {
      const keys = args.slice(0, keyCount);
      const argv = args.slice(keyCount);
      if (script.includes('redis.call("INCR"')) {
        const count = Number(values.get(keys[0]) ?? 0) + 1;
        values.set(keys[0], String(count));
        return count;
      }
      if (script.includes('redis.call("exists"')) {
        const activeKeyCount = Number(argv[2] ?? 1);
        const setCount = Number(argv[3] ?? keys.length);
        if (keys.slice(0, activeKeyCount).some((key) => values.has(key))) return 0;
        if (keys.slice(setCount).some((key) => values.has(key))) return 0;
        for (const key of keys.slice(0, setCount)) values.set(key, argv[0]);
        return 1;
      }
      if (script.includes("local active =")) {
        const registered = values.get(keys[4]);
        const scopedActive = keyCount === 6 ? values.get(keys[5]) : undefined;
        if (!registered || (registered !== values.get(keys[3]) && registered !== scopedActive)) return 4;
        if (values.get(keys[1]) === "complete") return 0;
        if (values.has(keys[1])) return 3;
        values.set(keys[0], "1");
        return Number(values.get(keys[2]) ?? 0) > 0 ? 2 : 1;
      }
      if (script.includes('redis.call("del"')) {
        if (values.get(keys[0]) !== argv[0]) return 0;
        return Number(values.delete(keys[0]));
      }
      throw new Error("Unexpected Redis script");
    },
  };
}

function harness({ enabled = true } = {}) {
  const redis = memoryRedis();
  const leases = load("src/app/api/ai/chat/stream/streamLease.ts", {
    "@/lib/redis": { getRedis: async () => redis },
  });
  const started = [];
  const checks = [];
  const user = { id: 7 };
  const isFeatureEnabled = async (key, userId) => {
    checks.push([key, userId]);
    return key === flag && enabled;
  };
  const next = { NextResponse: { json: (body, options) => Response.json(body, options) } };
  const route = load("src/app/api/ai/chat/stream/route.ts", {
    "@/lib/ai/chatStream/turnModel": { loadTurnModel: async (body) => ({ actingAgent: body.session_id === agentSession ? { id: agentId } : null }) },
    "@/lib/ai/chatStream/stream": { createChatStream: (options) => { started.push(options); return new Response("reply started"); } },
    "next/server": next,
    "@/app/api/ai/_lib/requestUser": { getAiRequestUser: async (request) => request.headers.has("x-hypertask-heartbeat-execution-id") ? null : user },
    "@/app/api/ai/_lib/cronServiceAuth": { getCronServiceRequestUser: async () => user },
    "@/lib/nativeAgent/heartbeatTurnEnvelope": { decodeHeartbeatTurnMessage: () => ({ prompt: "heartbeat", metadata: { executionId: streamId, agentId, claimedAt: "2026-10-09T00:00:00.000Z", scanWatermark: "2026-10-09T00:00:00.000Z" } }) },
    "@/lib/prisma": { default: { user: { findUnique: async () => user }, chatSession: { updateMany: async () => ({ count: 1 }) } } },
    "@/lib/flags": { isFeatureEnabled },
    "@/lib/flags/keys": { HTPR_7048_CTRLJ_CHAT_LEASE_FLAG: flag, HTPR_6278_CHAT_TURN_FAILURE_FLAG: "deadline" },
    "@/app/api/ai/chat/stream/ensureNativeChatTurn": { ensureNativeChatTurn: async () => "persisted", findNativeAssistantReplay: async () => ({ status: "missing" }) },
    "@/app/api/ai/_lib/currentTaskContext": { resolveAiUsageTaskId: async () => null },
    "@/app/api/ai/chat/stream/streamLease": leases,
    "@/app/api/ai/_lib/heartbeatExecution": { startHeartbeatExecution: async () => {} },
    "@/lib/ai/chatStream/errors": { createSseErrorResponse: (message, status) => new Response(message, { status }), sseFrame: () => "", reportHandledChatError: async () => {}, errorMessage: String },
    "@/lib/ai/chatStream/request": { chatRequestSchema: { parse: (body) => body } },
    "@/lib/ai/tools/constants": { SSE_HEADERS: {} },
  });
  const cancel = load("src/app/api/ai/chat/cancel/route.ts", {
    "@/lib/errors/reportError": { reportError: async () => {} },
    "next/server": next,
    zod: { z },
    "@/app/api/ai/_lib/requestUser": { getAiRequestUser: async () => user },
    "@/lib/ai/tools/helpers": { loadActingAgent: async (sessionId, userId) => {
      assert.equal(userId, user.id);
      return sessionId === agentSession ? { id: agentId } : null;
    } },
    "../stream/streamLease": leases,
  });
  const send = (sessionId, heartbeat = false, extra = {}) => route.POST({
    headers: new Headers(heartbeat ? { "x-hypertask-heartbeat-execution-id": streamId, "x-hypertask-heartbeat-agent-id": agentId, "x-hypertask-heartbeat-claimed-at": "2026-10-09T00:00:00.000Z" } : {}),
    json: async () => ({ message: "Refine the saved task", session_id: sessionId, stream_id: streamId, user_message_id: assistantId, assistant_message_id: assistantId, ...(heartbeat ? { heartbeat_execution_id: streamId } : {}), ...extra }),
  });
  const stop = (sessionId) => cancel.POST({ json: async () => ({ session_id: sessionId, stream_id: streamId, assistant_message_id: assistantId }) });
  return { redis, leases, started, checks, send, stop, setEnabled: (value) => { enabled = value; } };
}

async function composeTask() {
  const calls = [];
  const { createComposedTask } = load("src/lib/ai/composeTask.ts", {
    "@/lib/media/browserRenderableImage": { isBrowserRenderableImage: () => false },
    axios: { default: { get: async () => ({ data: { sectionId: 1 } }) } },
    "@/lib/constants/APIRouteConstants": { taskWriterRoute: "/api/ai/task-writer" },
    "./taskWriterBoardContext": { buildTaskWriterRequestScope: () => ({ projectId: 15 }) },
    "@/lib/deriveCurrentBoardBilling": { deriveCurrentBoardBilling: () => ({}) },
    "@/utils/aiWriterUtils": { extractTitleAndDescription: () => ({ title: "Saved task", description: "<p>Body</p>" }) },
    "@/utils/htmlEscape": { escapeHtml: (text) => text },
    "./taskWriterMedia": { extractTaskWriterMedia: (html) => ({ html, media: [] }), createTaskWriterMediaTokenFactory: () => {}, restoreTaskWriterMedia: (html) => html },
    "@/lib/createTaskAttachmentUploads": { bindCreateTaskUploads: () => {} },
    "@/utils/api/global/apiHelpers/createTaskGloballycontroller": { default: async () => { calls.push("save"); return { resposne: { newTask: { id: 42 } } }; } },
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": { getActiveFiltersFromProject: () => undefined },
    "@/utils/helperFunctions/describeTaskWriterFailure": {},
    "@/utils/helperFunctions/Views/NewTaskViewDefaults": {},
  }, {
    fetch: async (url, options) => {
      assert.equal(url, "/api/ai/task-writer");
      assert.equal(JSON.parse(options.body).requestKind, "compose-task");
      calls.push("writer");
      return new Response("<h1>Saved task</h1><p>Body</p>");
    },
  });
  const task = await createComposedTask({ text: "A new task", files: [], project: { id: 15 }, userId: 7 });
  assert.equal(task.task.id, 42);
  assert.equal(task.writerFailed, false);
  assert.deepEqual(calls, ["writer", "save"]);
  return task;
}

test("a saved-task chat can send immediately while its owner's background heartbeat is running", async () => {
  const h = harness();
  assert.equal((await h.send(agentSession, true)).status, 200);
  await composeTask();
  assert.equal(h.started.length, 1);
  assert.equal((await h.send(taskSession)).status, 200);
  assert.equal(h.started.length, 2);
  assert.notEqual(h.started[0].streamLease.key, h.started[1].streamLease.key);
  assert.ok(h.checks.some(([key, userId]) => key === flag && userId === 7));
});

test("the human guard still rejects genuinely concurrent replies across task chats", async () => {
  const h = harness();
  assert.equal((await h.send(taskSession)).status, 200);
  const second = await h.send("another-task-session");
  assert.equal(second.status, 409);
  assert.match(await second.text(), /Another AI reply is already in progress/);
  assert.equal(h.started.length, 1);
});

test("heartbeat and interactive replies for the same native agent still conflict", async () => {
  const h = harness();
  assert.equal((await h.send(agentSession, true)).status, 200);
  assert.equal((await h.send(agentSession)).status, 409);
});

test("an isolated agent reply waits for a legacy user-only agent reply from before the deploy", async () => {
  const h = harness();
  h.redis.values.set("ai-chat:stream-active:user:7", "legacy-agent-reply");
  assert.equal((await h.send(agentSession, true)).status, 409);
  assert.equal(h.redis.values.has(`ai-chat:stream-active:user:7:agent:${agentId}`), false);
  h.redis.values.delete("ai-chat:stream-active:user:7");
  assert.equal((await h.send(agentSession, true)).status, 200);
  assert.equal(h.redis.values.has("ai-chat:stream-active:user:7"), false);
});

test("flag OFF preserves the original per-user lease behavior", async () => {
  const h = harness({ enabled: false });
  assert.equal((await h.send(agentSession, true)).status, 200);
  assert.equal((await h.send(taskSession)).status, 409);
  assert.equal(h.started[0].streamLease.key, `ai-chat:stream-active:user:7:agent:${agentId}`);
  assert.equal(h.redis.values.get("ai-chat:stream-active:user:7"), h.started[0].streamLease.token);
});

for (const [before, after] of [[false, true], [true, false]]) {
  test(`same-agent overlap is refused when the flag toggles ${before ? "On" : "Off"}->${after ? "On" : "Off"}`, async () => {
    const h = harness({ enabled: before });
    assert.equal((await h.send(agentSession, true)).status, 200);
    const firstLease = h.started[0].streamLease;
    h.setEnabled(after);
    const secondStreamId = "00000000-0000-4000-8000-000000000006";
    assert.equal((await h.send(agentSession, false, { stream_id: secondStreamId })).status, 409);
    assert.equal(h.started.length, 1);
    assert.equal(h.redis.values.get(firstLease.key), firstLease.token);
    assert.equal(h.redis.values.has(`ai-chat:stream-identity:user:7:session:${agentSession}:stream:${secondStreamId}`), false);
    await h.leases.releaseAiChatStreamLease(firstLease);
    assert.equal((await h.send(agentSession, false, { stream_id: secondStreamId })).status, 200);
  });
}

test("flag Off agent release frees both active keys and its cancellable identity", async () => {
  const h = harness({ enabled: false });
  await h.send(agentSession, true);
  const lease = h.started[0].streamLease;
  const keys = [
    `ai-chat:stream-active:user:7:agent:${agentId}`,
    "ai-chat:stream-active:user:7",
    `ai-chat:stream-identity:user:7:session:${agentSession}:stream:${streamId}`,
  ];
  for (const key of keys) assert.equal(h.redis.values.get(key), lease.token);
  await h.leases.releaseAiChatStreamLease(lease);
  for (const key of keys) assert.equal(h.redis.values.has(key), false);
  assert.equal((await h.send(taskSession)).status, 200);
  h.setEnabled(true);
  // An isolated agent reply waits while the owner's reply holds the user key.
  assert.equal((await h.send(agentSession)).status, 409);
  await h.leases.releaseAiChatStreamLease(lease);
  assert.equal((await h.send(taskSession)).status, 409);
});

test("busy user key leaves no agent key or cancellable identity behind with flag Off", async () => {
  const h = harness({ enabled: false });
  assert.equal((await h.send(taskSession)).status, 200);
  const humanLease = h.started[0].streamLease;
  assert.equal((await h.send(agentSession, true)).status, 409);
  assert.equal(h.redis.values.has(`ai-chat:stream-active:user:7:agent:${agentId}`), false);
  assert.equal(h.redis.values.has(`ai-chat:stream-identity:user:7:session:${agentSession}:stream:${streamId}`), false);
  assert.equal(h.redis.values.get(humanLease.key), humanLease.token);
  h.setEnabled(true);
  assert.equal((await h.send(agentSession, true)).status, 409);
  await h.leases.releaseAiChatStreamLease(humanLease);
  assert.equal((await h.send(agentSession, true)).status, 200);
});

test("agent leases without a cancellation identity still acquire and release both keys with flag Off", async () => {
  const h = harness({ enabled: false });
  const lease = await h.leases.acquireAiChatStreamLease(7, undefined, async () => h.redis, agentId, false);
  assert.notEqual(typeof lease, "string");
  assert.equal(h.redis.values.get(`ai-chat:stream-active:user:7:agent:${agentId}`), lease.token);
  assert.equal(h.redis.values.get("ai-chat:stream-active:user:7"), lease.token);
  await h.leases.releaseAiChatStreamLease(lease);
  assert.equal(h.redis.values.has(`ai-chat:stream-active:user:7:agent:${agentId}`), false);
  assert.equal(h.redis.values.has("ai-chat:stream-active:user:7"), false);
});

test("request-supplied agent identity cannot bypass the human concurrency guard", async () => {
  const h = harness();
  await h.send(taskSession);
  assert.equal((await h.send(taskSession, false, { agentId })).status, 409);
});

test("Stop recognizes both scoped and legacy agent leases, including after a flag toggle", async () => {
  for (const enabled of [true, false]) {
    const h = harness({ enabled });
    await h.send(agentSession, true);
    await h.send(taskSession);
    h.setEnabled(!enabled);
    const response = await h.stop(agentSession);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "cancelling");
    assert.equal(await h.leases.isAiChatCancellationRequested(h.redis, 7, agentSession, streamId), true);
    assert.equal(await h.leases.isAiChatCancellationRequested(h.redis, 7, taskSession, streamId), false);
  }
});

test("Stop still recognizes a legacy user-only agent lease", async () => {
  const h = harness();
  h.redis.values.set("ai-chat:stream-active:user:7", "legacy-agent-token");
  h.redis.values.set(`ai-chat:stream-identity:user:7:session:${agentSession}:stream:${streamId}`, "legacy-agent-token");
  assert.equal((await h.stop(agentSession)).status, 200);
  assert.equal(await h.leases.isAiChatCancellationRequested(h.redis, 7, agentSession, streamId), true);
});

test("release frees only its own lease and cannot delete a newer reply", async () => {
  const h = harness();
  await h.send(agentSession, true);
  await h.send(taskSession);
  const oldHumanLease = h.started[1].streamLease;
  await h.leases.releaseAiChatStreamLease(oldHumanLease);
  assert.equal((await h.send(taskSession)).status, 200);
  await h.leases.releaseAiChatStreamLease(oldHumanLease);
  assert.equal((await h.send(taskSession)).status, 409);
  assert.equal((await h.send(agentSession)).status, 409);
});

test("rate limits remain shared per user across human and agent scopes", async () => {
  const h = harness();
  h.redis.values.set("ai-chat:stream-rate:user:7", "12");
  assert.equal((await h.send(agentSession, true)).status, 429);
  assert.equal((await h.send(taskSession)).status, 429);
});
