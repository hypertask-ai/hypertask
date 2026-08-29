import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { ensureTaskMovedToInbox } from "@/lib/taskCardActions/inboxState";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "POST") {
    try {
      // HTPR-4772: ignore the body userId and use the signed session.
      const session = await getSessionUser(
        new Headers(req.headers as Record<string, string>)
      );
      if (!session) return res.status(401).json({ message: "Unauthorized" });

      const { taskId, projectId } = req.body;
      const userId = session.userId;
      if (!taskId || !projectId)
        return res.status(400).json({ message: "Missing required data" });
      const payload = {
        taskId,
        userId,
        projectId,
        type: "TaskMovedToInbox",
        fromUserId: userId,
      };

      await ensureTaskMovedToInbox(
        { userId, projectId, taskId },
        payload,
      );
      return res.status(200).json({ message: "Success" });
    } catch (error) {
      console.log(error);

      return res.status(500).json({ message: "Internal server error" });
    }
  } else {
    return res.status(405).json({ message: "Method not allowed" });
  }
};

export default handler;
