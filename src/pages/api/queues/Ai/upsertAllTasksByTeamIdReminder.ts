// pages/api/setupReminder.js
// id:`notifications-for-task-${taskId}`
import { scheduleJobById } from "@/lib/qstash";

const QUEUE_PATH = "/api/queues/Ai/upsertAllTasksByTeamIdQueue";

function buildJobId(teamId: string) {
  return "initiate-ai-for-teamId: " + teamId;
}

export default  async function upsertAllTasksByTeamIdReminder(
  req:{body:{teamId:string}}
) {
    const {teamId} = req.body
    const runAt = new Date(new Date().getTime() + 1 * 60000);

    const res = await scheduleJobById({
        jobId: buildJobId(teamId),
        path: QUEUE_PATH,
        body: { teamId },
        notBefore: Math.floor(runAt.getTime() / 1000),
    });

    return res

}
