import type { NextApiRequest, NextApiResponse } from "next";
import { withQstashSignature } from "@/lib/qstash";
import {
  generateAndStoreTaskSummary,
  SummaryRetryableError,
} from "@/app/api/ai/_lib/taskSummaries";
import type { IReq } from "./generateSummary";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const job = req.body as IReq;
    console.log("🤔 ~ executing job:", job);

    const result = await generateAndStoreTaskSummary(job.taskId, {
      agentId: job.agentId,
    });
    if (!result) {
      console.log("generateAndStoreTaskSummary returned empty");
      return res.status(200).json({ skipped: true });
    }
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.log("🤔 api/queues/FAST/generateSummaryQueue ~ error:", error);
    if (error instanceof SummaryRetryableError) {
      return res.status(503).json({ ok: false, retry: true });
    }
    // Return 200 so QStash does not retry an error we have already handled/logged.
    return res.status(200).json({ ok: false });
  }
}

export default withQstashSignature(handler);

export const config = {
  api: {
    bodyParser: false,
  },
};
