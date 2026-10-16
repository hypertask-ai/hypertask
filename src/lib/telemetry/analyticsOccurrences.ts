import { createHash } from "node:crypto";
import { LogType, Prisma, Status } from "@prisma/client";
import prisma from "@/lib/prisma";
import { postHogClient } from "./signupAnalytics";

function occurrenceUuid(userId: number | "business", marker: string): string {
  const hash = createHash("sha1")
    .update(Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex"))
    .update(`hypertask:activation:${userId}:${marker}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export async function captureAnalyticsOccurrence(
  userId: number,
  event: string,
  marker: string,
  properties: Record<string, unknown> | ((tx: Prisma.TransactionClient) => Promise<Record<string, unknown>>),
  { createdAt, scope = "user" }: { createdAt?: Date; scope?: "user" | "business" } = {},
): Promise<void> {
  const client = postHogClient();
  if (!client) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(7034::int, ${userId}::int)`;
    if (scope === "business") await tx.$executeRaw`SELECT pg_advisory_xact_lock(7268::int, hashtext(${marker}))`;
    if (await tx.logs.findFirst({ where: { ...(scope === "user" ? { LoggedById: userId } : {}), log: marker } })) return;
    await client.captureImmediate({
      distinctId: String(userId), event, uuid: occurrenceUuid(scope === "business" ? "business" : userId, marker),
      properties: typeof properties === "function" ? await properties(tx) : properties,
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
