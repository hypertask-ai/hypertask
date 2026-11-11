import { scheduleJobById } from "@/lib/qstash";
import { getRedis } from "@/lib/redis";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7848_SUMMARY_ON_VIEW_FLAG } from "@/lib/flags/definitions/htpr-7848-summary-on-view";

const SUMMARY_QUEUE_PATH = "/api/queues/FAST/generateSummaryQueue";
const VIEW_REFRESH_LOCK_SECONDS = 60;
const VIEW_REFRESH_DELAY_SECONDS = 5;

const staleMarkerKey = (taskId: number) => `ai-summary:stale:${taskId}`;
const viewRefreshLockKey = (taskId: number) => `ai-summary:view-refresh:${taskId}`;
const viewRefreshJobId = (taskId: number) => `ai-summary-view-for-taskId:${taskId}`;

export type SummaryOnViewDecision = "off" | "fresh" | "coalesced" | "scheduled" | "unavailable";

export async function taskSummaryOnViewEnabled(userId: number | null | undefined) {
  if (!userId) return false;
  try {
    if (await isFeatureEnabled(HTPR_7848_SUMMARY_ON_VIEW_FLAG, userId)) return true;
    return false;
  } catch (error) {
    console.error("[taskSummaries] Summary-on-view switch lookup failed; keeping scheduled runs", error);
    return false;
  }
}

export async function markTaskSummaryStale(taskId: number): Promise<boolean> {
  try {
    const redis = await getRedis();
    const version = await redis.incr(staleMarkerKey(taskId));
    return Number.isFinite(version);
  } catch (error) {
    console.error("[taskSummaries] Could not mark summary out of date for task", taskId, error);
    return false;
  }
}

export async function markTaskSummariesStale(taskIds: number[]): Promise<number> {
  if (taskIds.length === 0) return 0;
  try {
    const redis = await getRedis();
    const pipeline = redis.pipeline();
    for (const taskId of taskIds) pipeline.incr(staleMarkerKey(taskId));
    const results = await pipeline.exec();
    return results?.filter(([error, value]) => !error && value).length ?? 0;
  } catch (error) {
    console.error("[taskSummaries] Could not mark summaries out of date for tasks", taskIds.length, error);
    return 0;
  }
}

export async function readTaskSummaryStaleMarker(
  taskId: number,
): Promise<string | null> {
  try {
    const redis = await getRedis();
    return await redis.get(staleMarkerKey(taskId));
  } catch (error) {
    console.error("[taskSummaries] Could not read the out-of-date mark for task", taskId, error);
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
    console.error("[taskSummaries] Could not clear the out-of-date mark for task", taskId, error);
  }
}

export async function requestTaskSummaryRefreshOnView(args: {
  taskId: number;
  ownerUserId?: number | null;
}): Promise<SummaryOnViewDecision> {
  if (!(await taskSummaryOnViewEnabled(args.ownerUserId))) return "off";
  if (!(await readTaskSummaryStaleMarker(args.taskId))) return "fresh";

  const redis = await getRedis().catch((error) => {
    console.error("[taskSummaries] Could not refresh summary on view for task", args.taskId, error);
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
    console.error("[taskSummaries] Could not refresh summary on view for task", args.taskId, error);
    return "unavailable";
  }
}
