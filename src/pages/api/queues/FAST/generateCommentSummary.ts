import { scheduleJobById } from "@/lib/qstash";
import { skipAutomaticAiForAgentChange } from "@/lib/ai/agentAutomaticAi";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_8904_AGENT_AUTOMATIC_AI_FLAG } from "@/lib/flags/definitions/htpr-8904-agent-automatic-ai";

export interface IReq {
  commentId: number;
  agentId?: string | null;
  ownerUserId?: number | null;
}

export interface IJobPayload {
  runAt: Date;
  body: IReq;
}

const QUEUE_PATH = "/api/queues/FAST/generateCommentSummaryQueue";

function buildJobId(commentId: number) {
  return "ai-summary-for-commentId:" + commentId;
}

export default async function scheduleCommentSummaryGeneration(req: IReq) {
  const { commentId } = req;
  if (typeof req.agentId === "string" && req.agentId.length > 0 && skipAutomaticAiForAgentChange(req.agentId, await isFeatureEnabled(HTPR_8904_AGENT_AUTOMATIC_AI_FLAG, req.ownerUserId ?? 0).catch(() => false))) return;
  const runAt = new Date(new Date().getTime() + 5 * 60000);

  const res = await scheduleJobById({
    jobId: buildJobId(commentId),
    path: QUEUE_PATH,
    body: { commentId },
    notBefore: Math.floor(runAt.getTime() / 1000),
  });

  return res;
}
