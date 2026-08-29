import type { NextApiRequest, NextApiResponse } from "next";
import { withQstashSignature } from "@/lib/qstash";
import { upsertTasksByTeamIdHandler } from "./upsertAllTasksByTeamIdInvoke"
// import generateSummaryAfterUpsertionQueue from "../AiSummary/generateSummaryAfterUpsertionQueue"
// import { subMinutes } from "date-fns"
// import generateSummaryAfterUpsertionReminder from "../AiSummary/generateSummaryAfterUpsertionReminder"

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const job = req.body as { teamId: string };
    console.log("🚀 ~ executing job:", job)

    if (await upsertTasksByTeamIdHandler(job.teamId) === "Success") {
      // generateSummaryAfterUpsertionReminder(job.teamId)
      return res.status(200).json({ ok: true });
    }
    else {
      throw "Error"
    }
  } catch (error) {
    console.log("🚀 ~ error:", error)
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
