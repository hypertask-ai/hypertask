import { logger as htLogger } from "#logger";
import { withoutAuth } from "#with-auth";
import type { NextApiRequest, NextApiResponse } from "next";
import { scheduleJobById, withQstashSignature } from "@/lib/qstash";
import { invokeChatSessionExpiry } from "@/utils/controllers/ai-chat/invokeChatSessionExpiry";

interface ChatSessionExpiryJobPayload {
  sessionId: string;
}

export const CHAT_SESSION_EXPIRY_QUEUE_PATH = "/api/queues/chatSessionExpiryQueue";

export async function scheduleChatSessionExpiryJob({
  jobId,
  payload,
  runAt,
}: {
  jobId: string;
  payload: ChatSessionExpiryJobPayload;
  runAt: Date;
}) {
  return scheduleJobById({
    jobId,
    path: CHAT_SESSION_EXPIRY_QUEUE_PATH,
    body: payload,
    notBefore: Math.floor(runAt.getTime() / 1000),
  });
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const job = req.body as ChatSessionExpiryJobPayload;

  try {
    const result = await invokeChatSessionExpiry(job);
    return res.status(200).json({ ok: true, result });
  } catch (error) {
    htLogger.info("🚀 ~ chatSessionExpiryQueue ~ error:", error);
    return res.status(500).json({ ok: false });
  }
}

export default withoutAuth(withQstashSignature(handler));

export const config = {
  api: {
    bodyParser: false,
  },
};
