import type { NextApiRequest, NextApiResponse } from "next";
import { cancelJobById, scheduleJobById } from "@/lib/qstash";
import { withQstashSignature } from "@/lib/qstash";
import invokeDueDate from "@/utils/controllers/tasks/invokeDueDate";

export const DUE_DATE_QUEUE_PATH = "/api/queues/duedateQueue";

export function buildDueDateJobId(taskId: number, projectId: number) {
  return `duedate-for-task-${taskId}-${projectId}`;
}

export async function scheduleDueDateJob(payload: {
  taskId: number;
  projectId: number;
}, runAt: Date) {
  return scheduleJobById({
    jobId: buildDueDateJobId(payload.taskId, payload.projectId),
    path: DUE_DATE_QUEUE_PATH,
    body: payload,
    notBefore: Math.floor(runAt.getTime() / 1000),
  });
}

export async function cancelDueDateJob(taskId: number, projectId: number) {
  return cancelJobById(buildDueDateJobId(taskId, projectId), DUE_DATE_QUEUE_PATH);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const job = req.body as any;
  console.log("🚀 ~ job:", job);

  try {
    const result = await invokeDueDate(job);
    return res.status(200).json({ ok: true, result });
  } catch (error) {
    console.log("🚀 ~ error:", error);
    return res.status(500).json({ ok: false });
  }
}

export default withQstashSignature(handler);

export const config = {
  api: {
    bodyParser: false,
  },
};
