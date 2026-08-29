import { scheduleJobById } from "@/lib/qstash";

export interface IReq {
  commentId: number;
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
  // Debounce ~5 min after the last activity; scheduleJobById cancels and replaces
  // any still-pending summary job for this comment.
  const runAt = new Date(new Date().getTime() + 5 * 60000);

  const res = await scheduleJobById({
    jobId: buildJobId(commentId),
    path: QUEUE_PATH,
    body: { commentId },
    notBefore: Math.floor(runAt.getTime() / 1000),
  });

  return res;
}
