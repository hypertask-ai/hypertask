import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { deleteCommentService } from "@/utils/controllers/comments/deleteCommentService";
import prisma from "@/lib/prisma";
import { broadcastTaskComment } from "@/lib/realtime/server";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "POST") {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ message: "Missing Required Data" });
    }

    const userid = JSON.parse(req.cookies?.nookies_user!);
    if (!userid?.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const comment = await prisma.comment.findUnique({
        where: { id },
        select: { taskId: true },
      });

      await deleteCommentService({
        commentId: id
      });

      void broadcastTaskComment(comment?.taskId, { originUserId: userid.id });

      return res.status(200).json({ message: "Comment deleted" });
    } catch (error) {
      console.error("Error:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      if (message.includes("not found") || message.includes("cannot be deleted")) {
        return res.status(404).json({ message: "You can't delete this comment" });
      }
      return res.status(500).json({ message: "Internal server error" });
    }
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
};

export default handler;
