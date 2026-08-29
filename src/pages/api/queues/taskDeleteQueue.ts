import { claimAndInvokeTaskDelete } from "@/utils/controllers/tasks/invokeTaskDelete"
import type { NextApiRequest, NextApiResponse } from "next";
import { cancelJobById, scheduleJobById, withQstashSignature } from "@/lib/qstash";

export const TASK_DELETE_QUEUE_PATH = "/api/queues/taskDeleteQueue";

export function buildTaskDeleteJobId(taskId: number) {
  return `delete-task-id:${taskId}`;
}

export async function scheduleTaskDeleteJob(payload: string, taskId: number, runAt: Date) {
  return scheduleJobById({
    jobId: buildTaskDeleteJobId(taskId),
    path: TASK_DELETE_QUEUE_PATH,
    body: payload,
    notBefore: Math.floor(runAt.getTime() / 1000),
  });
}

export async function cancelTaskDeleteJob(taskId: number) {
  return cancelJobById(buildTaskDeleteJobId(taskId), TASK_DELETE_QUEUE_PATH);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
    // This callback has no request user: its QStash signature authenticates the
    // job, and the claim only accepts a due task scheduled by the gated delete path.
    const job = req.body as string;
    console.log("🚀 ~ job:", job)
    // job = 'task-id-119'
    // ================== job execution time *-*, you finally recieve the notification

    try {
      const taskId = parseInt(job.split("-")[2]);
      if (Number.isNaN(taskId)) {
        return res.status(400).json({ ok: false, error: "Malformed task delete payload" });
      }
      const result = await claimAndInvokeTaskDelete(taskId)
      if (result === "error") {
        return res.status(500).json({ ok: false, result });
      }
      return res.status(200).json({ ok: true, result });

    } catch (error) {
       console.log("🚀 ~ error:", error)
       return res.status(500).json({ ok: false });
      
    }
}

export default withQstashSignature(handler);

export const config = {
  api: {
    bodyParser: false,
  },
};
