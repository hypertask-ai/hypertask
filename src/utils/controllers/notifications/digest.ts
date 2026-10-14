import { getRedis } from "@/lib/redis";
import { publishJob } from "@/lib/qstash";

export const NOTIFICATION_DIGEST_QUEUE_PATH =
  "/api/queues/notificationDigestQueue";

export function digestWindowSeconds(): number {
  const raw = Number(process.env.NOTIFICATION_DIGEST_DELAY_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 300;
}

const pendingTtlSeconds = () => digestWindowSeconds() + 120;

const graceSeconds = () => Math.min(120, Math.floor(digestWindowSeconds() / 2));

const pendingKey = (userId: number, taskId: number) =>
  `notif:digest:pending:${userId}:${taskId}`;

const lastDigestedKey = (userId: number, taskId: number) =>
  `notif:digest:last:${userId}:${taskId}`;

const LAST_DIGESTED_TTL_SECONDS = 60 * 60 * 24;

export async function getLastDigestedAt(
  userId: number,
  taskId: number
): Promise<Date | undefined> {
  try {
    const redis = await getRedis();
    const raw = await redis.get(lastDigestedKey(userId, taskId));
    if (!raw) return undefined;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  } catch {
    return undefined;
  }
}

export async function setLastDigestedAt(
  userId: number,
  taskId: number,
  at: Date
) {
  try {
    const redis = await getRedis();
    await redis.set(
      lastDigestedKey(userId, taskId),
      at.toISOString(),
      "EX",
      LAST_DIGESTED_TTL_SECONDS
    );
  } catch {
  }
}

export interface DigestJobBody {
  userId: number;
  taskId: number;
  since: string;
}

export interface DigestFallback {
  type: string;
  body: Record<string, unknown>;
}

interface ClaimValue {
  since: string;
  fallback?: DigestFallback;
}

export async function getDigestFallback(
  userId: number,
  taskId: number
): Promise<DigestFallback | undefined> {
  try {
    const redis = await getRedis();
    const raw = await redis.get(pendingKey(userId, taskId));
    if (!raw) return undefined;
    return (JSON.parse(raw) as ClaimValue).fallback;
  } catch {
    return undefined;
  }
}

export async function enqueueDigest(
  userId: number,
  taskId: number,
  fallback?: DigestFallback
): Promise<boolean> {
  try {
    const redis = await getRedis();
    const openedAt = new Date();
    const since = new Date(openedAt.getTime() - graceSeconds() * 1000);
    const claim: ClaimValue = { since: since.toISOString(), fallback };
    const claimed = await redis.set(
      pendingKey(userId, taskId),
      JSON.stringify(claim),
      "EX",
      pendingTtlSeconds(),
      "NX"
    );

    if (claimed !== "OK") return true;

    const body: DigestJobBody = {
      userId,
      taskId,
      since: since.toISOString(),
    };

    const job = {
      path: NOTIFICATION_DIGEST_QUEUE_PATH,
      body,
      notBefore: Math.floor(openedAt.getTime() / 1000) + digestWindowSeconds(),
    };

    try {
      await publishJob(job);
    } catch {
      await publishJob(job);
    }

    return true;
  } catch (error) {
    console.log("🤔 ~ enqueueDigest ~ falling back to immediate send:", error);
    try {
      const redis = await getRedis();
      await redis.del(pendingKey(userId, taskId));
    } catch {
    }
    return false;
  }
}

export async function clearDigestWindow(userId: number, taskId: number) {
  try {
    const redis = await getRedis();
    await redis.del(pendingKey(userId, taskId));
  } catch {
  }
}
