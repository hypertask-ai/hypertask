import type { NextApiRequest, NextApiResponse } from "next";
import { withQstashSignature } from "@/lib/qstash";
import { generateAndStoreCommentSummary } from "@/app/api/ai/_lib/commentSummaries";
import type { IReq } from "./generateCommentSummary";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const job = req.body as IReq;
    console.log("🤔 ~ executing job:", job);

    const result = await generateAndStoreCommentSummary(job.commentId);
    if (!result) {
      console.log("generateAndStoreCommentSummary returned empty");
      return res.status(200).json({ skipped: true });
    }
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.log(
      "🤔 api/queues/FAST/generateCommentSummaryQueue ~ error:",
      error
    );
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
