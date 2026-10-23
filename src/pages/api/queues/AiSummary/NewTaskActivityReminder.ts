import { scheduleJobById } from "@/lib/qstash";
import { getRedis } from "@/lib/redis";

export interface IReq{
    taskId:number
    listOfCommentsToUpsertById:number[]
}

const QUEUE_PATH = "/api/queues/AiSummary/NewTaskActivityQueue";

export const commentIdsKey = (taskId: number) =>
    `qstash:commentids:${QUEUE_PATH}:${taskId}`;
const COMMENT_IDS_TTL_SECONDS = 60 * 60 * 24;

function buildJobId (taskId:number){
    return "ai-summary-for-taskId:"+taskId
}

export default  async function NewTaskActivityReminder(
  req: IReq,
) {

    const {taskId, listOfCommentsToUpsertById} =req

    const key = commentIdsKey(taskId);
    const redis = await getRedis();
    if (listOfCommentsToUpsertById.length) {
      await redis.sadd(key, ...listOfCommentsToUpsertById.map(String));
      await redis.expire(key, COMMENT_IDS_TTL_SECONDS);
    }
    const mergedCommentIds = (await redis.smembers(key)).map(Number);

    const runAt = new Date(new Date().getTime() + 2 * 120000);

    const res = await scheduleJobById({
        jobId: buildJobId(taskId),
        path: QUEUE_PATH,
        body: { taskId, listOfCommentsToUpsertById: mergedCommentIds },
        notBefore: Math.floor(runAt.getTime() / 1000),
    });

    return res

}
