import { getRedis } from "@/lib/redis";
import { publishJob } from "@/lib/qstash";

export const NOTIFICATION_DIGEST_QUEUE_PATH =
  "/api/queues/notificationDigestQueue";

/**
 * How long we hold events before emailing. Anything the user reads in the app
 * inside this window produces no email at all.
 */
export function digestWindowSeconds(): number {
  const raw = Number(process.env.NOTIFICATION_DIGEST_DELAY_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 300;
}

// Outlives the window so a pending job's key cannot expire before the job runs.
// Without the buffer a late-firing job and a fresh event could both claim the
// same events and send two emails for them.
const pendingTtlSeconds = () => digestWindowSeconds() + 120;

/**
 * Backdates the window start. Senders create the Notification row before calling
 * the email helper, so an exact `now` would exclude the very event that opened
 * the window.
 *
 * The backdate alone is not enough to prevent a re-send: an event arriving late
 * in one window is inside the *next* window's backdated start too. `lastDigestedAt`
 * below is what actually bounds that.
 */
const graceSeconds = () => Math.min(120, Math.floor(digestWindowSeconds() / 2));

const pendingKey = (userId: number, taskId: number) =>
  `notif:digest:pending:${userId}:${taskId}`;

// Watermark of the newest event already emailed for this pair. Rows are never
// mutated when mailed, so without this the next window would re-send anything
// that arrived within `grace` of the previous window closing, and a QStash
// redelivery would re-send the whole batch.
const lastDigestedKey = (userId: number, taskId: number) =>
  `notif:digest:last:${userId}:${taskId}`;

// Comfortably longer than any window so the watermark outlives the gap between
// consecutive digests on the same task.
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
    // Losing the watermark risks a duplicate, never a dropped email.
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
    // Same tradeoff as above.
  }
}

export interface DigestJobBody {
  userId: number;
  taskId: number;
  /** ISO timestamp; bounds the digest to this window's events. */
  since: string;
}

/**
 * The single email this window replaced, kept so it can still be sent if the
 * digest finds no Notification rows at all.
 *
 * Email used to be independent of the notification insert. The digest makes it
 * depend on it, so a swallowed insert error (checkReminderAndCreateNotification
 * catches and returns undefined) would turn one lost inbox row into a lost
 * email too. This is the redundancy that restores.
 */
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

/**
 * Opens a digest window for this user+task, or joins one already open.
 *
 * Returns true when the event is covered by a digest and the caller must NOT
 * send its own email. Returns false when anything went wrong, so the caller
 * falls back to sending immediately: a duplicate-looking instant email is a far
 * better failure than a silently dropped notification.
 */
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

    // Someone already opened the window. The notification row this event just
    // created is what the pending job reads, so there is nothing more to do.
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

    // Retried once because a concurrent event that saw this claim has already
    // suppressed its own email and is relying on this job existing. It cannot be
    // told to fall back, so the publish is worth a second attempt.
    try {
      await publishJob(job);
    } catch {
      await publishJob(job);
    }

    return true;
  } catch (error) {
    console.log("🤔 ~ enqueueDigest ~ falling back to immediate send:", error);
    // Drop the claim so the next event can open a fresh window instead of
    // waiting out the TTL against a job that was never published.
    try {
      const redis = await getRedis();
      await redis.del(pendingKey(userId, taskId));
    } catch {
      // TTL will clear it.
    }
    return false;
  }
}

/** Closes the window so the next event opens a new one. */
export async function clearDigestWindow(userId: number, taskId: number) {
  try {
    const redis = await getRedis();
    await redis.del(pendingKey(userId, taskId));
  } catch {
    // TTL will clear it.
  }
}
