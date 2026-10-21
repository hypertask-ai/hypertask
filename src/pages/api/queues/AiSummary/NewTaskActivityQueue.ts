import type { NextApiRequest, NextApiResponse } from "next";
import { withQstashSignature } from "@/lib/qstash";
import {
  generateAndStoreTaskSummary,
  SummaryRetryableError,
} from "@/app/api/ai/_lib/taskSummaries"
import { commentIdsKey } from "./NewTaskActivityReminder"
import type { IReq } from "./NewTaskActivityReminder"
import { getRedis } from "@/lib/redis";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const job = req.body as IReq;
    console.log("🚀 ~ executing job:", job)

    const result = await generateAndStoreTaskSummary(job.taskId);
    if (!result) {
      console.log("generateAndStoreTaskSummary returned empty");
      return res.status(200).json({ skipped: true });
    }

    if (job.listOfCommentsToUpsertById?.length) {
      try {
        const redis = await getRedis();
        await redis.srem(
          commentIdsKey(job.taskId),
          ...job.listOfCommentsToUpsertById.map(String)
        );
      } catch (e) {
        console.log("🚀 ~ NewTaskActivityQueue ~ srem commentIds error:", e);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.log("🚀 ~ error:", error)
    if (error instanceof SummaryRetryableError) {
      return res.status(503).json({ ok: false, retry: true });
    }
    return res.status(200).json({ ok: false });
  }
}

export default withQstashSignature(handler);

export const config = {
  api: {
    bodyParser: false,
  },
};
