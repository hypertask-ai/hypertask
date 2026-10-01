import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { includeSavedContentComment } from "@/utils/controllers/savedContent/helper";
import { withTaskStarWriteLock } from "@/lib/taskCardActions/writeLocks";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  try {
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>)
    );
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = session.userId;
    const { taskId, commentId, type, projectId, alwaysRemove } = req.body;
    if (!taskId || !projectId) {
      return res.status(400).json({ message: "Missing required information" });
    }

    const isPrivateTaskStar = type === "Private" && !commentId;
    const whereClause = {
      ...(isPrivateTaskStar ? {} : { projectId }),
      taskId,
      type,
      ...(type === "Private"
        ? {
            userId: userId,
            commentId: commentId ? parseInt(commentId as string) : null,
          }
        : {
            commentId: parseInt(commentId as string),
          }),
    };

    const result = await withTaskStarWriteLock(taskId, async (tx) => {
      const checkSave = await tx.savedContent.findFirst({ where: whereClause });

      if (checkSave) {
        await tx.savedContent.deleteMany({ where: whereClause });
        return { status: 201 as const };
      }
      if (alwaysRemove === true) return { status: 201 as const };

      const saved = await tx.savedContent.create({
        data: {
          userId: userId,
          taskId,
          projectId,
          commentId:
            type === "Private" && !commentId
              ? null
              : parseInt(commentId as string),
          type,
        },
        include: {
          task: includeSavedContentComment(
            userId,
            !!!(type === "Private" && !commentId)
          ),
          comment: {
            include: {
              creator: true,
            },
          },
        },
      });
      return { status: 200 as const, saved };
    });
    return result.status === 200
      ? res.status(200).json({ saved: result.saved })
      : res.status(201).json({});
  } catch (error) {
    console.log("🚀 ~ error:", error);
    return res.status(400).json({ message: JSON.stringify(error) });
  }
};

export default handler;
