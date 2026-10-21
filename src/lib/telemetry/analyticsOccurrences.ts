import { createHash } from "node:crypto";
import { LogType, Prisma, Status } from "@prisma/client";
import prisma from "@/lib/prisma";
import { HTPR_7292_SHARED_ACCOUNT_CATEGORY_FLAG, HTPR_7294_FUNNEL_PROBE_CATEGORY_FLAG, isFeatureEnabled } from "@/lib/flags";
import { accountCategory, type AccountCategory } from "./accountCategory";
import { postHogClient } from "./signupAnalytics";
import { deliverAnalyticsOutbox, isAnalyticsOutboxEnabled } from "./analyticsOutbox";

function occurrenceUuid(userId: number | "business", marker: string): string {
  const hash = createHash("sha1")
    .update(Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex"))
    .update(`hypertask:activation:${userId}:${marker}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function businessTime(value: unknown): Date | undefined {
  const time = typeof value === "string" ? new Date(value) : undefined;
  return time && Number.isFinite(time.getTime()) ? time : undefined;
}

function occurrenceTime(properties: Record<string, unknown>, occurredAt?: Date, createdAt?: Date): Date {
  return occurredAt ?? businessTime(properties.occurred_at) ?? createdAt ?? new Date();
}

async function sharedAccountCategory(userId: number): Promise<AccountCategory | null> {
  if (!(await isFeatureEnabled(HTPR_7292_SHARED_ACCOUNT_CATEGORY_FLAG, userId))) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, uid: true, email: true } });
  return user ? accountCategory(user, { probeDomain: await isFeatureEnabled(HTPR_7294_FUNNEL_PROBE_CATEGORY_FLAG, userId) }) : null;
}

type OccurrenceProperties = Record<string, unknown> | ((tx: Prisma.TransactionClient) => Promise<Record<string, unknown>>);

async function withAccountCategory(userId: number, properties: OccurrenceProperties) {
  const category = await sharedAccountCategory(userId);
  return async (tx: Prisma.TransactionClient) => {
    const resolved = typeof properties === "function" ? await properties(tx) : properties;
    return category === null ? resolved : { ...resolved, account_category: category };
  };
}

export async function captureAnalyticsOccurrence(
  userId: number,
  event: string,
  marker: string,
  rawProperties: OccurrenceProperties,
  { createdAt, scope = "user", occurredAt }: { createdAt?: Date; scope?: "user" | "business"; occurredAt?: Date } = {},
): Promise<void> {
  const client = postHogClient();
  if (!client) return;
  const properties = await withAccountCategory(userId, rawProperties);
  if (await isAnalyticsOutboxEnabled(userId)) {
    const key = `${scope === "user" ? userId : "business"}:${marker}`;
    const row = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7034::int, ${userId}::int)`;
      if (scope === "business") await tx.$executeRaw`SELECT pg_advisory_xact_lock(7268::int, hashtext(${marker}))`;
      if (await tx.logs.findFirst({ where: { ...(scope === "user" ? { LoggedById: userId } : {}), log: marker } })) return;
      if (await tx.analyticsOutbox.findUnique({ where: { key } })) return;
      const capturedProperties = await properties(tx);
      await tx.logs.create({ data: {
        log: marker, LoggedById: userId, type: LogType.Signup, status: Status.Normal,
        ...(createdAt ? { createdAt } : {}),
      } });
      return tx.analyticsOutbox.create({ data: {
        key, userId, event, uuid: occurrenceUuid(scope === "business" ? "business" : userId, marker),
        properties: capturedProperties as Prisma.InputJsonObject,
        occurredAt: occurrenceTime(capturedProperties, occurredAt, createdAt),
      } });
    }, { timeout: 20000, maxWait: 1500 });
    if (row) await deliverAnalyticsOutbox(row);
    return;
  }
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(7034::int, ${userId}::int)`;
    if (scope === "business") await tx.$executeRaw`SELECT pg_advisory_xact_lock(7268::int, hashtext(${marker}))`;
    if (await tx.logs.findFirst({ where: { ...(scope === "user" ? { LoggedById: userId } : {}), log: marker } })) return;
    const capturedProperties = await properties(tx);
    await client.captureImmediate({
      distinctId: String(userId), event, uuid: occurrenceUuid(scope === "business" ? "business" : userId, marker),
      properties: capturedProperties, timestamp: occurrenceTime(capturedProperties, occurredAt, createdAt),
    });
    await tx.logs.create({ data: {
      log: marker, LoggedById: userId, type: LogType.Signup, status: Status.Normal,
      ...(createdAt ? { createdAt } : {}),
    } });
  }, { timeout: 20000, maxWait: 1500 });
}

export function serverAnalyticsProperties(
  userId: number,
  workspaceId: string | null,
  boardId: number | null,
  eventId: string,
  occurredAt: Date,
) {
  return {
    user_id: String(userId), workspace_id: workspaceId, board_id: boardId === null ? null : String(boardId),
    source: "server", event_id: eventId, occurred_at: occurredAt.toISOString(),
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
    utm_source: null, utm_medium: null, utm_campaign: null, initial_referrer: null,
    is_seeded: null, account_category: null, attribution_status: "unknown",
  };
}
