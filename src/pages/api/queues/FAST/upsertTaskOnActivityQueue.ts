import type { NextApiRequest, NextApiResponse } from "next";
import { withQstashSignature } from "@/lib/qstash";
import type { IReq } from "./generateSummary";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const job = req.body as IReq;
    console.log("🤔 ~ executing job:", job);
    console.log("Pinecone task upsertion is retired; skipping.");
    return res.status(200).json({ skipped: true });
  } catch (error) {
    console.log("🤔 api/queues/FAST/upsertTaskOnActivityQueue ~ error:", error);
    // 200 so QStash does not retry an error we have already handled/logged.
    return res.status(200).json({ ok: false });
  }
}

export default withQstashSignature(handler);

export const config = {
  api: {
    bodyParser: false,
  },
};
