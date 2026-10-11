import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { updateCommentService } from "@/utils/controllers/comments/updateCommentService";
import { broadcastTaskComment } from "@/lib/realtime/server";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "PUT") {
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>)
    );
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = session.userId;
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ message: "Invalid request body" });
    }
    const updatedComment = req.body;
    const {
      text,
      creatorId,
      taskId,
      commentId,
      attachments,
      replaceAttachments,
    } = updatedComment;

    if (!text || !creatorId || !taskId || !commentId) {
      return res.status(400).json({ message: "Missing Required Data" });
    }
    if (
      replaceAttachments !== undefined &&
      typeof replaceAttachments !== "boolean"
    ) {
      return res.status(400).json({ message: "Invalid attachment replacement flag" });
    }
    if (replaceAttachments === true && attachments === undefined) {
      return res.status(400).json({
        message: "Attachments are required when replacing attachments",
      });
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

    if (creatorId !== userId) {
      return res.status(403).json({ message: "Not the comment owner" });
    }

    try {
      const toUpdate = await updateCommentService({
        commentId,
        text,
        userId,
        attachments,
        replaceAttachments,
      });

      void broadcastTaskComment(toUpdate.taskId, { originUserId: userId }).catch(
        (broadcastError) =>
          console.warn("Comment update broadcast failed", broadcastError),
      );

      return res.status(200).json(toUpdate);
    } catch (error) {
      console.error("Error:", error);
      if (error instanceof Error && error.message === "Comment not found or not owned by user") {
        return res.status(404).json({ message: "Comment not found" });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
};

export default handler;
