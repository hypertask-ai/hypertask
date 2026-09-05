import type {
  BackgroundContext,
  DeliveryScheduler,
  WebhookHandler,
} from "./types.js";

const MAX_WEBHOOK_BYTES = 1024 * 1024;
const BODY_READ_TIMEOUT_MS = 2_000;
const RAW_BODY_ERROR =
  "Raw webhook bytes are unavailable; mount this adapter before body-parsing middleware";

class AdapterInputError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AdapterInputError";
  }
}

type HeaderValue = string | string[] | undefined;
type NodeRequest = AsyncIterable<Uint8Array | string> & {
  method?: string;
  url?: string;
  headers: Record<string, HeaderValue>;
  body?: unknown;
};
type NodeResponse = {
  statusCode: number;
  setHeader(name: string, value: string | string[]): void;
  end(body?: string | Uint8Array): void;
};
type ExpressResponse = NodeResponse & {
  status?(status: number): ExpressResponse;
  send?(body?: string): void;
};
type HonoContext = {
  req: { raw: Request };
};

type AdapterOptions = {
  scheduler?: DeliveryScheduler;
  distributed?: boolean;
};

function requestHeaders(values: Record<string, HeaderValue>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

async function collectBody(request: AsyncIterable<Uint8Array | string>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const deadline = Date.now() + BODY_READ_TIMEOUT_MS;
  const iterator = request[Symbol.asyncIterator]();
  try {
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new AdapterInputError(408, "Webhook body timed out");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        iterator.next(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new AdapterInputError(408, "Webhook body timed out")),
            remaining,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      if (result.done) break;
      if (typeof result.value === "string") {
        throw new AdapterInputError(400, RAW_BODY_ERROR);
      }
      const chunk = result.value;
      size += chunk.length;
      if (size > MAX_WEBHOOK_BYTES) {
        throw new AdapterInputError(413, "Webhook body is too large");
      }
      chunks.push(chunk);
    }
  } catch (error) {
    try {
      const cleanup = iterator.return?.();
      if (cleanup) void cleanup.catch(() => undefined);
    } catch {
      // Preserve the body limit or timeout error.
    }
    throw error;
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
}

function byteBody(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

async function toRequest(request: NodeRequest, useParsedBody: boolean): Promise<Request> {
  const method = (request.method ?? "POST").toUpperCase();
  let requestBody: ArrayBuffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    let body: Uint8Array;
    if (useParsedBody && request.body !== undefined) {
      const bytes = byteBody(request.body);
      if (!bytes) {
        throw new AdapterInputError(400, RAW_BODY_ERROR);
      }
      body = bytes;
    } else {
      body = await collectBody(request);
    }
    if (body.length > MAX_WEBHOOK_BYTES) {
      throw new AdapterInputError(413, "Webhook body is too large");
    }
    requestBody = new ArrayBuffer(body.byteLength);
    new Uint8Array(requestBody).set(body);
  }
  const headers = requestHeaders(request.headers);
  const host = headers.get("host") ?? "localhost";
  const forwardedProtocol = headers.get("x-forwarded-proto")?.split(",")[0].trim();
  const protocol = forwardedProtocol === "https" ? "https" : "http";
  return new Request(new URL(request.url ?? "/", `${protocol}://${host}`), {
    method,
    headers,
    body: requestBody,
  });
}

async function sendResponse(response: Response, target: NodeResponse): Promise<void> {
  const body = new Uint8Array(await response.arrayBuffer());
  target.statusCode = response.status;
  const responseHeaders = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (response.headers.has("set-cookie") && !responseHeaders.getSetCookie) {
    throw new Error("The Headers implementation cannot preserve Set-Cookie values");
  }
  const setCookies = responseHeaders.getSetCookie?.() ?? [];
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie" || setCookies.length === 0) target.setHeader(name, value);
  });
  if (setCookies.length > 0) target.setHeader("set-cookie", setCookies);
  target.end(body);
}

function processContext(options: AdapterOptions): BackgroundContext {
  return {
    scheduler: options.scheduler,
    distributed: options.distributed ?? true,
  };
}

async function invokeHandler(
  handler: WebhookHandler,
  request: Request,
  context: BackgroundContext,
): Promise<Response> {
  try {
    return await handler(request, context);
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: "Webhook request failed" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
}

function sendAdapterError(error: unknown, response: NodeResponse): void {
  const status = error instanceof AdapterInputError ? error.status : 500;
  const publicMessage =
    error instanceof AdapterInputError ? error.message : "Webhook request failed";
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ success: false, error: publicMessage }));
}

export function nodeHttpAdapter(handler: WebhookHandler, options: AdapterOptions = {}) {
  return async (request: NodeRequest, response: NodeResponse): Promise<void> => {
    try {
      await sendResponse(
        await handler(await toRequest(request, false), processContext(options)),
        response,
      );
    } catch (error) {
      sendAdapterError(error, response);
    }
  };
}

export function expressAdapter(handler: WebhookHandler, options: AdapterOptions = {}) {
  return async (request: NodeRequest, response: ExpressResponse): Promise<void> => {
    try {
      await sendResponse(
        await handler(await toRequest(request, true), processContext(options)),
        response,
      );
    } catch (error) {
      sendAdapterError(error, response);
    }
  };
}

export function honoAdapter(
  handler: WebhookHandler,
  options: AdapterOptions = {},
) {
  return async (context: HonoContext): Promise<Response> => {
    const distributed = options.distributed ?? true;
    if (distributed && !options.scheduler && !handler.scheduler) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "A durable delivery scheduler is required for distributed Hono adapters",
        }),
        { status: 503, headers: { "content-type": "application/json" } },
      );
    }
    return invokeHandler(handler, context.req.raw, processContext({ ...options, distributed }));
  };
}

export function nextRouteAdapter(
  handler: WebhookHandler,
  scheduler: DeliveryScheduler,
) {
  return (request: Request): Promise<Response> =>
    invokeHandler(handler, request, { scheduler, distributed: true });
}

export function cloudflareWorkerAdapter(
  handler: WebhookHandler,
  scheduler: DeliveryScheduler,
) {
  return (
    request: Request,
    _environment: unknown,
    _context: unknown,
  ): Promise<Response> =>
    invokeHandler(handler, request, { scheduler, distributed: true });
}
