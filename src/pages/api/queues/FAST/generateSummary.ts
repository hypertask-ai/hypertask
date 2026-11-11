import { scheduleJobById } from "@/lib/qstash";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7689_PROMPT_CACHING_FLAG } from "@/lib/flags/definitions/htpr-7689-prompt-caching";
import {
  markTaskSummaryStale,
  taskSummaryOnViewEnabled,
} from "@/app/api/ai/_lib/taskSummaryFreshness";

export interface IReq {
  taskId: number;
  agentId?: string | null;
  ownerUserId?: number | null;
  activityOnlyOwnerId?: number | null;
}

export interface IJobPayload {
  runAt: Date;
  body: IReq;
}

const QUEUE_PATH = "/api/queues/FAST/generateSummaryQueue";

function buildJobId(taskId: number) {
  return "ai-summary-for-taskId:" + taskId;
}

function passedOwnerUserId(req: IReq): number | null {
  if (typeof req.ownerUserId === "number") return req.ownerUserId;
  if (typeof req.activityOnlyOwnerId === "number") return req.activityOnlyOwnerId;
  return null;
}

async function summaryOwnerUserId(req: IReq): Promise<number | null> {
  try {
    const { default: prisma } = await import("@/lib/prisma");
    const task = await prisma.task.findUnique({ where: { id: req.taskId }, select: { userId: true } });
    if (typeof task?.userId === "number") return task.userId;
  } catch (error) {
    console.warn("[taskSummaries] Could not read the ticket owner", req.taskId, error);
  }
  return passedOwnerUserId(req);
}

export default async function scheduleTaskSummaryGeneration(req: IReq) {
  const { taskId, agentId } = req;
  if (await taskSummaryOnViewEnabled(await summaryOwnerUserId(req))) {
    if (await markTaskSummaryStale(taskId)) return;
  }
  if (!(typeof agentId === "string" && agentId.length > 0) || !(await isFeatureEnabled("htpr-8904-agent-automatic-ai", req.ownerUserId ?? 0))) {
    if (req.activityOnlyOwnerId) {
      if (await isFeatureEnabled(HTPR_7689_PROMPT_CACHING_FLAG, req.activityOnlyOwnerId)) return;
    }
    const runAt = new Date(new Date().getTime() + 5 * 60000);

    const res = await scheduleJobById({
      jobId: buildJobId(taskId),
      path: QUEUE_PATH,
      body: agentId === undefined ? { taskId } : { taskId, agentId },
      notBefore: Math.floor(runAt.getTime() / 1000),
    });

    return res;
  }
}
