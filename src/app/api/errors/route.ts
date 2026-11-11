import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { reportError } from "@/lib/errors/reportError";
import { FEATURE_FLAG_OWNER_USER_ID, HTPR_8978_UPSTASH_TRAFFIC_FLAG, isFeatureEnabled } from "@/lib/flags";
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
    source: z.enum(["client", "handled"]),
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

const INTAKE_CLAIM = `
local ip = redis.call('INCR', KEYS[1])
if ip == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local global = redis.call('INCR', KEYS[2])
if global == 1 then redis.call('EXPIRE', KEYS[2], ARGV[1]) end
return {ip, global}`;

async function claimIntakeWindow(ipKey: string, globalKey: string) {
  const redis = await getRedis();
  if (await isFeatureEnabled(HTPR_8978_UPSTASH_TRAFFIC_FLAG, FEATURE_FLAG_OWNER_USER_ID)) {
    const counts = await redis.eval(INTAKE_CLAIM, 2, ipKey, globalKey, RATE_WINDOW_SECONDS);
    if (!Array.isArray(counts) || counts.length !== 2) {
      throw new Error("Invalid error intake counters");
    }
    return counts.map(Number) as [number, number];
  }
  const count = (key: string) => redis.incr(key).then(async (value) => {
    if (value === 1) await redis.expire(key, RATE_WINDOW_SECONDS);
    return value;
  });
  return [await count(ipKey), await count(globalKey)] as [number, number];
}

async function isRateLimited(request: NextRequest) {
  const ipHash = createHash("sha256").update(clientIp(request)).digest("hex");
  const window = Math.floor(Date.now() / (RATE_WINDOW_SECONDS * 1000));
  const [ipCount, globalCount] = await claimIntakeWindow(
    `errors:intake:ip:${ipHash}:${window}`,
    `errors:intake:global:${window}`,
  );

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

    await reportError({
      ...parsed.data,
      source: parsed.data.source === "handled" ? "handled" : "client",
    });
  } catch (error) {
    console.error("[api/errors] failed", error);
  }

  return new NextResponse(null, { status: 204 });
}
