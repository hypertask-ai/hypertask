import type { NextApiRequest, NextApiResponse } from "next";
import { sendAgentNudgeEmail } from "@/lib/onboarding/emails/agentNudge";
import { withQstashSignature } from "@/lib/qstash";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const userId = req.body?.userId;
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: "Invalid userId" });
  }
  try {
    const reason = await sendAgentNudgeEmail(userId);
    if (reason === "already_claimed") {
      return res.status(503).json({ ok: false, sent: false, reason });
    }
    return res.status(200).json({ ok: true, sent: reason === "sent", reason });
  } catch (error) {
    console.error("[queues/agent-nudge-email] failed", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

export default withQstashSignature(handler);

export const config = { api: { bodyParser: false } };
