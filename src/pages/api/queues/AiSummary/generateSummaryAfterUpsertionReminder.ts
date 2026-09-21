// pages/api/setupReminder.js
// id:`notifications-for-task-${taskId}`
import { scheduleJobById } from "@/lib/qstash";

const QUEUE_PATH = "/api/queues/AiSummary/generateSummaryAfterUpsertionQueue";

function buildJobId(teamId: string) {
  return "generateBatchSummaries-ai-for-teamId: " + teamId;
}

export default  async function generateSummaryAfterUpsertionReminder(
  teamId: string,
) {
    const runAt = new Date(new Date().getTime() + 2 * 60000);

    const res = await scheduleJobById({
        jobId: buildJobId(teamId),
        path: QUEUE_PATH,
        body: { teamId },
        notBefore: Math.floor(runAt.getTime() / 1000),
    });

    return res

}
