import { scheduleJobById } from "@/lib/qstash";

export interface IReq {
  taskId: number;
  agentId?: string | null;
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
  // Debounce ~5 min after the last activity; scheduleJobById cancels and replaces
  // any still-pending summary job for this task.
  const runAt = new Date(new Date().getTime() + 5 * 60000);

  const res = await scheduleJobById({
    jobId: buildJobId(taskId),
    path: QUEUE_PATH,
    // Omitted means the worker should fall back to the task's creator agent.
    // Explicit null means the triggering actor was human.
    body: agentId === undefined ? { taskId } : { taskId, agentId },
    notBefore: Math.floor(runAt.getTime() / 1000),
  });

  return res;
}
