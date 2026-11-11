import { scheduleJobById } from "@/lib/qstash";
import { getRedis } from "@/lib/redis";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7848_SUMMARY_ON_VIEW_FLAG } from "@/lib/flags/definitions/htpr-7848-summary-on-view";

const SUMMARY_QUEUE_PATH = "/api/queues/FAST/generateSummaryQueue";
const STALE_MARKER_TTL_SECONDS = 60 * 60 * 24 * 30;
const VIEW_REFRESH_LOCK_SECONDS = 60;
const VIEW_REFRESH_DELAY_SECONDS = 5;

const staleMarkerKey = (taskId: number) => `ai-summary:stale:${taskId}`;
const viewRefreshLockKey = (taskId: number) => `ai-summary:view-refresh:${taskId}`;
const viewRefreshJobId = (taskId: number) => `ai-summary-view-for-taskId:${taskId}`;

export type SummaryOnViewDecision =
  | "off"
  | "fresh"
  | "coalesced"
  | "scheduled"
  | "unavailable";

export async function taskSummaryOnViewEnabled(
  userId: number | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  try {
    return await isFeatureEnabled(HTPR_7848_SUMMARY_ON_VIEW_FLAG, userId);
  } catch (error) {
    console.error(
      "[taskSummaries] Summary-on-view switch lookup failed; keeping scheduled runs",
      error,
    );
    return false;
  }
}

export async function markTaskSummaryStale(taskId: number): Promise<boolean> {
  try {
    const redis = await getRedis();
    const key = staleMarkerKey(taskId);
    const version = await redis.incr(key);
    await redis.expire(key, STALE_MARKER_TTL_SECONDS);
    return Number.isFinite(version);
  } catch (error) {
    console.error(
      `[taskSummaries] Could not mark task ${taskId} summary out of date`,
      error,
    );
    return false;
  }
}

export async function readTaskSummaryStaleMarker(
  taskId: number,
): Promise<string | null> {
  try {
    const redis = await getRedis();
    return await redis.get(staleMarkerKey(taskId));
  } catch (error) {
    console.error(
      `[taskSummaries] Could not read the out-of-date mark for task ${taskId}`,
      error,
    );
    return null;
  }
}

export async function clearTaskSummaryStaleMarker(
  taskId: number,
  marker: string | null,
): Promise<void> {
  if (!marker) return;
  try {
    const redis = await getRedis();
    await redis.eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then
         return redis.call("del", KEYS[1])
       end
       return 0`,
      1,
      staleMarkerKey(taskId),
      marker,
    );
  } catch (error) {
    console.error(
      `[taskSummaries] Could not clear the out-of-date mark for task ${taskId}`,
      error,
    );
  }
}

export async function requestTaskSummaryRefreshOnView(args: {
  taskId: number;
  ownerUserId?: number | null;
}): Promise<SummaryOnViewDecision> {
  if (!(await taskSummaryOnViewEnabled(args.ownerUserId))) return "off";
  if (!(await readTaskSummaryStaleMarker(args.taskId))) return "fresh";

  const redis = await getRedis().catch((error) => {
    console.error(
      `[taskSummaries] Could not refresh task ${args.taskId} summary on view`,
      error,
    );
    return null;
  });
  if (!redis) return "unavailable";

  try {
    const claimed = await redis.set(
      viewRefreshLockKey(args.taskId),
      "1",
      "EX",
      VIEW_REFRESH_LOCK_SECONDS,
      "NX",
    );
    if (claimed !== "OK") return "coalesced";

    const scheduled = await scheduleJobById({
      jobId: viewRefreshJobId(args.taskId),
      path: SUMMARY_QUEUE_PATH,
      body: { taskId: args.taskId },
      notBefore: Math.floor(Date.now() / 1000) + VIEW_REFRESH_DELAY_SECONDS,
    });
    if (!scheduled) {
      await redis.del(viewRefreshLockKey(args.taskId)).catch(() => undefined);
      return "coalesced";
    }
    return "scheduled";
  } catch (error) {
    await redis.del(viewRefreshLockKey(args.taskId)).catch(() => undefined);
    console.error(
      `[taskSummaries] Could not refresh task ${args.taskId} summary on view`,
      error,
    );
    return "unavailable";
  }
}

export async function shouldPregenerateTeamSummariesOnCheckout(
  billingUserId: number | null | undefined,
): Promise<boolean> {
  return !(await taskSummaryOnViewEnabled(billingUserId));
}
