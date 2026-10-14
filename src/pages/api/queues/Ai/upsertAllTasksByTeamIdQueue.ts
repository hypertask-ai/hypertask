import type { NextApiRequest, NextApiResponse } from "next";
import { withQstashSignature } from "@/lib/qstash";
import { upsertTasksByTeamIdHandler } from "./upsertAllTasksByTeamIdInvoke"

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const job = req.body as { teamId: string };
    console.log("🚀 ~ executing job:", job)

    if (await upsertTasksByTeamIdHandler(job.teamId) === "Success") {
      return res.status(200).json({ ok: true });
    }
    else {
      throw "Error"
    }
  } catch (error) {
    console.log("🚀 ~ error:", error)
    return res.status(200).json({ ok: false });
  }
}

export default withQstashSignature(handler);

export const config = {
  api: {
    bodyParser: false,
  },
};
