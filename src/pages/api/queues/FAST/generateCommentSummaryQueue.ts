import { logger as htLogger } from "#logger";
import { withoutAuth } from "#with-auth";
import type { NextApiRequest, NextApiResponse } from "next";
import { withQstashSignature } from "@/lib/qstash";
import { generateAndStoreCommentSummary } from "@/app/api/ai/_lib/commentSummaries";
import type { IReq } from "./generateCommentSummary";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const job = req.body as IReq;
    htLogger.info("🤔 ~ executing job:", job);

    const result = await generateAndStoreCommentSummary(job.commentId);
    if (!result) {
      htLogger.info("generateAndStoreCommentSummary returned empty");
      return res.status(200).json({ skipped: true });
    }
    return res.status(200).json({ ok: true });
  } catch (error) {
    htLogger.info(
      "🤔 api/queues/FAST/generateCommentSummaryQueue ~ error:",
      error
    );
    // Return 200 so QStash does not retry an error we have already handled/logged.
    return res.status(200).json({ ok: false });
  }
}

export default withoutAuth(withQstashSignature(handler));

export const config = {
  api: {
    bodyParser: false,
  },
};
