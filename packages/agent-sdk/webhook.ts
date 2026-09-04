import { AgentClient, AgentSdkError } from "./client.js";
import type {
  AgentRunRecord,
  AgentWebhookPayload,
  DeliveryClaim,
  DeliveryStore,
  WebhookHandler,
} from "./types.js";

const MAX_WEBHOOK_BYTES = 1024 * 1024;
const BODY_READ_TIMEOUT_MS = 2_000;
const ACCESS_CHECK_TIMEOUT_MS = 2_000;
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;
const PROCESSING_LEASE_MS = 10 * 60 * 1000;
const PROCESSING_HEARTBEAT_MS = 2 * 60 * 1000;
const COMPLETED_RETENTION_MS = 24 * 60 * 60 * 1000;
const RUN_EVENTS = new Set(["run.created", "run.prompted", "run.stopped"]);
const KNOWN_EVENTS = new Set([
  "comment.mention",
  "task.assigned",
  "task.unassigned",
  "comment.created",
  "task.updated",
  "task.created",
  "chat.message",
  "run.created",
  "run.prompted",
  "run.stopped",
  "webhook.test",
]);

type MemoryEntry =
  | { state: "processing"; owner: string; until: number }
  | { state: "completed"; until: number };

export class MemoryDeliveryStore implements DeliveryStore {
  readonly durable = false;
  private readonly entries = new Map<string, MemoryEntry>();

  constructor(
    private readonly options: {
      maxEntries?: number;
      now?: () => number;
    } = {},
  ) {}

  async claim(claim: DeliveryClaim): Promise<"claimed" | "processing" | "completed"> {
    const now = this.now();
    this.removeExpired(now);
    const current = this.entries.get(claim.deliveryId);
    if (current?.state === "completed") return "completed";
    if (current?.state === "processing") return "processing";
    if (this.entries.size >= (this.options.maxEntries ?? 10_000)) {
      throw new AgentSdkError("In-memory delivery store is full");
    }
    this.entries.set(claim.deliveryId, {
      state: "processing",
      owner: claim.owner,
      until: claim.leaseUntil,
    });
    return "claimed";
  }

  async renew(claim: DeliveryClaim): Promise<boolean> {
    const now = this.now();
    const current = this.entries.get(claim.deliveryId);
    if (
      current?.state !== "processing" ||
      current.owner !== claim.owner ||
      current.until <= now
    ) {
      return false;
    }
    current.until = claim.leaseUntil;
    return true;
  }

  async complete(claim: DeliveryClaim, retainUntil: number): Promise<boolean> {
    const now = this.now();
    const current = this.entries.get(claim.deliveryId);
    if (
      current?.state !== "processing" ||
      current.owner !== claim.owner ||
      current.until <= now
    ) {
      return false;
    }
    this.entries.set(claim.deliveryId, { state: "completed", until: retainUntil });
    return true;
  }

  async release(claim: DeliveryClaim): Promise<boolean> {
    const current = this.entries.get(claim.deliveryId);
    if (current?.state !== "processing" || current.owner !== claim.owner) return false;
    return this.entries.delete(claim.deliveryId);
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private removeExpired(now: number): void {
    for (const [deliveryId, entry] of this.entries) {
      if (entry.until <= now) this.entries.delete(deliveryId);
    }
  }
}

class WebhookRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function jsonError(message: string, status: number): Response {
  return Response.json({ success: false, error: message }, { status });
}

function exactHeader(headers: Headers, name: string): string {
  const value = headers.get(name)?.trim() ?? "";
  if (!value || value.includes(",")) {
    throw new WebhookRequestError(`${name} must appear exactly once`, 400);
  }
  return value;
}

function parseHex(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function signedBytes(
  timestamp: string,
  rawBody: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const bytes = new Uint8Array(new ArrayBuffer(prefix.length + rawBody.length));
  bytes.set(prefix);
  bytes.set(rawBody, prefix.length);
  return bytes;
}

export async function verifyWebhookSignature(input: {
  secret: string;
  timestamp: string;
  signature: string;
  rawBody: Uint8Array;
  now?: number;
}): Promise<boolean> {
  if (!/^\d{10}$/.test(input.timestamp)) return false;
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - Number(input.timestamp)) > SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }
  const signatureMatch = /^sha256=([a-f0-9]{64})$/.exec(input.signature);
  if (!signatureMatch) return false;
  const encodedSecret = new TextEncoder().encode(input.secret);
  const secret = new Uint8Array(new ArrayBuffer(encodedSecret.length));
  secret.set(encodedSecret);
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.sign(
      "HMAC",
      key,
      signedBytes(input.timestamp, input.rawBody),
    ),
  );
  return constantTimeEqual(digest, parseHex(signatureMatch[1]));
}

async function readRawBody(request: Request): Promise<Uint8Array> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_WEBHOOK_BYTES)) {
    throw new WebhookRequestError("Webhook body is too large", 413);
  }
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const deadline = Date.now() + BODY_READ_TIMEOUT_MS;
  try {
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new WebhookRequestError("Webhook body timed out", 408);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new WebhookRequestError("Webhook body timed out", 408)),
            remaining,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      if (result.done) break;
      size += result.value.length;
      if (size > MAX_WEBHOOK_BYTES) {
        throw new WebhookRequestError("Webhook body is too large", 413);
      }
      chunks.push(result.value);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
}

async function parseWebhook(
  request: Request,
  secret: string,
): Promise<AgentWebhookPayload> {
  const timestamp = exactHeader(request.headers, "X-Hypertask-Timestamp");
  const signature = exactHeader(request.headers, "X-Hypertask-Signature");
  const event = exactHeader(request.headers, "X-Hypertask-Event");
  const deliveryId = exactHeader(request.headers, "X-Hypertask-Delivery");
  const rawBody = await readRawBody(request);
  if (
    !(await verifyWebhookSignature({
      secret,
      timestamp,
      signature,
      rawBody,
    }))
  ) {
    throw new WebhookRequestError("Webhook signature or timestamp is invalid", 401);
  }

  let payload: AgentWebhookPayload;
  try {
    payload = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(rawBody),
    ) as AgentWebhookPayload;
  } catch {
    throw new WebhookRequestError("Webhook body must be valid UTF-8 JSON", 400);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new WebhookRequestError("Webhook body must be a JSON object", 400);
  }
  if (!KNOWN_EVENTS.has(payload.event) || payload.event !== event) {
    throw new WebhookRequestError("Webhook event header does not match the body", 400);
  }
  if (
    typeof payload.deliveryId !== "string" ||
    payload.deliveryId !== deliveryId ||
    deliveryId.length > 200
  ) {
    throw new WebhookRequestError("Webhook delivery header does not match the body", 400);
  }
  if (typeof payload.agentId !== "string" || !payload.agentId.trim()) {
    throw new WebhookRequestError("Webhook body is missing agentId", 400);
  }
  if (RUN_EVENTS.has(payload.event)) {
    if (
      typeof payload.runId !== "string" ||
      !payload.runId.trim() ||
      !payload.run ||
      typeof payload.run !== "object" ||
      payload.run.id !== payload.runId
    ) {
      throw new WebhookRequestError("Run webhook has invalid run data", 400);
    }
    if (
      payload.event === "run.created" &&
      payload.run.trigger !== "mention" &&
      payload.run.trigger !== "assigned" &&
      payload.run.trigger !== "chat"
    ) {
      throw new WebhookRequestError("Run webhook has an invalid trigger", 400);
    }
  }
  if (payload.signal !== undefined && payload.signal !== "select") {
    throw new WebhookRequestError("Run webhook has an invalid signal", 400);
  }
  if (payload.signal === "select") {
    if (
      payload.event !== "run.prompted" ||
      !payload.selection ||
      typeof payload.selection !== "object" ||
      typeof payload.selection.activityId !== "string" ||
      !payload.selection.activityId.trim() ||
      typeof payload.selection.value !== "string" ||
      !payload.selection.value.trim() ||
      typeof payload.selection.label !== "string" ||
      !payload.selection.label.trim()
    ) {
      throw new WebhookRequestError("Run selection signal has invalid data", 400);
    }
  } else if (payload.selection !== undefined) {
    throw new WebhookRequestError("Run selection is missing its signal", 400);
  }
  if (
    payload.taskId !== null &&
    (!Number.isSafeInteger(payload.taskId) || payload.taskId <= 0)
  ) {
    throw new WebhookRequestError("Webhook body has an invalid taskId", 400);
  }
  return payload;
}

function claimOwner(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createWebhookHandler(options: {
  client: AgentClient;
  webhookSecret: string;
  deliveryStore?: DeliveryStore;
}): WebhookHandler {
  if (!options.webhookSecret.trim()) {
    throw new AgentSdkError("webhookSecret is required");
  }
  const deliveryStore = options.deliveryStore ?? new MemoryDeliveryStore();

  const handler = async (
    request: Request,
    context?: Parameters<WebhookHandler>[1],
  ): Promise<Response> => {
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    }

    let payload: AgentWebhookPayload;
    try {
      payload = await parseWebhook(request, options.webhookSecret);
    } catch (error) {
      return error instanceof WebhookRequestError
        ? jsonError(error.message, error.status)
        : jsonError("Webhook verification failed", 500);
    }
    if (!RUN_EVENTS.has(payload.event)) return new Response(null, { status: 204 });
    if (!context?.waitUntil) {
      return jsonError("A background scheduler is required", 503);
    }
    if (context.distributed && !deliveryStore.durable) {
      return jsonError("A durable DeliveryStore is required for distributed runtimes", 503);
    }

    const accessController = new AbortController();
    const accessTimer = setTimeout(() => accessController.abort(), ACCESS_CHECK_TIMEOUT_MS);
    let run: AgentRunRecord;
    try {
      run = await options.client.assertPayloadAccess(payload, accessController.signal);
    } catch (error) {
      options.client.reportError(error, payload);
      return jsonError(
        error instanceof AgentSdkError && error.status === 404
          ? "Run is unavailable to this agent token"
          : "Could not verify run access",
        error instanceof AgentSdkError && error.status === 404 ? 403 : 503,
      );
    } finally {
      clearTimeout(accessTimer);
    }

    const claim: DeliveryClaim = {
      deliveryId: payload.deliveryId,
      owner: claimOwner(),
      leaseUntil: Date.now() + PROCESSING_LEASE_MS,
    };
    let claimed;
    try {
      claimed = await deliveryStore.claim(claim);
    } catch (error) {
      options.client.reportError(error, payload);
      return jsonError("Could not claim webhook delivery", 503);
    }
    if (claimed !== "claimed") return new Response(null, { status: 204 });

    let begin = () => {};
    const ready = new Promise<void>((resolve) => {
      begin = resolve;
    });
    const claimController = new AbortController();
    let renewalError: unknown;
    let renewalPromise: Promise<void> | null = null;
    const work = ready
      .then(async () => {
        const renewal = setInterval(() => {
          if (renewalPromise || claimController.signal.aborted) return;
          const renewalClaim = {
            ...claim,
            leaseUntil: Date.now() + PROCESSING_LEASE_MS,
          };
          let renewalTimer: ReturnType<typeof setTimeout> | undefined;
          const renewalTimeout = new Promise<never>((_, reject) => {
            renewalTimer = setTimeout(
              () => reject(new AgentSdkError("Webhook delivery claim renewal timed out")),
              PROCESSING_HEARTBEAT_MS,
            );
            (renewalTimer as unknown as { unref?: () => void }).unref?.();
          });
          renewalPromise = Promise.race([
            Promise.resolve().then(() => deliveryStore.renew(renewalClaim)),
            renewalTimeout,
          ])
            .then((renewed) => {
              if (!renewed) throw new AgentSdkError("Webhook delivery claim was lost");
              claim.leaseUntil = renewalClaim.leaseUntil;
            })
            .catch((error) => {
              renewalError = error;
              claimController.abort(error);
            })
            .finally(() => {
              clearTimeout(renewalTimer);
              renewalPromise = null;
            });
        }, PROCESSING_HEARTBEAT_MS);
        (renewal as unknown as { unref?: () => void }).unref?.();
        try {
          await options.client.dispatch(payload, run, claimController.signal);
          clearInterval(renewal);
          await renewalPromise;
          if (renewalError) throw renewalError;
          const completed = await deliveryStore.complete(
            claim,
            Date.now() + COMPLETED_RETENTION_MS,
          );
          if (!completed) throw new AgentSdkError("Webhook delivery claim was lost");
        } finally {
          clearInterval(renewal);
        }
      })
      .catch(async (error) => {
        await deliveryStore.release(claim).catch(() => false);
        options.client.reportError(error, payload);
        throw error;
      });

    try {
      context.waitUntil(work);
      begin();
      return new Response(null, { status: 202 });
    } catch (error) {
      await deliveryStore.release(claim).catch(() => false);
      options.client.reportError(error, payload);
      return jsonError("Background work was not accepted", 503);
    }
  };
  Object.defineProperty(handler, "deliveryStore", { value: deliveryStore });
  return handler as WebhookHandler;
}
