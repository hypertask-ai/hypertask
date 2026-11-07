import { scheduleJobById } from "@/lib/qstash";
import { skipAutomaticAiForAgentChange } from "@/lib/ai/agentAutomaticAi";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7689_PROMPT_CACHING_FLAG } from "@/lib/flags/definitions/htpr-7689-prompt-caching";
import { HTPR_8904_AGENT_AUTOMATIC_AI_FLAG } from "@/lib/flags/definitions/htpr-8904-agent-automatic-ai";

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

export default async function scheduleTaskSummaryGeneration(req: IReq) {
  const { taskId, agentId } = req;
  if (typeof agentId === "string" && agentId.length > 0 && skipAutomaticAiForAgentChange(agentId, await isFeatureEnabled(HTPR_8904_AGENT_AUTOMATIC_AI_FLAG, req.ownerUserId ?? 0).catch(() => false))) return;
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
