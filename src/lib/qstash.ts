import { randomUUID } from "node:crypto";
import { premergeStubEnabled } from "./premergeStubs";
import { Client } from "@upstash/qstash";
import { verifySignature } from "@upstash/qstash/nextjs";
import type { NextApiHandler } from "next";
import { getRedis } from "@/lib/redis";

let qstashClient: Client | undefined;

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
  premergeStubEnabled("queue");
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

const msgIdKey = (path: string, jobId: string) => `qstash:msgid:${path}:${jobId}`;
const lockKey = (path: string, jobId: string) => `qstash:lock:${path}:${jobId}`;
const MSGID_TTL_SECONDS = 60 * 60 * 24 * 8;
const SCHEDULE_LOCK_TTL_SECONDS = 10;

export interface PublishOpts {
  path: string;
  body: unknown;
  notBefore?: number;
}

function extractMessageId(res: unknown): string | undefined {
  if (Array.isArray(res)) return (res[0] as { messageId?: string })?.messageId;
  return (res as { messageId?: string })?.messageId;
}

const premergeJobKey = (path: string, jobId: string) => `premerge:qstash:${path}:${jobId}`;

async function recordPremergeJob(opts: PublishOpts & { jobId?: string }) {
  const messageId = `premerge-${randomUUID()}`;
  const job = { path: opts.path, jobId: opts.jobId ?? messageId, notBefore: opts.notBefore ?? null, messageId };
  const redis = await getRedis();
  await redis.set(premergeJobKey(job.path, job.jobId), JSON.stringify(job), "EX", MSGID_TTL_SECONDS);
  console.info("[premerge-queue] scheduled", JSON.stringify(job));
  return { messageId };
}

export async function publishJob(opts: PublishOpts) {
  if (premergeStubEnabled("queue")) return recordPremergeJob(opts);
  const url = `${qstashCallbackBase()}${opts.path}`;
  return getQstashClient().publishJSON({
    url,
    body: opts.body as object,
    notBefore: opts.notBefore,
  });
}

export async function scheduleJobById(opts: PublishOpts & { jobId: string }) {
  if (premergeStubEnabled("queue")) return recordPremergeJob(opts);
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
    }
  }
}

export async function cancelJobById(jobId: string, path: string): Promise<void> {
  if (premergeStubEnabled("queue")) {
    const redis = await getRedis();
    await redis.del(premergeJobKey(path, jobId));
    console.info("[premerge-queue] cancelled", JSON.stringify({ path, jobId }));
    return;
  }
  const redis = await getRedis();
  const key = msgIdKey(path, jobId);
  const messageId = await redis.get(key);
  if (!messageId) return;
  try {
    await getQstashClient().messages.cancel([messageId]);
  } catch {
  }
  await redis.del(key);
}
