import { scheduleJobById } from "@/lib/qstash";

export interface IReq {
  taskId: number;
  agentId?: string | null;
  activityOnly?: boolean;
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
  if (req.activityOnly) {
    const [{ default: prisma }, { isFeatureEnabled }, { HTPR_7689_PROMPT_CACHING_FLAG }] = await Promise.all([
      import("@/lib/prisma"),
      import("@/lib/flags"),
      import("@/lib/flags/definitions/htpr-7689-prompt-caching"),
    ]);
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { userId: true },
    });
    if (task && await isFeatureEnabled(HTPR_7689_PROMPT_CACHING_FLAG, task.userId)) return;
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
