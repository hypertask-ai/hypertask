import { scheduleJobById } from "@/lib/qstash";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7689_PROMPT_CACHING_FLAG } from "@/lib/flags/definitions/htpr-7689-prompt-caching";

export interface IReq {
  taskId: number;
  agentId?: string | null;
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

export default async function scheduleTaskSummaryGeneration(req: IReq) {
  const { taskId, agentId } = req;
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
