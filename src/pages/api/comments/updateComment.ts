import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { updateCommentService } from "@/utils/controllers/comments/updateCommentService";
import { broadcastTaskComment } from "@/lib/realtime/server";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "PUT") {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ message: "Invalid request body" });
    }
    const updatedComment = req.body;
    const { text, creatorId, taskId, commentId, attachments } = updatedComment;

    if (!text || !creatorId || !taskId || !commentId) {
      return res.status(400).json({ message: "Missing Required Data" });
    }
    if (
      attachments !== undefined &&
      (!Array.isArray(attachments) ||
        attachments.some(
          (attachment) =>
            typeof attachment?.fileType !== "string" ||
            typeof attachment?.fileSource !== "string" ||
            typeof attachment?.fileName !== "string" ||
            (attachment.fileSize !== undefined &&
              attachment.fileSize !== null &&
              typeof attachment.fileSize !== "string"),
        ))
    ) {
      return res.status(400).json({ message: "Invalid attachments" });
    }

    const userObj = JSON.parse(req.cookies.nookies_user!);
    if (creatorId !== userObj.id) {
      return res.status(403).json({ message: "Not the comment owner" });
    }

    try {
      const toUpdate = await updateCommentService({
        commentId,
        text,
        userId: userObj.id,
        attachments,
      });

      void broadcastTaskComment(toUpdate.taskId, { originUserId: userObj.id }).catch(
        (broadcastError) =>
          console.warn("Comment update broadcast failed", broadcastError),
      );

      return res.status(200).json(toUpdate);
    } catch (error) {
      console.error("Error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
};

export default handler;
