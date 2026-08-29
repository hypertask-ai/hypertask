import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { IUser } from "@/models/model";
import { includeSavedContentComment } from "@/utils/controllers/savedContent/helper";
import { withTaskStarWriteLock } from "@/lib/taskCardActions/writeLocks";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  try {
    const user: IUser = JSON.parse(req.cookies.nookies_user!);
    const { taskId, commentId, type, projectId, alwaysRemove } = req.body;
    if (!taskId || !projectId || !user) {
      return res.status(400).json({ message: "Missing required information" });
    }

    const isPrivateTaskStar = type === "Private" && !commentId;
    const whereClause = {
      ...(isPrivateTaskStar ? {} : { projectId }),
      taskId,
      type,
      ...(type === "Private"
        ? {
            userId: user.id,
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
          userId: user.id,
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
            user.id,
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
