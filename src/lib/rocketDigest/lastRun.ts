import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { announcementDigest } from "./cursor";

const DAY_MS = 24 * 60 * 60 * 1000;
export const DIGEST_HISTORY_DAYS = 45;
const LAST_RUN_KEY = "rocket-digest:last-run";
const LAST_RUN_TTL_SECONDS = 90 * 24 * 60 * 60;

function newestOf(dates: readonly Date[]): Date | null {
  if (!dates.length) return null;
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

export async function recordDigestRun(now: Date): Promise<void> {
  try {
    const redis = await getRedis();
    await redis.set(LAST_RUN_KEY, now.toISOString(), "EX", LAST_RUN_TTL_SECONDS);
  } catch {
    return;
  }
}

export async function lastDigestRunAt(): Promise<Date | null> {
  const rows = await prisma.announcments.findMany({
    where: { createdAt: { gte: new Date(Date.now() - DIGEST_HISTORY_DAYS * DAY_MS) } },
    select: { body: true },
  });
  const runAt = rows
    .map((row) => announcementDigest(row.body)?.runAt)
    .filter((value): value is string => typeof value === "string")
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()));
  try {
    const redis = await getRedis();
    const recorded = await redis.get(LAST_RUN_KEY);
    if (recorded) {
      const date = new Date(recorded);
      if (!Number.isNaN(date.getTime())) runAt.push(date);
    }
  } catch {
    return newestOf(runAt);
  }
  return newestOf(runAt);
}
