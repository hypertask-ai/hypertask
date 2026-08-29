import { Client } from "@upstash/qstash";
import { verifySignature } from "@upstash/qstash/nextjs";
import type { NextApiHandler } from "next";
import { getRedis } from "@/lib/redis";

let qstashClient: Client | undefined;

/** Public base URL QStash calls back into (this app). */
export function qstashCallbackBase(): string {
  const b =
    process.env.QSTASH_CALLBACK_BASE_URL ||
    process.env.NEXT_PUBLIC_BASEURL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "";
  const base = b.trim().replace(/\/+$/, "");
  if (!base) {
    throw new Error(
      "Missing QStash callback base URL; set QSTASH_CALLBACK_BASE_URL, NEXT_PUBLIC_BASEURL, or NEXT_PUBLIC_APP_URL."
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    throw new Error(
      "Malformed QStash callback base URL; expected a valid http(s) URL."
    );
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(
      "Malformed QStash callback base URL; expected protocol http:// or https://."
    );
  }

  return base;
}

function requireNonEmptyEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}; QStash jobs must fail fast instead of being silently dropped.`);
  }
  if (/\s/.test(value)) {
    throw new Error(`Malformed ${name}; value must not contain whitespace.`);
  }
  return value;
}

function requireHttpUrlEnv(name: string): string {
  const value = requireNonEmptyEnv(name);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Malformed ${name}; expected a valid http(s) URL.`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Malformed ${name}; expected protocol http:// or https://.`);
  }
  return value;
}

function assertQstashSigningEnv() {
  requireNonEmptyEnv("QSTASH_CURRENT_SIGNING_KEY");
  requireNonEmptyEnv("QSTASH_NEXT_SIGNING_KEY");
}

export function assertQstashRuntimeEnv() {
  requireNonEmptyEnv("QSTASH_TOKEN");
  requireHttpUrlEnv("QSTASH_URL");
  qstashCallbackBase();
  assertQstashSigningEnv();
}

export function getQstashClient() {
  assertQstashRuntimeEnv();
  if (!qstashClient) {
    qstashClient = new Client({
      token: process.env.QSTASH_TOKEN!.trim(),
      baseUrl: process.env.QSTASH_URL!.trim(),
    });
  }
  return qstashClient;
}

export function withQstashSignature(handler: NextApiHandler): NextApiHandler {
  let signedHandler: NextApiHandler | undefined;
  return (req, res) => {
    assertQstashRuntimeEnv();
    if (!signedHandler) {
      signedHandler = verifySignature(handler, {
        currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY!.trim(),
        nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY!.trim(),
      });
    }
    return signedHandler(req, res);
  };
}

// Namespace by queue path so two queues using the same jobId for the same entity
// don't collide in a single Redis keyspace.
const msgIdKey = (path: string, jobId: string) => `qstash:msgid:${path}:${jobId}`;
// Per-job lock guarding the cancel+publish+record sequence in scheduleJobById.
const lockKey = (path: string, jobId: string) => `qstash:lock:${path}:${jobId}`;
// Keep the jobId -> messageId map a little longer than the free-tier max delay (7d).
const MSGID_TTL_SECONDS = 60 * 60 * 24 * 8;
// Short - only has to cover one cancel + publish round-trip.
const SCHEDULE_LOCK_TTL_SECONDS = 10;

export interface PublishOpts {
  /** Internal route QStash should call, e.g. "/api/queues/FAST/generateSummaryQueue". */
  path: string;
  body: unknown;
  /** Unix timestamp in SECONDS to run at; omit for immediate delivery. */
  notBefore?: number;
}

function extractMessageId(res: unknown): string | undefined {
  if (Array.isArray(res)) return (res[0] as { messageId?: string })?.messageId;
  return (res as { messageId?: string })?.messageId;
}

/** Fire-and-forget publish of a delayed/immediate job to an internal queue route. */
export async function publishJob(opts: PublishOpts) {
  const url = `${qstashCallbackBase()}${opts.path}`;
  return getQstashClient().publishJSON({
    url,
    body: opts.body as object,
    notBefore: opts.notBefore,
  });
}

/**
 * Schedule a job under a stable id, replacing any still-pending job with the same
 * id, replacing any older pending message. Uses Redis to map
 * jobId -> QStash messageId so the pending one can be cancelled/replaced.
 *
 * A per-job lock serializes the cancel+publish+record sequence: without it, two
 * concurrent schedules for the same jobId could both cancel the old message and both
 * publish a new one (double delivery + one untracked/leaked message). The loser
 * skips - its runAt is within the lock TTL of the winner's, so the debounce is
 * unchanged. Sequential reschedules still replace as before.
 */
export async function scheduleJobById(opts: PublishOpts & { jobId: string }) {
  const redis = await getRedis();
  const lock = lockKey(opts.path, opts.jobId);
  const gotLock = await redis.set(lock, "1", "EX", SCHEDULE_LOCK_TTL_SECONDS, "NX");
  if (gotLock !== "OK") return undefined;

  try {
    await cancelJobById(opts.jobId, opts.path);
    const res = await publishJob(opts);
    const messageId = extractMessageId(res);
    if (messageId) {
      await redis.set(msgIdKey(opts.path, opts.jobId), messageId, "EX", MSGID_TTL_SECONDS);
    }
    return res;
  } finally {
    try {
      await redis.del(lock);
    } catch {
      // lock TTL will expire it anyway
    }
  }
}

/** Cancel a pending job previously scheduled with scheduleJobById (scoped to its queue path). No-op if already delivered. */
export async function cancelJobById(jobId: string, path: string): Promise<void> {
  const redis = await getRedis();
  const key = msgIdKey(path, jobId);
  const messageId = await redis.get(key);
  if (!messageId) return;
  try {
    await getQstashClient().messages.delete(messageId);
  } catch {
    // already delivered or gone — nothing to cancel
  }
  await redis.del(key);
}
