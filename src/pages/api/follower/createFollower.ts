import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { createFollowerService } from "@/utils/controllers/followers/createFollowerService";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse,
) => {
  if (req.method === "POST") {
    const session = verifySession(req.cookies[SESSION_COOKIE]);
    if (!session) {
      return res
        .status(401)
        .json({ error: "Unauthorized", code: "SESSION_REQUIRED" });
    }

    const { taskId, mentionById, agentId, commentId, fromAgentId } = req.body;
    const result = await createFollowerService({
      userId: session.id,
      taskId,
      mentionById,
      agentId,
      commentId,
      fromAgentId,
    });
    return res.status(result.status).json(result.body);
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
};

export default handler;
