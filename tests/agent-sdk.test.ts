import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  createAgent,
  AgentSdkError,
  MemoryDeliveryStore,
  nodeHttpAdapter,
  verifyWebhookSignature,
  type AgentRunRecord,
  type AgentWebhookPayload,
  type BackgroundContext,
  type DeliveryClaim,
  type DeliveryStore,
  type WebhookHandler,
} from "../packages/agent-sdk/index.js";

const secret = "unit-test-signing-key";
const apiUrl = "https://api.example.test/api";
const now = Date.now();
const run: AgentRunRecord = {
  id: "run-1",
  agentId: "agent-1",
  taskId: 101,
  chatSessionId: null,
  trigger: "mention",
  status: "active",
  createdAt: new Date(now - 1_000).toISOString(),
  lastActivityAt: new Date(now - 1_000).toISOString(),
  stoppedBy: null,
};
const task = {
  id: 101,
  ticketNumber: "TEST-101",
  title: "SDK test",
  description: "Test the SDK",
  section: "Backlog",
  sectionId: 1,
  boardId: 15,
  boardTitle: "Test board",
  projectId: 15,
  status: "Normal" as const,
  assignees: [],
  labels: [],
  createdAt: new Date(now - 1_000).toISOString(),
};

function payload(
  overrides: Partial<AgentWebhookPayload> = {},
): AgentWebhookPayload {
  const event = overrides.event ?? "run.created";
  const record = {
    ...run,
    ...(overrides.run ?? {}),
  };
  return {
    event,
    deliveryId: "delivery-1",
    occurredAt: new Date(now).toISOString(),
    agentId: record.agentId,
    projectId: 15,
    taskId: record.taskId,
    ticketNumber: task.ticketNumber,
    taskTitle: task.title,
    runId: record.id,
    run: record,
    prompt: "Please investigate",
    ...overrides,
  };
}

function signature(timestamp: string, body: string): string {
  return `sha256=${createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex")}`;
}

function webhookRequest(
  bodyPayload: AgentWebhookPayload,
  headerOverrides: Record<string, string> = {},
): Request {
  const body = JSON.stringify(bodyPayload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  return new Request("https://agent.example.test/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hypertask-event": bodyPayload.event,
      "x-hypertask-delivery": bodyPayload.deliveryId,
      "x-hypertask-timestamp": timestamp,
      "x-hypertask-signature": signature(timestamp, body),
      ...headerOverrides,
    },
    body,
  });
}

type ApiCall = {
  method: string;
  path: string;
  headers: Headers;
  body: Record<string, unknown> | null;
};

function apiFixture(options: { failActivity?: boolean; failUpdate?: boolean } = {}) {
  const calls: ApiCall[] = [];
  let activityId = 0;
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    if (init.signal?.aborted) {
      throw init.signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ method, path: `${url.pathname}${url.search}`, headers, body });

    if (method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    }
    if (url.pathname.endsWith("/mcp/agents/runs/run-1/activities")) {
      if (method === "GET") return Response.json({ success: true, activities: [] });
      if (options.failActivity) {
        return Response.json(
          { success: false, error: "Activity failed" },
          { status: 500 },
        );
      }
      activityId += 1;
      return Response.json({
        success: true,
        activity: {
          id: `activity-${activityId}`,
          runId: run.id,
          type: body.type,
          text: body.text,
          link: body.link ?? null,
          options: body.options ?? null,
          selectedOption: null,
          selectedAt: null,
          selectedBy: null,
          createdAt: new Date().toISOString(),
        },
        duplicate: false,
      });
    }
    if (url.pathname.endsWith("/mcp/agents/runs/run-1")) {
      return Response.json({ success: true, run });
    }
    if (url.pathname.endsWith("/mcp/tasks") && method === "GET") {
      return Response.json({ success: true, tasks: [task] });
    }
    if (url.pathname.endsWith("/mcp/comments") && method === "GET") {
      return Response.json({
        success: true,
        comments: [
          {
            id: 1,
            text: "Earlier comment",
            commentText: "Earlier comment",
            createdAt: new Date(now - 500).toISOString(),
          },
        ],
      });
    }
    if (url.pathname.endsWith("/mcp/projects/15/sections")) {
      return Response.json({
        success: true,
        sections: [
          { id: 1, section_title: "Backlog" },
          { id: 2, section_title: "QA" },
        ],
      });
    }
    if (url.pathname.endsWith("/mcp/projects/15/members")) {
      return Response.json({
        success: true,
        members: [{ id: 6, displayName: "Test User", email: "test@example.test" }],
      });
    }
    if (url.pathname.endsWith("/mcp/tasks/update") && options.failUpdate) {
      return Response.json(
        { success: false, error: "Update failed" },
        { status: 500 },
      );
    }
    return Response.json({ success: true });
  };
  return { calls, fetch };
}

function background(distributed = false) {
  const tasks: Promise<void>[] = [];
  const context: BackgroundContext = {
    distributed,
    waitUntil(work) {
      tasks.push(work);
    },
  };
  return {
    context,
    async drain() {
      await Promise.all(tasks);
    },
  };
}

class DurableTestStore implements DeliveryStore {
  readonly durable = true;
  private readonly memory = new MemoryDeliveryStore();
  claim(claim: DeliveryClaim) {
    return this.memory.claim(claim);
  }
  renew(claim: DeliveryClaim) {
    return this.memory.renew(claim);
  }
  complete(claim: DeliveryClaim, retainUntil: number) {
    return this.memory.complete(claim, retainUntil);
  }
  release(claim: DeliveryClaim) {
    return this.memory.release(claim);
  }
}

test("webhook signatures cover timestamp and exact UTF-8 body bytes", async () => {
  const timestamp = Math.floor(now / 1000).toString();
  const rawBody = new TextEncoder().encode('{"text":"café"}');
  const expected = `sha256=${createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`), Buffer.from(rawBody)]))
    .digest("hex")}`;

  assert.equal(
    await verifyWebhookSignature({ secret, timestamp, signature: expected, rawBody, now }),
    true,
  );
  assert.equal(
    await verifyWebhookSignature({
      secret,
      timestamp: String(Number(timestamp) + 1),
      signature: expected,
      rawBody,
      now,
    }),
    false,
    "a fresh timestamp cannot be substituted onto a captured signature",
  );
  assert.equal(
    await verifyWebhookSignature({
      secret,
      timestamp,
      signature: expected,
      rawBody: new TextEncoder().encode('{"text":"changed"}'),
      now,
    }),
    false,
  );
  assert.equal(
    await verifyWebhookSignature({
      secret,
      timestamp,
      signature: expected,
      rawBody,
      now: now + 301_000,
    }),
    false,
  );
});

test("handler cancels a webhook stream that exceeds its read deadline", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"], now });
  const api = apiFixture();
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch: api.fetch,
  });
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull() {},
    cancel() {
      cancelled = true;
    },
  });
  const timestamp = Math.floor(now / 1000).toString();
  const request = new Request("https://agent.example.test/webhook", {
    method: "POST",
    headers: {
      "x-hypertask-event": "run.created",
      "x-hypertask-delivery": "delivery-timeout",
      "x-hypertask-timestamp": timestamp,
      "x-hypertask-signature": `sha256=${"0".repeat(64)}`,
    },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  try {
    const responsePromise = agent.handler(request, background().context);
    await new Promise<void>((resolve) => setImmediate(resolve));
    context.mock.timers.tick(2_000);
    const response = await responsePromise;
    assert.equal(response.status, 408);
    assert.equal(cancelled, true);
    assert.equal(api.calls.length, 0);
  } finally {
    context.mock.timers.reset();
  }
});

test("Node adapters do not expose unexpected handler errors", async () => {
  const handler: WebhookHandler = Object.assign(
    async (_request: Request, _context?: BackgroundContext) => {
      throw new Error("database-password-was-here");
    },
    { deliveryStore: new MemoryDeliveryStore() },
  );
  const adapter = nodeHttpAdapter(handler);
  const request = {
    method: "POST",
    url: "/webhook",
    headers: {},
    async *[Symbol.asyncIterator]() {},
  };
  let responseBody = "";
  const headers = new Map<string, string>();
  const response = {
    statusCode: 0,
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
    end(body = "") {
      responseBody = body;
    },
  };

  await adapter(request, response);
  assert.equal(response.statusCode, 500);
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(responseBody.includes("database-password-was-here"), false);
  assert.match(responseBody, /Webhook request failed/);
});

test("Node adapters omit bodies from GET requests", async () => {
  let receivedMethod: string | undefined;
  const handler: WebhookHandler = Object.assign(
    async (request: Request) => {
      receivedMethod = request.method;
      return new Response(null, { status: 405 });
    },
    { deliveryStore: new MemoryDeliveryStore() },
  );
  const adapter = nodeHttpAdapter(handler);
  const request = {
    method: "GET",
    url: "/webhook",
    headers: {},
    async *[Symbol.asyncIterator]() {
      throw new Error("GET body should not be read");
    },
  };
  const response = {
    statusCode: 0,
    setHeader() {},
    end() {},
  };

  await adapter(request, response);
  assert.equal(response.statusCode, 405);
  assert.equal(receivedMethod, "GET");
});

test("client wraps response body read failures", async () => {
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch: async () => {
      const response = new Response(null, { status: 200 });
      response.text = async () => {
        throw new Error("response stream failed");
      };
      return response;
    },
  });

  await assert.rejects(agent.client.request("/mcp/test"), (error) => {
    assert.equal(error instanceof AgentSdkError, true);
    assert.equal((error as AgentSdkError).message, "response stream failed");
    assert.equal((error as AgentSdkError).status, 200);
    return true;
  });
});

test("handler rejects mismatched headers and unsafe runtime capabilities", async () => {
  const api = apiFixture();
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch: api.fetch,
  });
  assert.equal(
    (await agent.handler(webhookRequest(payload(), { "x-hypertask-event": "run.stopped" }), background().context)).status,
    400,
  );
  assert.equal((await agent.handler(webhookRequest(payload()))).status, 503);
  assert.equal(
    (await agent.handler(webhookRequest(payload()), background(true).context)).status,
    503,
    "distributed runtimes require a durable store",
  );
  assert.equal(api.calls.length, 0, "capability failures happen before API access");
});

test("legacy trigger deliveries are verified but do not dispatch a run twice", async () => {
  const api = apiFixture();
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch: api.fetch,
  });
  let handled = 0;
  agent.on("mention", () => {
    handled += 1;
  });
  const legacy = payload({
    event: "comment.mention",
    run: undefined,
  });
  assert.equal((await agent.handler(webhookRequest(legacy), background().context)).status, 204);
  assert.equal(handled, 0);
  assert.equal(api.calls.length, 0);
});

test("prompted handlers receive validated elicitation selection data", async () => {
  const api = apiFixture();
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch: api.fetch,
  });
  let selection: unknown = null;
  agent.on("prompted", async (received) => {
    selection = received.selection;
    await received.thought("Selection received.");
  });
  const selected = payload({
    event: "run.prompted",
    deliveryId: "delivery-selection",
    signal: "select",
    selection: {
      activityId: "activity-question",
      value: "safe",
      label: "Safe path",
    },
    prompt: "Safe path",
  });
  const work = background();
  assert.equal((await agent.handler(webhookRequest(selected), work.context)).status, 202);
  await work.drain();
  assert.deepEqual(selection, selected.selection);

  const invalid = payload({
    event: "run.prompted",
    deliveryId: "delivery-invalid-selection",
    selection: selected.selection,
  });
  assert.equal(
    (await agent.handler(webhookRequest(invalid), background().context)).status,
    400,
  );
});

test("run events bind the token, hydrate context, and use stable activity keys", async () => {
  const api = apiFixture();
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch: api.fetch,
  });
  let seen = false;
  agent.on("mention", async (received) => {
    seen = true;
    assert.equal(received.prompt, "Please investigate");
    assert.equal(received.ticket?.ticketNumber, "TEST-101");
    assert.equal(received.thread[0].kind, "comment");
    await received.thought("Starting now.");
    await received.respond("Done.");
  });
  const work = background();
  assert.equal((await agent.handler(webhookRequest(payload()), work.context)).status, 202);
  await work.drain();
  assert.equal(seen, true);
  assert.equal(
    api.calls.some(
      (call) =>
        call.path === "/api/mcp/comments?task_id=101&limit=100&sort_order=desc",
    ),
    true,
    "hydration requests the latest bounded comment page",
  );
  const activityCalls = api.calls.filter(
    (call) =>
      call.method === "POST" &&
      call.path.endsWith("/mcp/agents/runs/run-1/activities"),
  );
  assert.deepEqual(
    activityCalls.map((call) => call.headers.get("idempotency-key")),
    [
      "delivery-1:1:activity-thought",
      "delivery-1:2:activity-response",
    ],
  );
});

test("malformed hydrated collections fail with AgentSdkError", async () => {
  const api = apiFixture();
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (
      (init.method ?? "GET") === "GET" &&
      url.pathname.endsWith("/mcp/agents/runs/run-1/activities")
    ) {
      return Response.json({ success: true, activities: null });
    }
    return api.fetch(input, init);
  };
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch,
    onError: () => {},
  });
  agent.on("mention", () => {
    assert.fail("malformed context must not reach the handler");
  });

  const work = background();
  assert.equal((await agent.handler(webhookRequest(payload()), work.context)).status, 202);
  await assert.rejects(work.drain(), (error) => {
    assert.equal(error instanceof AgentSdkError, true);
    assert.match((error as AgentSdkError).message, /Agent activities/);
    return true;
  });
});

test("run records cannot overwrite SDK internals", async () => {
  const api = apiFixture();
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (
      (init.method ?? "GET") === "GET" &&
      url.pathname.endsWith("/mcp/agents/runs/run-1")
    ) {
      return Response.json({
        success: true,
        run: {
          ...run,
          client: null,
          deliveryId: "untrusted-value",
          onFirstActivity: null,
          signal: null,
        },
      });
    }
    return api.fetch(input, init);
  };
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch,
  });
  let handled = false;
  agent.on("mention", async (received) => {
    handled = true;
    await received.thought("Internal state is intact.");
  });

  const work = background();
  assert.equal((await agent.handler(webhookRequest(payload()), work.context)).status, 202);
  await work.drain();
  assert.equal(handled, true);
});

test("delivery claims dedupe concurrent work and retain completion", async () => {
  const api = apiFixture();
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch: api.fetch,
  });
  let start!: () => void;
  let finish!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let handled = 0;
  agent.on("mention", async (received) => {
    handled += 1;
    await received.thought("Claimed.");
    start();
    await gate;
  });

  const firstWork = background();
  assert.equal((await agent.handler(webhookRequest(payload()), firstWork.context)).status, 202);
  await started;
  assert.equal((await agent.handler(webhookRequest(payload()), background().context)).status, 204);
  finish();
  await firstWork.drain();
  assert.equal((await agent.handler(webhookRequest(payload()), background().context)).status, 204);
  assert.equal(handled, 1);
});

test("failed background work releases its owner-fenced delivery claim", async () => {
  const api = apiFixture();
  const errors: unknown[] = [];
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch: api.fetch,
    onError: (error) => errors.push(error),
  });
  agent.on("mention", async (received) => {
    await received.thought("Attempting.");
    throw new Error("Handler failed");
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const work = background();
    assert.equal((await agent.handler(webhookRequest(payload()), work.context)).status, 202);
    await assert.rejects(work.drain(), /Handler failed/);
  }
  assert.equal(errors.length, 2);
});

test("task helpers claim, mutate, heartbeat-compatible, and release in order", async () => {
  const api = apiFixture();
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch: api.fetch,
  });
  agent.on("mention", async (received) => {
    await received.thought("Starting task writes.");
    await received.task?.move("QA");
    await received.task?.assign("me");
    await received.task?.comment("A comment");
    const update = { title: "Updated", task_id: 999 };
    await received.task?.update(update);
    await received.task?.attach("https://files.example.test/report.pdf");
  });
  const work = background();
  assert.equal((await agent.handler(webhookRequest(payload()), work.context)).status, 202);
  await work.drain();

  const mutations = api.calls.filter((call) => call.method === "POST");
  const paths = mutations.map((call) => call.path.replace("/api", ""));
  assert.deepEqual(paths, [
    "/mcp/agents/runs/run-1/activities",
    "/mcp/tasks/lease/claim",
    "/mcp/tasks/update",
    "/mcp/tasks/lease/release",
    "/mcp/tasks/lease/claim",
    "/mcp/assignees/assign",
    "/mcp/tasks/lease/release",
    "/mcp/tasks/lease/claim",
    "/mcp/comments",
    "/mcp/tasks/lease/release",
    "/mcp/tasks/lease/claim",
    "/mcp/tasks/update",
    "/mcp/tasks/lease/release",
    "/mcp/tasks/lease/claim",
    "/mcp/tasks/attachments",
    "/mcp/tasks/lease/release",
  ]);
  const updates = mutations.filter((call) => call.path.endsWith("/mcp/tasks/update"));
  assert.deepEqual(
    updates.map((call) => call.headers.get("idempotency-key")),
    ["delivery-1:2:move", "delivery-1:5:update"],
  );
  assert.equal(updates.at(-1)?.body?.task_id, task.id);
  const assignment = mutations.find((call) =>
    call.path.endsWith("/mcp/assignees/assign"),
  );
  assert.equal(assignment?.headers.get("idempotency-key"), "delivery-1:3:assign");
  const comment = mutations.find((call) => call.path.endsWith("/mcp/comments"));
  assert.equal(comment?.headers.get("idempotency-key"), "delivery-1:4:comment");
  const attachment = mutations.find((call) =>
    call.path.endsWith("/mcp/tasks/attachments"),
  );
  assert.equal(attachment?.headers.get("idempotency-key"), "delivery-1:6:attach");
  assert.deepEqual(attachment?.body?.files, [
    {
      filename: "report.pdf",
      content_type: "application/pdf",
      url: "https://files.example.test/report.pdf",
    },
  ]);
  assert.equal(api.calls.some((call) => call.method === "HEAD"), false);
});

test("task helpers release the lease when a write fails", async () => {
  const api = apiFixture({ failUpdate: true });
  const errors: unknown[] = [];
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch: api.fetch,
    onError: (error) => errors.push(error),
  });
  agent.on("mention", async (received) => {
    await received.thought("Updating.");
    await received.task?.update({ title: "Will fail" });
  });
  const work = background();
  assert.equal((await agent.handler(webhookRequest(payload()), work.context)).status, 202);
  await assert.rejects(work.drain(), /Update failed/);
  const postPaths = api.calls
    .filter((call) => call.method === "POST")
    .map((call) => call.path);
  assert.deepEqual(postPaths.slice(-3), [
    "/api/mcp/tasks/lease/claim",
    "/api/mcp/tasks/update",
    "/api/mcp/tasks/lease/release",
  ]);
  assert.equal(errors.length, 1);
});

test("task helper propagates a stop that lands while claiming its lease", async () => {
  const api = apiFixture();
  let claimStarted!: () => void;
  const startedClaim = new Promise<void>((resolve) => {
    claimStarted = resolve;
  });
  let finishClaim!: () => void;
  const claimGate = new Promise<void>((resolve) => {
    finishClaim = resolve;
  });
  let updateSignalAborted: boolean | undefined;
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (init.method === "POST" && url.pathname.endsWith("/mcp/tasks/lease/claim")) {
      claimStarted();
      await claimGate;
      return Response.json({ success: true });
    }
    if (init.method === "POST" && url.pathname.endsWith("/mcp/tasks/update")) {
      updateSignalAborted = init.signal?.aborted;
    }
    return api.fetch(input, init);
  };
  const errors: unknown[] = [];
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch,
    onError: (error) => errors.push(error),
  });
  agent.on("mention", async (received) => {
    await received.thought("Claiming a task lease.");
    await received.task?.update({ title: "Must not be written" });
  });
  agent.on("stop", () => {});

  const activeWork = background();
  assert.equal((await agent.handler(webhookRequest(payload()), activeWork.context)).status, 202);
  await startedClaim;

  const stopWork = background();
  const stopPayload = payload({
    event: "run.stopped",
    deliveryId: "delivery-stop-during-claim",
  });
  assert.equal(
    (await agent.handler(webhookRequest(stopPayload), stopWork.context)).status,
    202,
  );
  await stopWork.drain();

  finishClaim();
  await assert.rejects(activeWork.drain());
  assert.equal(updateSignalAborted, true);
  assert.equal(errors.length, 1);
});

test("task helper settles an in-flight heartbeat before releasing its lease", async (context) => {
  context.mock.timers.enable({ apis: ["setInterval", "setTimeout"], now });
  const api = apiFixture();
  const events: string[] = [];
  let updateStarted!: () => void;
  const startedUpdate = new Promise<void>((resolve) => {
    updateStarted = resolve;
  });
  let finishUpdate!: () => void;
  const updateGate = new Promise<void>((resolve) => {
    finishUpdate = resolve;
  });
  let heartbeatStarted!: () => void;
  const startedHeartbeat = new Promise<void>((resolve) => {
    heartbeatStarted = resolve;
  });
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (init.method === "POST" && url.pathname.endsWith("/mcp/tasks/update")) {
      events.push("update");
      updateStarted();
      await updateGate;
      return Response.json({ success: true });
    }
    if (init.method === "POST" && url.pathname.endsWith("/mcp/tasks/lease/heartbeat")) {
      events.push("heartbeat");
      heartbeatStarted();
      return new Promise<Response>((_, reject) => {
        const abort = () => {
          events.push("heartbeat-settled");
          reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError"));
        };
        init.signal?.addEventListener("abort", abort, { once: true });
        if (init.signal?.aborted) abort();
      });
    }
    if (init.method === "POST" && url.pathname.endsWith("/mcp/tasks/lease/release")) {
      events.push("release");
    }
    return api.fetch(input, init);
  };
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch,
  });
  agent.on("mention", async (received) => {
    await received.thought("Updating with a heartbeat.");
    await received.task?.update({ title: "Updated" });
  });

  try {
    const work = background();
    assert.equal((await agent.handler(webhookRequest(payload()), work.context)).status, 202);
    await startedUpdate;
    context.mock.timers.tick(60_000);
    await startedHeartbeat;
    finishUpdate();
    await work.drain();
    assert.deepEqual(events, ["update", "heartbeat", "heartbeat-settled", "release"]);
  } finally {
    context.mock.timers.reset();
  }
});

test("inactive run snapshots cannot dispatch delayed work", async () => {
  const api = apiFixture();
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (url.pathname.endsWith("/mcp/agents/runs/run-1")) {
      return Response.json({ success: true, run: { ...run, status: "stopped" } });
    }
    return api.fetch(input, init);
  };
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch,
    onError: () => {},
  });
  agent.on("mention", () => {
    assert.fail("inactive runs must not reach handlers");
  });

  const work = background();
  assert.equal((await agent.handler(webhookRequest(payload()), work.context)).status, 202);
  await assert.rejects(work.drain(), /Run is no longer active/);
  assert.equal(
    api.calls.some((call) => call.path.endsWith("/mcp/agents/runs/run-1/activities")),
    false,
  );
});

test("losing one delivery claim does not cancel a sibling delivery", async () => {
  const api = apiFixture();
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch: api.fetch,
  });
  let firstStarted!: () => void;
  const startedFirst = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  let secondStarted!: () => void;
  const startedSecond = new Promise<void>((resolve) => {
    secondStarted = resolve;
  });
  let finishSecond!: () => void;
  const secondGate = new Promise<void>((resolve) => {
    finishSecond = resolve;
  });
  let secondSignal: AbortSignal | undefined;
  agent.on("mention", async (received) => {
    if (received.prompt === "first") {
      firstStarted();
      await new Promise<void>((resolve) => {
        received.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      return;
    }
    secondSignal = received.signal;
    secondStarted();
    await secondGate;
  });
  const firstClaim = new AbortController();
  const secondClaim = new AbortController();
  const firstDispatch = agent.client.dispatch(
    payload({ deliveryId: "delivery-first", prompt: "first" }),
    run,
    firstClaim.signal,
  );
  const secondDispatch = agent.client.dispatch(
    payload({ deliveryId: "delivery-second", prompt: "second" }),
    run,
    secondClaim.signal,
  );

  await Promise.all([startedFirst, startedSecond]);
  firstClaim.abort(new Error("first claim lost"));
  await firstDispatch;
  const siblingWasAborted = secondSignal?.aborted;
  finishSecond();
  await secondDispatch;
  assert.equal(siblingWasAborted, false);
});

test("a stop delivery aborts active work and still reaches stop handlers", async () => {
  const api = apiFixture();
  const errors: unknown[] = [];
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch: api.fetch,
    onError: (error) => errors.push(error),
  });
  let started!: () => void;
  const handlerStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let activeRunAborted = false;
  let stopHandled = false;
  agent.on("mention", async (received) => {
    await received.thought("Waiting for stop.");
    started();
    await new Promise<void>((resolve) => {
      const onAbort = () => {
        activeRunAborted = true;
        resolve();
      };
      received.signal.addEventListener("abort", onAbort, { once: true });
      if (received.signal.aborted) onAbort();
    });
  });
  agent.on("stop", (received) => {
    stopHandled = true;
    assert.equal(received.signal.aborted, true);
  });

  const activeWork = background();
  assert.equal((await agent.handler(webhookRequest(payload()), activeWork.context)).status, 202);
  await handlerStarted;

  const stopWork = background();
  const stopPayload = payload({
    event: "run.stopped",
    deliveryId: "delivery-stop",
  });
  assert.equal(
    (await agent.handler(webhookRequest(stopPayload), stopWork.context)).status,
    202,
  );
  await Promise.all([activeWork.drain(), stopWork.drain()]);

  assert.equal(activeRunAborted, true);
  assert.equal(stopHandled, true);
  assert.equal(errors.length, 0);
});

test("stopping during hydration prevents the cancelled handler from starting", async () => {
  const api = apiFixture();
  let holdComments = true;
  let hydrationStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    hydrationStarted = resolve;
  });
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (holdComments && url.pathname.endsWith("/mcp/comments")) {
      hydrationStarted();
      return new Promise<Response>((_, reject) => {
        const rejectAbort = () =>
          reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError"));
        init.signal?.addEventListener("abort", rejectAbort, { once: true });
        if (init.signal?.aborted) rejectAbort();
      });
    }
    return api.fetch(input, init);
  };
  const errors: unknown[] = [];
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch,
    onError: (error) => errors.push(error),
  });
  let mentionHandled = false;
  let stopHandled = false;
  agent.on("mention", () => {
    mentionHandled = true;
  });
  agent.on("stop", () => {
    stopHandled = true;
  });

  const activeWork = background();
  assert.equal((await agent.handler(webhookRequest(payload()), activeWork.context)).status, 202);
  await started;
  holdComments = false;

  const stopWork = background();
  const stopPayload = payload({
    event: "run.stopped",
    deliveryId: "delivery-stop-hydration",
  });
  assert.equal(
    (await agent.handler(webhookRequest(stopPayload), stopWork.context)).status,
    202,
  );
  const [activeResult, stopResult] = await Promise.allSettled([
    activeWork.drain(),
    stopWork.drain(),
  ]);

  assert.equal(activeResult.status, "rejected");
  assert.equal(stopResult.status, "fulfilled");
  assert.equal(mentionHandled, false);
  assert.equal(stopHandled, true);
  assert.equal(errors.length, 1, "the cancelled delivery reports its aborted work");
});

test("completion waits for an in-flight delivery claim renewal", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "setInterval"], now });
  const api = apiFixture();
  const events: string[] = [];
  let claimed: DeliveryClaim | null = null;
  let renewalStarted!: () => void;
  const startedRenewal = new Promise<void>((resolve) => {
    renewalStarted = resolve;
  });
  let finishRenewal!: () => void;
  const renewalGate = new Promise<void>((resolve) => {
    finishRenewal = resolve;
  });
  const store: DeliveryStore = {
    durable: true,
    async claim(value) {
      claimed = value;
      events.push("claim");
      return "claimed";
    },
    async renew(value) {
      events.push("renew");
      renewalStarted();
      await renewalGate;
      return claimed?.owner === value.owner;
    },
    async complete(value) {
      events.push("complete");
      return claimed?.owner === value.owner;
    },
    async release() {
      events.push("release");
      return true;
    },
  };
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch: api.fetch,
    deliveryStore: store,
  });
  let finishHandler!: () => void;
  const handlerGate = new Promise<void>((resolve) => {
    finishHandler = resolve;
  });
  agent.on("mention", async (received) => {
    await received.thought("Long-running work.");
    await handlerGate;
  });

  try {
    const work = background(true);
    assert.equal((await agent.handler(webhookRequest(payload()), work.context)).status, 202);
    await new Promise<void>((resolve) => setImmediate(resolve));
    context.mock.timers.tick(120_000);
    await startedRenewal;
    finishHandler();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(events.includes("complete"), false);
    finishRenewal();
    await work.drain();
    assert.deepEqual(events, ["claim", "renew", "complete"]);
  } finally {
    context.mock.timers.reset();
  }
});

test("automatic acknowledgement failures stay observed until the handler settles", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"], now });
  const api = apiFixture({ failActivity: true });
  const errors: unknown[] = [];
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch: api.fetch,
    onError: (error) => errors.push(error),
  });
  let handlerStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    handlerStarted = resolve;
  });
  let finishHandler!: () => void;
  const handlerGate = new Promise<void>((resolve) => {
    finishHandler = resolve;
  });
  agent.on("mention", async () => {
    handlerStarted();
    await handlerGate;
  });

  try {
    const work = background();
    assert.equal((await agent.handler(webhookRequest(payload()), work.context)).status, 202);
    await started;
    context.mock.timers.tick(8_000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    finishHandler();
    await assert.rejects(work.drain(), /Activity failed/);
    assert.equal(errors.length, 1);
  } finally {
    context.mock.timers.reset();
  }
});

test("dispatch waits for an automatic thought already in flight", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"], now });
  const api = apiFixture();
  let activityStarted!: () => void;
  const startedActivity = new Promise<void>((resolve) => {
    activityStarted = resolve;
  });
  let finishActivity!: () => void;
  const activityGate = new Promise<void>((resolve) => {
    finishActivity = resolve;
  });
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (
      init.method === "POST" &&
      url.pathname.endsWith("/mcp/agents/runs/run-1/activities")
    ) {
      activityStarted();
      await activityGate;
    }
    return api.fetch(input, init);
  };
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch,
    onError: () => {},
  });
  let handlerStarted!: () => void;
  const startedHandler = new Promise<void>((resolve) => {
    handlerStarted = resolve;
  });
  let finishHandler!: () => void;
  const handlerGate = new Promise<void>((resolve) => {
    finishHandler = resolve;
  });
  agent.on("mention", async () => {
    handlerStarted();
    await handlerGate;
    throw new Error("handler failed while thought was pending");
  });

  try {
    const work = background();
    assert.equal((await agent.handler(webhookRequest(payload()), work.context)).status, 202);
    await startedHandler;
    context.mock.timers.tick(8_000);
    await startedActivity;

    let drainSettled = false;
    const drainResult = work
      .drain()
      .then(
        () => ({ status: "fulfilled" as const, error: null }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      )
      .finally(() => {
        drainSettled = true;
      });
    finishHandler();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(drainSettled, false);

    finishActivity();
    const result = await drainResult;
    assert.equal(result.status, "rejected");
    assert.match(String(result.error), /handler failed while thought was pending/);
  } finally {
    finishHandler();
    finishActivity();
    context.mock.timers.reset();
  }
});

test("successful handlers cancel an unstarted automatic thought", async () => {
  const api = apiFixture();
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch: api.fetch,
  });
  agent.on("mention", () => {});

  const work = background();
  assert.equal((await agent.handler(webhookRequest(payload()), work.context)).status, 202);
  await work.drain();
  assert.equal(
    api.calls.some(
      (call) =>
        call.method === "POST" &&
        call.path.endsWith("/mcp/agents/runs/run-1/activities"),
    ),
    false,
  );
});

test("automatic acknowledgement posts a thought before ten seconds", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"], now });
  const api = apiFixture();
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch: api.fetch,
  });
  let handlerStarted!: () => void;
  const startedHandler = new Promise<void>((resolve) => {
    handlerStarted = resolve;
  });
  let finishHandler!: () => void;
  const handlerGate = new Promise<void>((resolve) => {
    finishHandler = resolve;
  });
  agent.on("mention", async () => {
    handlerStarted();
    await handlerGate;
  });

  try {
    const work = background();
    assert.equal((await agent.handler(webhookRequest(payload()), work.context)).status, 202);
    await startedHandler;
    context.mock.timers.tick(8_000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    finishHandler();
    await work.drain();
    const activity = api.calls.find(
      (call) =>
        call.method === "POST" &&
        call.path.endsWith("/mcp/agents/runs/run-1/activities"),
    );
    assert.deepEqual(activity?.body, { type: "thought", text: "Working on this." });
  } finally {
    finishHandler();
    context.mock.timers.reset();
  }
});

test("memory delivery claims expire and fence stale owners", async () => {
  let clock = 1_000;
  const store = new MemoryDeliveryStore({ now: () => clock });
  const first = { deliveryId: "one", owner: "first", leaseUntil: 2_000 };
  assert.equal(await store.claim(first), "claimed");
  assert.equal(
    await store.complete({ ...first, owner: "wrong" }, 5_000),
    false,
  );
  assert.equal(await store.claim({ ...first, owner: "second" }), "processing");
  clock = 2_001;
  assert.equal(await store.renew({ ...first, leaseUntil: 3_000 }), false);
  assert.equal(await store.complete(first, 5_000), false);
  const second = { deliveryId: "one", owner: "second", leaseUntil: 3_000 };
  assert.equal(await store.claim(second), "claimed");
  assert.equal(await store.complete(first, 5_000), false);
  assert.equal(await store.renew(second), true);
  assert.equal(await store.complete(second, 5_000), true);
  assert.equal(await store.claim({ ...second, owner: "third" }), "completed");
});

test("distributed handlers accept an explicitly durable store", async () => {
  const api = apiFixture();
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch: api.fetch,
    deliveryStore: new DurableTestStore(),
  });
  agent.on("mention", async (received) => {
    await received.thought("Durably claimed.");
  });
  const work = background(true);
  assert.equal((await agent.handler(webhookRequest(payload()), work.context)).status, 202);
  await work.drain();
});

test("package manifest exports only dependency-free runtime entry points", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../packages/agent-sdk/package.json", import.meta.url), "utf8"),
  );
  assert.equal(manifest.name, "@hypertask/agent-sdk");
  assert.equal(manifest.dependencies, undefined);
  assert.deepEqual(Object.keys(manifest.exports), [
    ".",
    "./adapters",
    "./templates",
    "./templates/*",
  ]);
});
