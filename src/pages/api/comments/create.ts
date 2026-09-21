import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { createCommentService } from "@/utils/controllers/comments/createCommentService";
import { broadcastTaskComment } from "@/lib/realtime/server";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "POST") {
    try {
      const { text, creatorId, taskId, ownerId, agentId } = req.body;
      let currentUser;
      if (req.cookies.nookies_user) {
        try {
          currentUser = JSON.parse(req.cookies.nookies_user);
        } catch (parseError) {
          console.error("Error parsing nookies_user cookie:", parseError);
          currentUser = undefined;
        }
      }

      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      if (Number(creatorId) !== Number(currentUser.id)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      if (!text || !creatorId || !taskId || !ownerId)
        return res.status(400).json({ message: "Bad request" });

      const comment = await createCommentService({
        text,
        creatorId,
        taskId,
        ownerId,
        currentUser,
        agentId,
      });

      void broadcastTaskComment(taskId, { originUserId: creatorId });

      return res.json(comment);
    } catch (error) {
      console.log("🤔 ~ ERROR IN COMMENT CREATION:", error);
      if (error instanceof Error && error.message === "Task not found or access denied") {
        return res.status(404).json({ message: error.message });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
};

export default handler;
