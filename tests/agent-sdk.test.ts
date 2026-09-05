import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  createAgent,
  AgentSdkError,
  MemoryDeliveryStore,
  expressAdapter,
  honoAdapter,
  nodeHttpAdapter,
  verifyWebhookSignature,
  type AgentRunRecord,
  type AgentWebhookPayload,
  type BackgroundContext,
  type DeliveryClaim,
  type DeliveryScheduler,
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
  signal?: AbortSignal | null;
};

function apiFixture(
  options: {
    activities?: unknown[];
    failActivity?: boolean;
    failUpdate?: boolean;
    malformedActivity?: boolean;
  } = {},
) {
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
    calls.push({
      method,
      path: `${url.pathname}${url.search}`,
      headers,
      body,
      signal: init.signal,
    });

    if (method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    }
    if (url.pathname.endsWith("/mcp/agents/runs/run-1/activities")) {
      if (method === "GET") {
        return Response.json({ success: true, activities: options.activities ?? [] });
      }
      if (options.failActivity) {
        return Response.json(
          { success: false, error: "Activity failed" },
          { status: 500 },
        );
      }
      if (options.malformedActivity) {
        return Response.json({ success: true, activity: null });
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
            id: 10,
            text: "Later same-time comment",
            commentText: "Later same-time comment",
            createdAt: new Date(now - 500).toISOString(),
          },
          {
            id: 9,
            text: "Earlier same-time comment",
            commentText: "Earlier same-time comment",
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
    if (url.pathname.endsWith("/mcp/tasks/lease/claim")) {
      return Response.json({
        success: true,
        lease: {
          taskId: task.id,
          holder: "agent-1",
          agentId: "agent-1",
          leaseToken: body?.lease_token,
          expiresAt: new Date(now + 60_000).toISOString(),
        },
      });
    }
    return Response.json({ success: true });
  };
  return { calls, fetch };
}

function background(distributed = false) {
  const tasks: Promise<void>[] = [];
  const deliveries = new Set<string>();
  const scheduler: DeliveryScheduler = {
    async enqueue({ deliveryId, run: processDelivery }) {
      if (deliveries.has(deliveryId)) return "duplicate";
      deliveries.add(deliveryId);
      tasks.push(Promise.resolve().then(processDelivery));
      return "enqueued";
    },
  };
  const context: BackgroundContext = { distributed, scheduler };
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
      return new Promise<void>(() => {});
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

test("Node adapters do not wait for stalled request cleanup", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"], now });
  let cleanupStarted = false;
  let handlerCalled = false;
  const handler: WebhookHandler = Object.assign(
    async () => {
      handlerCalled = true;
      return new Response(null, { status: 202 });
    },
    {
      deliveryStore: new MemoryDeliveryStore(),
      processDelivery: async () => {},
    },
  );
  const adapter = nodeHttpAdapter(handler);
  const request = {
    method: "POST",
    url: "/webhook",
    headers: {},
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise<IteratorResult<Uint8Array>>(() => {}),
        return: () => {
          cleanupStarted = true;
          return new Promise<IteratorResult<Uint8Array>>(() => {});
        },
      };
    },
  };
  const response = {
    statusCode: 0,
    setHeader() {},
    end() {},
  };

  try {
    const responsePromise = adapter(request, response);
    await new Promise<void>((resolve) => setImmediate(resolve));
    context.mock.timers.tick(2_000);
    await responsePromise;
    assert.equal(response.statusCode, 408);
    assert.equal(cleanupStarted, true);
    assert.equal(handlerCalled, false);
  } finally {
    context.mock.timers.reset();
  }
});

test("Node and Express adapters reject decoded webhook strings", async () => {
  let handlerCalls = 0;
  const handler: WebhookHandler = Object.assign(
    async () => {
      handlerCalls += 1;
      return new Response(null, { status: 202 });
    },
    {
      deliveryStore: new MemoryDeliveryStore(),
      processDelivery: async () => {},
    },
  );
  const response = () => ({
    statusCode: 0,
    setHeader() {},
    end() {},
  });
  const nodeResponse = response();
  await nodeHttpAdapter(handler)(
    {
      method: "POST",
      url: "/webhook",
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield "decoded";
      },
    },
    nodeResponse,
  );
  const expressResponse = response();
  await expressAdapter(handler)(
    {
      method: "POST",
      url: "/webhook",
      headers: {},
      body: "decoded",
      async *[Symbol.asyncIterator]() {},
    },
    expressResponse,
  );

  assert.equal(nodeResponse.statusCode, 400);
  assert.equal(expressResponse.statusCode, 400);
  assert.equal(handlerCalls, 0);
});

test("Node adapters do not expose unexpected handler errors", async () => {
  const handler: WebhookHandler = Object.assign(
    async (_request: Request, _context?: BackgroundContext) => {
      throw new Error("database-password-was-here");
    },
    {
      deliveryStore: new MemoryDeliveryStore(),
      processDelivery: async () => {},
    },
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
    end(body: string | Uint8Array = "") {
      responseBody =
        typeof body === "string" ? body : new TextDecoder().decode(body);
    },
  };

  await adapter(request, response);
  assert.equal(response.statusCode, 500);
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(responseBody.includes("database-password-was-here"), false);
  assert.match(responseBody, /Webhook request failed/);
});

test("Node adapters do not classify handler messages as request errors", async () => {
  const handler: WebhookHandler = Object.assign(
    async () => {
      throw new Error("Webhook body is too large");
    },
    {
      deliveryStore: new MemoryDeliveryStore(),
      processDelivery: async () => {},
    },
  );
  let responseBody = "";
  const response = {
    statusCode: 0,
    setHeader() {},
    end(body: string | Uint8Array = "") {
      responseBody =
        typeof body === "string" ? body : new TextDecoder().decode(body);
    },
  };

  await nodeHttpAdapter(handler)(
    {
      method: "POST",
      url: "/webhook",
      headers: {},
      async *[Symbol.asyncIterator]() {},
    },
    response,
  );
  assert.equal(response.statusCode, 500);
  assert.equal(responseBody.includes("Webhook body is too large"), false);
  assert.match(responseBody, /Webhook request failed/);
});

test("Node adapters do not copy response headers before reading the body", async () => {
  const handler: WebhookHandler = Object.assign(
    async () => {
      const response = new Response("unused", {
        status: 201,
        headers: { "content-length": "6", "x-result": "success" },
      });
      response.arrayBuffer = async () => {
        throw new Error("response body failed");
      };
      return response;
    },
    {
      deliveryStore: new MemoryDeliveryStore(),
      processDelivery: async () => {},
    },
  );
  const adapter = nodeHttpAdapter(handler);
  const request = {
    method: "POST",
    url: "/webhook",
    headers: {},
    async *[Symbol.asyncIterator]() {},
  };
  const headers = new Map<string, string>();
  const response = {
    statusCode: 0,
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
    end() {},
  };

  await adapter(request, response);
  assert.equal(response.statusCode, 500);
  assert.equal(headers.has("content-length"), false);
  assert.equal(headers.has("x-result"), false);
  assert.equal(headers.get("content-type"), "application/json");
});

test("Node adapters preserve response body bytes", async () => {
  const bytes = new Uint8Array([0xff, 0x00, 0x80]);
  const handler: WebhookHandler = Object.assign(
    async () =>
      new Response(bytes, {
        status: 200,
        headers: { "content-length": String(bytes.length) },
      }),
    {
      deliveryStore: new MemoryDeliveryStore(),
      processDelivery: async () => {},
    },
  );
  const adapter = nodeHttpAdapter(handler);
  const request = {
    method: "POST",
    url: "/webhook",
    headers: {},
    async *[Symbol.asyncIterator]() {},
  };
  const headers = new Map<string, string>();
  let responseBody: string | Uint8Array | undefined;
  const response = {
    statusCode: 0,
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
    end(body?: string | Uint8Array) {
      responseBody = body;
    },
  };

  await adapter(request, response);
  assert.equal(response.statusCode, 200);
  assert.equal(headers.get("content-length"), String(bytes.length));
  assert.deepEqual(responseBody, bytes);
});

test("Node adapters preserve multiple Set-Cookie response headers", async () => {
  const responseHeaders = new Headers();
  responseHeaders.append("set-cookie", "session=one; Path=/; HttpOnly");
  responseHeaders.append("set-cookie", "preference=two; Path=/");
  const handler: WebhookHandler = Object.assign(
    async () => new Response(null, { status: 204, headers: responseHeaders }),
    {
      deliveryStore: new MemoryDeliveryStore(),
      processDelivery: async () => {},
    },
  );
  const request = {
    method: "POST",
    url: "/webhook",
    headers: {},
    async *[Symbol.asyncIterator]() {},
  };
  const headers = new Map<string, string | string[]>();
  const response = {
    statusCode: 0,
    setHeader(name: string, value: string | string[]) {
      headers.set(name, value);
    },
    end() {},
  };

  await nodeHttpAdapter(handler)(request, response);
  assert.deepEqual(headers.get("set-cookie"), [
    "session=one; Path=/; HttpOnly",
    "preference=two; Path=/",
  ]);
});

test("Node adapters reject cookie headers they cannot preserve", async () => {
  const responseHeaders = new Headers({
    "set-cookie": "session=one; Expires=Wed, 21 Oct 2026 07:28:00 GMT",
  });
  const handlerResponse = new Response(null, {
    status: 204,
    headers: responseHeaders,
  });
  Object.defineProperty(handlerResponse.headers, "getSetCookie", {
    value: undefined,
  });
  const handler: WebhookHandler = Object.assign(
    async () => handlerResponse,
    {
      deliveryStore: new MemoryDeliveryStore(),
      processDelivery: async () => {},
    },
  );
  const request = {
    method: "POST",
    url: "/webhook",
    headers: {},
    async *[Symbol.asyncIterator]() {},
  };
  const headers = new Map<string, string | string[]>();
  let responseBody = "";
  const response = {
    statusCode: 0,
    setHeader(name: string, value: string | string[]) {
      headers.set(name, value);
    },
    end(body: string | Uint8Array = "") {
      responseBody =
        typeof body === "string" ? body : new TextDecoder().decode(body);
    },
  };

  await nodeHttpAdapter(handler)(request, response);
  assert.equal(response.statusCode, 500);
  assert.equal(headers.has("set-cookie"), false);
  assert.match(responseBody, /Webhook request failed/);
});

test("Node adapters require explicit single-process mode", async () => {
  const distributedValues: Array<boolean | undefined> = [];
  const handler: WebhookHandler = Object.assign(
    async (_request: Request, context?: BackgroundContext) => {
      distributedValues.push(context?.distributed);
      return new Response(null, { status: 204 });
    },
    {
      deliveryStore: new MemoryDeliveryStore(),
      processDelivery: async () => {},
    },
  );
  const request = () => ({
    method: "POST",
    url: "/webhook",
    headers: {},
    async *[Symbol.asyncIterator]() {},
  });
  const response = () => ({
    statusCode: 0,
    setHeader() {},
    end() {},
  });

  await nodeHttpAdapter(handler)(request(), response());
  await nodeHttpAdapter(handler, { distributed: false })(request(), response());
  assert.deepEqual(distributedValues, [true, false]);
});

test("Hono adapter preserves single-process mode without an execution context", async () => {
  let receivedContext: BackgroundContext | undefined;
  const handler: WebhookHandler = Object.assign(
    async (_request: Request, context?: BackgroundContext) => {
      receivedContext = context;
      return new Response(null, { status: 204 });
    },
    {
      deliveryStore: new MemoryDeliveryStore(),
      processDelivery: async () => {},
    },
  );

  await honoAdapter(handler, { distributed: false })({
    req: { raw: new Request("https://agent.example.test/webhook") },
  });
  assert.equal(receivedContext?.distributed, false);
  assert.equal(receivedContext?.scheduler, undefined);

  const failingHandler: WebhookHandler = Object.assign(
    async () => {
      throw new Error("private adapter failure");
    },
    {
      deliveryStore: new MemoryDeliveryStore(),
      processDelivery: async () => {},
    },
  );
  const failure = await honoAdapter(failingHandler, {
    scheduler: background(true).context.scheduler,
  })({
    req: { raw: new Request("https://agent.example.test/webhook") },
  });
  assert.equal(failure.status, 500);
  assert.deepEqual(await failure.json(), {
    success: false,
    error: "Webhook request failed",
  });
});

test("distributed Hono adapters require a durable delivery scheduler", async () => {
  let handlerCalls = 0;
  const handler: WebhookHandler = Object.assign(
    async () => {
      handlerCalls += 1;
      return new Response(null, { status: 202 });
    },
    {
      deliveryStore: new MemoryDeliveryStore(),
      processDelivery: async () => {},
    },
  );

  const response = await honoAdapter(handler)({
    req: { raw: new Request("https://agent.example.test/webhook") },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    success: false,
    error: "A durable delivery scheduler is required for distributed Hono adapters",
  });
  assert.equal(handlerCalls, 0);
});

test("Node adapters omit bodies from GET requests", async () => {
  let receivedMethod: string | undefined;
  const handler: WebhookHandler = Object.assign(
    async (request: Request) => {
      receivedMethod = request.method;
      return new Response(null, { status: 405 });
    },
    {
      deliveryStore: new MemoryDeliveryStore(),
      processDelivery: async () => {},
    },
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

test("client trims accepted tokens before authorizing requests", async () => {
  let authorization: string | null = null;
  const agent = createAgent({
    token: "  unit-test-token  ",
    webhookSecret: secret,
    apiUrl,
    fetch: async (_input, init = {}) => {
      authorization = new Headers(init.headers).get("authorization");
      return Response.json({ success: true });
    },
  });

  await agent.client.request("/mcp/test");
  assert.equal(authorization, "Bearer unit-test-token");
  assert.throws(
    () =>
      createAgent({
        token: null as unknown as string,
        webhookSecret: secret,
      }),
    AgentSdkError,
  );
});

test("async onError failures stay observed", async () => {
  const reported: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...values: unknown[]) => {
    reported.push(values);
  };
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch: apiFixture().fetch,
    onError: async () => {
      throw new Error("async callback failed");
    },
  });

  try {
    agent.client.reportError(new Error("original error"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(reported.length, 1);
    assert.match(String(reported[0][1]), /async callback failed/);
  } finally {
    console.error = originalConsoleError;
  }
});

test("malformed activity responses fail with AgentSdkError", async () => {
  const api = apiFixture({ malformedActivity: true });
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch: api.fetch,
    onError: () => {},
  });
  agent.on("mention", async (received) => {
    await received.thought("This response is malformed.");
  });

  const work = background();
  assert.equal((await agent.handler(webhookRequest(payload()), work.context)).status, 202);
  await assert.rejects(work.drain(), (error) => {
    assert.equal(error instanceof AgentSdkError, true);
    assert.match((error as AgentSdkError).message, /Agent activity/);
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

test("handler acknowledges only after the scheduler durably accepts a delivery", async () => {
  const api = apiFixture();
  let persist!: () => void;
  const persisted = new Promise<void>((resolve) => {
    persist = resolve;
  });
  const scheduler: DeliveryScheduler = {
    async enqueue() {
      await persisted;
      return "enqueued";
    },
  };
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch: api.fetch,
  });

  let settled = false;
  const responsePromise = agent.handler(webhookRequest(payload()), { scheduler });
  void responsePromise.then(() => {
    settled = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(api.calls.length, 0);
  persist();
  assert.equal((await responsePromise).status, 202);
});

test("handler returns 503 when durable enqueue fails", async () => {
  const api = apiFixture();
  const errors: unknown[] = [];
  const scheduler: DeliveryScheduler = {
    async enqueue() {
      throw new Error("queue unavailable");
    },
  };
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch: api.fetch,
    onError: (error) => errors.push(error),
  });

  const response = await agent.handler(webhookRequest(payload()), { scheduler });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    success: false,
    error: "Background work was not accepted",
  });
  assert.equal(api.calls.length, 0);
  assert.equal(errors.length, 1);
});

test("permanently unavailable runs complete scheduled work without dispatch", async () => {
  let scheduledRun: (() => Promise<void>) | undefined;
  const scheduler: DeliveryScheduler = {
    async enqueue({ run: processDelivery }) {
      scheduledRun = processDelivery;
      return "enqueued";
    },
  };
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch: async () => Response.json({ success: false }, { status: 404 }),
    onError: () => {},
  });
  agent.on("mention", () => {
    assert.fail("an unavailable run must not dispatch");
  });

  assert.equal(
    (await agent.handler(webhookRequest(payload()), { scheduler })).status,
    202,
  );
  assert.ok(scheduledRun);
  await scheduledRun();
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
  const api = apiFixture({
    activities: [
      {
        id: "3",
        runId: run.id,
        type: "thought",
        text: "Same-time activity",
        link: null,
        options: null,
        selectedOption: null,
        selectedAt: null,
        selectedBy: null,
        createdAt: new Date(now - 500).toISOString(),
      },
    ],
  });
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
    assert.deepEqual(
      received.thread.filter((item) => item.kind === "comment").map((item) => item.id),
      [9, 10],
    );
    assert.deepEqual(
      received.thread.map((item) => item.id),
      [9, 10, "3"],
      "mixed numeric and string IDs retain a transitive tie-break order",
    );
    await received.thought("Starting now.");
    await received.respond("Done.");
  });
  const work = background();
  assert.equal((await agent.handler(webhookRequest(payload()), work.context)).status, 202);
  await work.drain();
  assert.equal(seen, true);
  assert.equal(
    api.calls
      .filter((call) => call.path.includes("/mcp/agents/runs/"))
      .every((call) => call.headers.get("x-hypertask-agent-sdk") === "typescript"),
    true,
    "run requests identify the SDK for server-side rollout gating",
  );
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
      "delivery-1:activity-thought:1",
      "delivery-1:activity-response:1",
    ],
  );
});

test("run routing rejects a trigger that differs from the authoritative run", async () => {
  const api = apiFixture();
  const authoritativeRun = { ...run, trigger: "assigned" as const };
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (url.pathname.endsWith("/mcp/agents/runs/run-1")) {
      return Response.json({ success: true, run: authoritativeRun });
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
  agent.on("*", () => {
    handled = true;
  });

  await assert.rejects(
    agent.client.dispatch(payload(), authoritativeRun),
    /does not belong to this agent token/,
  );
  assert.equal(handled, false);
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
      return Response.json({ success: true, activities: [null] });
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

test("hydrated activities retain the activity discriminator", async () => {
  const api = apiFixture();
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (url.pathname.endsWith("/mcp/agents/runs/run-1/activities")) {
      return Response.json({
        success: true,
        activities: [
          {
            id: "activity-1",
            runId: "run-1",
            type: "thought",
            text: "Working",
            link: null,
            options: null,
            selectedOption: null,
            selectedAt: null,
            selectedBy: null,
            createdAt: "2026-09-04T00:00:00.000Z",
            kind: "comment",
          },
        ],
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
  let activityKind: string | undefined;
  agent.on("mention", (received) => {
    activityKind = received.thread.find((item) => item.id === "activity-1")?.kind;
  });

  const work = background();
  assert.equal((await agent.handler(webhookRequest(payload()), work.context)).status, 202);
  await work.drain();
  assert.equal(activityKind, "activity");
});

test("malformed task status checks fail with AgentSdkError", async () => {
  const api = apiFixture();
  let runRequests = 0;
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (url.pathname.endsWith("/mcp/agents/runs/run-1")) {
      runRequests += 1;
      if (runRequests === 2) {
        return Response.json({ success: true, run: null });
      }
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
  agent.on("mention", async (received) => {
    await received.thought("Checking task status.");
    await received.task?.update({ title: "Must not be written" });
  });

  const work = background();
  assert.equal((await agent.handler(webhookRequest(payload()), work.context)).status, 202);
  await assert.rejects(work.drain(), (error) => {
    assert.equal(error instanceof AgentSdkError, true);
    assert.match((error as AgentSdkError).message, /Agent run/);
    return true;
  });
  assert.equal(
    api.calls.some((call) => call.path.endsWith("/mcp/tasks/lease/claim")),
    false,
  );
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
  const readsDuringWork = api.calls.filter((call) =>
    call.path.endsWith("/mcp/agents/runs/run-1"),
  ).length;
  assert.equal((await agent.handler(webhookRequest(payload()), firstWork.context)).status, 204);
  assert.equal(
    api.calls.filter((call) => call.path.endsWith("/mcp/agents/runs/run-1")).length,
    readsDuringWork,
    "an in-flight duplicate skips the access check",
  );
  finish();
  await firstWork.drain();
  const readsAfterCompletion = api.calls.filter((call) =>
    call.path.endsWith("/mcp/agents/runs/run-1"),
  ).length;
  assert.equal((await agent.handler(webhookRequest(payload()), firstWork.context)).status, 204);
  assert.equal(handled, 1);
  assert.equal(
    api.calls.filter((call) => call.path.endsWith("/mcp/agents/runs/run-1")).length,
    readsAfterCompletion,
    "a completed duplicate skips the access check",
  );
});

test("failed scheduled work releases its claim and remains retryable", async () => {
  const api = apiFixture();
  const errors: unknown[] = [];
  let scheduledRun: (() => Promise<void>) | undefined;
  const scheduler: DeliveryScheduler = {
    async enqueue({ run: processDelivery }) {
      scheduledRun = processDelivery;
      return "enqueued";
    },
  };
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch: api.fetch,
    onError: (error) => errors.push(error),
  });
  let attempts = 0;
  agent.on("mention", async (received) => {
    attempts += 1;
    await received.thought("Attempting.");
    if (attempts === 1) throw new Error("Handler failed");
  });

  assert.equal(
    (await agent.handler(webhookRequest(payload()), { scheduler })).status,
    202,
  );
  assert.ok(scheduledRun);
  await assert.rejects(scheduledRun(), /Handler failed/);
  await agent.processDelivery(payload());
  assert.equal(attempts, 2);
  assert.equal(errors.length, 1);
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
    await received.task?.assign("test@example.test");
    await received.task?.comment("A comment");
    const update = { title: "Updated", task_id: 999 };
    await received.task?.update(update);
    await received.task?.attach("https://files.example.test/report.pdf");
  });
  const work = background();
  assert.equal((await agent.handler(webhookRequest(payload()), work.context)).status, 202);
  await work.drain();

  const lookups = api.calls.filter(
    (call) =>
      call.path.endsWith("/mcp/projects/15/sections") ||
      call.path.endsWith("/mcp/projects/15/members"),
  );
  assert.equal(lookups.length, 2);
  assert.equal(lookups.every((call) => call.signal instanceof AbortSignal), true);
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
  const claims = mutations.filter((call) =>
    call.path.endsWith("/mcp/tasks/lease/claim"),
  );
  const releases = mutations.filter((call) =>
    call.path.endsWith("/mcp/tasks/lease/release"),
  );
  assert.equal(claims.length, releases.length);
  assert.equal(new Set(claims.map((call) => call.body?.lease_token)).size, claims.length);
  for (const [index, claim] of claims.entries()) {
    assert.match(String(claim.body?.lease_token), /^[0-9a-f-]{36}$/i);
    assert.equal(releases[index].body?.lease_token, claim.body?.lease_token);
  }
  const updates = mutations.filter((call) => call.path.endsWith("/mcp/tasks/update"));
  assert.deepEqual(
    updates.map((call) => call.headers.get("idempotency-key")),
    ["delivery-1:move:1", "delivery-1:update:1"],
  );
  assert.equal(updates.at(-1)?.body?.task_id, task.id);
  const assignment = mutations.find((call) =>
    call.path.endsWith("/mcp/assignees/assign"),
  );
  assert.equal(assignment?.headers.get("idempotency-key"), "delivery-1:assign:1");
  const comment = mutations.find((call) => call.path.endsWith("/mcp/comments"));
  assert.equal(comment?.headers.get("idempotency-key"), "delivery-1:comment:1");
  const attachment = mutations.find((call) =>
    call.path.endsWith("/mcp/tasks/attachments"),
  );
  assert.equal(attachment?.headers.get("idempotency-key"), "delivery-1:attach:1");
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

test("task helpers release a claim after an unreadable success response", async () => {
  const api = apiFixture();
  const events: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (init.method === "POST" && url.pathname.endsWith("/mcp/tasks/lease/claim")) {
      events.push("claim");
      const response = new Response(null, { status: 200 });
      response.text = async () => {
        throw new Error("claim response stream failed");
      };
      return response;
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
    onError: () => {},
  });
  agent.on("mention", async (received) => {
    await received.thought("Claiming task.");
    await received.task?.update({ title: "Must not run" });
  });

  const work = background();
  assert.equal((await agent.handler(webhookRequest(payload()), work.context)).status, 202);
  await assert.rejects(work.drain(), /claim response stream failed/);
  assert.deepEqual(events, ["claim", "release"]);
  assert.equal(
    api.calls.some((call) => call.path.endsWith("/mcp/tasks/update")),
    false,
  );
});

test("task helpers safely clean up an uncertain claim", async () => {
  const api = apiFixture();
  let claimToken: unknown;
  let releaseToken: unknown;
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    if (init.method === "POST" && url.pathname.endsWith("/mcp/tasks/lease/claim")) {
      claimToken = body?.lease_token;
      throw new Error("claim connection closed");
    }
    if (init.method === "POST" && url.pathname.endsWith("/mcp/tasks/lease/release")) {
      releaseToken = body?.lease_token;
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
  agent.on("mention", async (received) => {
    await received.thought("Claiming task.");
    await received.task?.update({ title: "Must not run" });
  });

  const work = background();
  assert.equal((await agent.handler(webhookRequest(payload()), work.context)).status, 202);
  await assert.rejects(work.drain(), /claim connection closed/);
  assert.match(String(claimToken), /^[0-9a-f-]{36}$/i);
  assert.equal(releaseToken, claimToken);
});

test("task helpers clean up after an ambiguous claim server error", async () => {
  const api = apiFixture();
  let claimToken: unknown;
  let releaseToken: unknown;
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    if (init.method === "POST" && url.pathname.endsWith("/mcp/tasks/lease/claim")) {
      claimToken = body?.lease_token;
      return Response.json(
        { success: false, error: "Claim outcome unknown" },
        { status: 500 },
      );
    }
    if (init.method === "POST" && url.pathname.endsWith("/mcp/tasks/lease/release")) {
      releaseToken = body?.lease_token;
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
  agent.on("mention", async (received) => {
    await received.thought("Claiming task.");
    await received.task?.update({ title: "Must not run" });
  });

  const work = background();
  assert.equal((await agent.handler(webhookRequest(payload()), work.context)).status, 202);
  await assert.rejects(work.drain(), /Claim outcome unknown/);
  assert.match(String(claimToken), /^[0-9a-f-]{36}$/i);
  assert.equal(releaseToken, claimToken);
});

test("task helpers do not release after a logical claim failure", async () => {
  const api = apiFixture();
  const events: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (init.method === "POST" && url.pathname.endsWith("/mcp/tasks/lease/claim")) {
      events.push("claim");
      return Response.json(
        { success: false, error: "Lease denied" },
        { status: 200 },
      );
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
    onError: () => {},
  });
  agent.on("mention", async (received) => {
    await received.thought("Claiming task.");
    await received.task?.update({ title: "Must not run" });
  });

  const work = background();
  assert.equal((await agent.handler(webhookRequest(payload()), work.context)).status, 202);
  await assert.rejects(work.drain(), /Lease denied/);
  assert.deepEqual(events, ["claim"]);
  assert.equal(
    api.calls.some((call) => call.path.endsWith("/mcp/tasks/update")),
    false,
  );
});

test("a stalled task lease release cannot block later operations", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"], now });
  const api = apiFixture();
  const events: string[] = [];
  const errors: unknown[] = [];
  let releaseStarted!: () => void;
  const startedRelease = new Promise<void>((resolve) => {
    releaseStarted = resolve;
  });
  let releaseCount = 0;
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (init.method === "POST" && url.pathname.endsWith("/mcp/tasks/update")) {
      events.push("update");
    } else if (init.method === "POST" && url.pathname.endsWith("/mcp/comments")) {
      events.push("comment");
    } else if (
      init.method === "POST" &&
      url.pathname.endsWith("/mcp/tasks/lease/release")
    ) {
      releaseCount += 1;
      events.push(`release-${releaseCount}`);
      if (releaseCount === 1) {
        releaseStarted();
        await new Promise(() => {});
      }
    }
    return api.fetch(input, init);
  };
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch,
    onError: (error) => errors.push(error),
  });
  agent.on("mention", async (received) => {
    await received.thought("Testing lease cleanup.");
    await received.task?.update({ title: "First operation" });
    await received.task?.comment("Second operation");
  });

  try {
    const dispatch = agent.client.dispatch(payload(), run);
    await startedRelease;
    context.mock.timers.tick(5_000);
    await dispatch;
    assert.deepEqual(events, ["update", "release-1", "comment", "release-2"]);
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]), /Task lease release timed out/);
  } finally {
    context.mock.timers.reset();
  }
});

test("concurrent task helpers hold separate serialized leases", async () => {
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
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (init.method === "POST" && url.pathname.endsWith("/mcp/tasks/lease/claim")) {
      events.push("claim");
    } else if (init.method === "POST" && url.pathname.endsWith("/mcp/tasks/update")) {
      events.push("update");
      updateStarted();
      await updateGate;
    } else if (init.method === "POST" && url.pathname.endsWith("/mcp/comments")) {
      events.push("comment");
    } else if (
      init.method === "POST" &&
      url.pathname.endsWith("/mcp/tasks/lease/release")
    ) {
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
    await received.thought("Starting parallel task writes.");
    await Promise.all([
      received.task?.update({ title: "Serialized update" }),
      received.task?.comment("Serialized comment"),
    ]);
  });

  const work = background();
  assert.equal((await agent.handler(webhookRequest(payload()), work.context)).status, 202);
  await startedUpdate;
  await new Promise<void>((resolve) => setImmediate(resolve));
  const eventsWhileUpdateWasRunning = [...events];
  finishUpdate();
  await work.drain();

  assert.deepEqual(eventsWhileUpdateWasRunning, ["claim", "update"]);
  assert.deepEqual(events, [
    "claim",
    "update",
    "release",
    "claim",
    "comment",
    "release",
  ]);
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
      const claimBody = JSON.parse(String(init.body));
      return Response.json({
        success: true,
        lease: {
          taskId: task.id,
          holder: "agent-1",
          agentId: "agent-1",
          leaseToken: claimBody.lease_token,
          expiresAt: new Date(now + 60_000).toISOString(),
        },
      });
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

test("contextless runs fail before starting hydration requests", async () => {
  const api = apiFixture();
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch: api.fetch,
  });
  const contextlessRun = { ...run, taskId: null, chatSessionId: null };

  await assert.rejects(
    agent.client.dispatch(
      payload({ taskId: null, run: contextlessRun }),
      contextlessRun,
    ),
    /Agent run has no task or chat context/,
  );
  assert.equal(api.calls.length, 0);
});

test("contextless stop events still reach handlers", async () => {
  const api = apiFixture();
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch: api.fetch,
  });
  let handled = false;
  agent.on("stop", (received) => {
    handled = true;
    assert.equal(received.ticket, null);
    assert.deepEqual(received.thread, []);
  });
  const contextlessRun = { ...run, taskId: null, chatSessionId: null };

  await agent.client.dispatch(
    payload({ event: "run.stopped", taskId: null, run: contextlessRun }),
    contextlessRun,
  );
  assert.equal(handled, true);
  assert.equal(api.calls.length, 0);
});

test("server status polling aborts work stopped on another host", async (context) => {
  context.mock.timers.enable({ apis: ["setInterval"], now });
  const api = apiFixture();
  let runStatus: AgentRunRecord["status"] = "active";
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (url.pathname.endsWith("/mcp/agents/runs/run-1")) {
      return Response.json({ success: true, run: { ...run, status: runStatus } });
    }
    return api.fetch(input, init);
  };
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch,
  });
  let handlerStarted!: () => void;
  const startedHandler = new Promise<void>((resolve) => {
    handlerStarted = resolve;
  });
  agent.on("mention", async (received) => {
    handlerStarted();
    await new Promise<void>((resolve) => {
      const onAbort = () => resolve();
      received.signal.addEventListener("abort", onAbort, { once: true });
      if (received.signal.aborted) onAbort();
    });
  });

  try {
    const dispatch = agent.client.dispatch(payload(), run);
    await startedHandler;
    runStatus = "stopped";
    context.mock.timers.tick(5_000);
    await assert.rejects(dispatch, /Run is no longer active/);
  } finally {
    context.mock.timers.reset();
  }
});

test("a stop tombstone rejects concurrent and post-completion stale deliveries", async () => {
  const api = apiFixture();
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch: api.fetch,
  });
  let activeStarted!: () => void;
  const startedActive = new Promise<void>((resolve) => {
    activeStarted = resolve;
  });
  let stopStarted!: () => void;
  const startedStop = new Promise<void>((resolve) => {
    stopStarted = resolve;
  });
  let finishStop!: () => void;
  const stopGate = new Promise<void>((resolve) => {
    finishStop = resolve;
  });
  let delayedHandled = false;
  agent.on("mention", async (received) => {
    if (received.prompt !== "active") {
      delayedHandled = true;
      return;
    }
    activeStarted();
    await new Promise<void>((resolve) => {
      const onAbort = () => resolve();
      received.signal.addEventListener("abort", onAbort, { once: true });
      if (received.signal.aborted) onAbort();
    });
  });
  agent.on("stop", async () => {
    stopStarted();
    await stopGate;
  });

  const activeDispatch = agent.client.dispatch(
    payload({ deliveryId: "delivery-active", prompt: "active" }),
    run,
  );
  await startedActive;
  const stopDispatch = agent.client.dispatch(
    payload({ event: "run.stopped", deliveryId: "delivery-stop-tombstone" }),
    run,
  );
  await startedStop;
  const delayedDispatch = agent.client.dispatch(
    payload({ deliveryId: "delivery-delayed", prompt: "delayed" }),
    run,
  );

  await assert.rejects(delayedDispatch);
  finishStop();
  await Promise.all([activeDispatch, stopDispatch]);
  await assert.rejects(
    agent.client.dispatch(
      payload({ deliveryId: "delivery-after-stop", prompt: "post-stop" }),
      run,
    ),
  );
  assert.equal(delayedHandled, false);
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
  await assert.rejects(firstDispatch, /first claim lost/);
  const siblingWasAborted = secondSignal?.aborted;
  finishSecond();
  await secondDispatch;
  assert.equal(siblingWasAborted, false);
});

test("claim loss prevents later handlers from running", async () => {
  const api = apiFixture();
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch: api.fetch,
  });
  const claim = new AbortController();
  let laterHandlerCalled = false;
  agent.on("mention", () => {
    claim.abort(new Error("claim lost between handlers"));
  });
  agent.on("mention", () => {
    laterHandlerCalled = true;
  });

  await assert.rejects(
    agent.client.dispatch(payload(), run, claim.signal),
    /claim lost between handlers/,
  );
  assert.equal(laterHandlerCalled, false);
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

test("a stalled delivery renewal aborts before the processing lease expires", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "setInterval"], now });
  const api = apiFixture();
  const events: string[] = [];
  const errors: unknown[] = [];
  let renewalStarted!: () => void;
  const startedRenewal = new Promise<void>((resolve) => {
    renewalStarted = resolve;
  });
  const store: DeliveryStore = {
    durable: true,
    async claim() {
      events.push("claim");
      return "claimed";
    },
    async renew() {
      events.push("renew");
      renewalStarted();
      await new Promise(() => {});
      return true;
    },
    async complete() {
      events.push("complete");
      return true;
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
    onError: (error) => errors.push(error),
  });
  let handlerStarted!: () => void;
  const startedHandler = new Promise<void>((resolve) => {
    handlerStarted = resolve;
  });
  agent.on("mention", async (received) => {
    await received.thought("Waiting for the delivery lease.");
    handlerStarted();
    await new Promise<void>((_resolve, reject) => {
      const rejectForAbort = () => reject(received.signal.reason);
      received.signal.addEventListener("abort", rejectForAbort, { once: true });
      if (received.signal.aborted) rejectForAbort();
    });
  });

  try {
    const work = background(true);
    assert.equal((await agent.handler(webhookRequest(payload()), work.context)).status, 202);
    await startedHandler;
    context.mock.timers.tick(120_000);
    await startedRenewal;
    context.mock.timers.tick(120_000);
    await assert.rejects(work.drain(), /delivery claim renewal timed out/);
    assert.deepEqual(events, ["claim", "renew", "release"]);
    assert.equal(errors.length, 1);
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

test("handler failure aborts an automatic thought already in flight", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"], now });
  const api = apiFixture();
  let activityStarted!: () => void;
  const startedActivity = new Promise<void>((resolve) => {
    activityStarted = resolve;
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
      await new Promise<void>((_resolve, reject) => {
        const rejectForAbort = () => reject(init.signal?.reason);
        init.signal?.addEventListener("abort", rejectForAbort, { once: true });
        if (init.signal?.aborted) rejectForAbort();
      });
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

    finishHandler();
    await assert.rejects(
      work.drain(),
      /handler failed while thought was pending/,
    );
  } finally {
    finishHandler();
    context.mock.timers.reset();
  }
});

test("starting an explicit activity cancels the automatic thought", async (context) => {
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
  let activityRequests = 0;
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (
      init.method === "POST" &&
      url.pathname.endsWith("/mcp/agents/runs/run-1/activities")
    ) {
      activityRequests += 1;
      if (activityRequests === 1) activityStarted();
      await activityGate;
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
    await received.thought("Explicit activity in flight.");
  });

  try {
    const work = background();
    assert.equal((await agent.handler(webhookRequest(payload()), work.context)).status, 202);
    await startedActivity;
    context.mock.timers.tick(8_000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const requestsBeforeRelease = activityRequests;
    finishActivity();
    await work.drain();
    assert.equal(requestsBeforeRelease, 1);
    assert.equal(activityRequests, 1);
  } finally {
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

test("automatic thoughts do not shift mutation keys between delivery retries", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"], now });
  const api = apiFixture();
  let automaticThoughtPosted!: () => void;
  const postedAutomaticThought = new Promise<void>((resolve) => {
    automaticThoughtPosted = resolve;
  });
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (
      init.method === "POST" &&
      url.pathname.endsWith("/mcp/agents/runs/run-1/activities")
    ) {
      automaticThoughtPosted();
    }
    return api.fetch(input, init);
  };
  const agent = createAgent({
    token: "unit-test-token",
    webhookSecret: secret,
    apiUrl,
    fetch,
  });
  let attempt = 0;
  let firstHandlerStarted!: () => void;
  const startedFirstHandler = new Promise<void>((resolve) => {
    firstHandlerStarted = resolve;
  });
  let finishFirstHandler!: () => void;
  const firstHandlerGate = new Promise<void>((resolve) => {
    finishFirstHandler = resolve;
  });
  agent.on("mention", async (received) => {
    attempt += 1;
    if (attempt === 1) {
      firstHandlerStarted();
      await firstHandlerGate;
    }
    await received.task?.comment("Retry-safe comment");
  });

  try {
    const firstDispatch = agent.client.dispatch(payload(), run);
    await startedFirstHandler;
    context.mock.timers.tick(8_000);
    await postedAutomaticThought;
    finishFirstHandler();
    await firstDispatch;
    await agent.client.dispatch(payload(), run);

    const commentKeys = api.calls
      .filter((call) => call.method === "POST" && call.path.endsWith("/mcp/comments"))
      .map((call) => call.headers.get("idempotency-key"));
    assert.deepEqual(commentKeys, [
      "delivery-1:comment:1",
      "delivery-1:comment:1",
    ]);
    const automaticThought = api.calls.find(
      (call) =>
        call.method === "POST" &&
        call.path.endsWith("/mcp/agents/runs/run-1/activities"),
    );
    assert.equal(
      automaticThought?.headers.get("idempotency-key"),
      "delivery-1:automatic-thought:1",
    );
  } finally {
    finishFirstHandler();
    context.mock.timers.reset();
  }
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
  assert.equal(manifest.private, true);
  assert.equal(manifest.dependencies, undefined);
  assert.deepEqual(Object.keys(manifest.exports), [
    ".",
    "./adapters",
    "./templates",
    "./templates/*",
  ]);
});
