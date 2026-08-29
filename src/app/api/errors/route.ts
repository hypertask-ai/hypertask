import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { reportError } from "@/lib/errors/reportError";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 10 * 1024;
const RATE_WINDOW_SECONDS = 60;
const PER_IP_RATE_LIMIT = 30;
const GLOBAL_RATE_LIMIT = 300;

const extraValueSchema = z.union([
  z.string().max(4000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const errorReportSchema = z
  .object({
    message: z.string().trim().min(1).max(1000),
    stack: z.string().max(8000).optional(),
    url: z.string().max(2048).optional(),
    source: z.enum(["client", "server", "handled"]),
    extra: z
      .record(z.string().max(64), extraValueSchema)
      .refine((value) => Object.keys(value).length <= 10)
      .optional(),
  })
  .strict();

function clientIp(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

async function incrementWithExpiry(key: string) {
  const redis = await getRedis();
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, RATE_WINDOW_SECONDS);
  return count;
}

async function isRateLimited(request: NextRequest) {
  const ipHash = createHash("sha256").update(clientIp(request)).digest("hex");
  const window = Math.floor(Date.now() / (RATE_WINDOW_SECONDS * 1000));
  const [ipCount, globalCount] = await Promise.all([
    incrementWithExpiry(`errors:intake:ip:${ipHash}:${window}`),
    incrementWithExpiry(`errors:intake:global:${window}`),
  ]);

  return ipCount > PER_IP_RATE_LIMIT || globalCount > GLOBAL_RATE_LIMIT;
}

export async function POST(request: NextRequest) {
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }

    if (await isRateLimited(request)) {
      return new NextResponse(null, { status: 204 });
    }

    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }

    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = errorReportSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid error report" }, { status: 400 });
    }

    await reportError(parsed.data);
  } catch (error) {
    console.error("[api/errors] failed", error);
  }

  return new NextResponse(null, { status: 204 });
}
