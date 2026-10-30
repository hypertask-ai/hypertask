import { includeSavedContentComment } from "@/utils/controllers/savedContent/helper";
import { withTaskStarWriteLock } from "@/lib/taskCardActions/writeLocks";

export async function toggleSavedContent({ userId, taskId, projectId, commentId, type, alwaysRemove }: {
  userId: number;
  taskId: number;
  projectId: number;
  commentId: number | null;
  type: "Private" | "Public";
  alwaysRemove?: boolean;
}) {
  const isPrivateTaskStar = type === "Private" && commentId === null;
  const whereClause = {
    ...(isPrivateTaskStar ? {} : { projectId }),
    taskId,
    type,
    commentId,
    ...(type === "Private" ? { userId } : {}),
  };

  return withTaskStarWriteLock(taskId, async (tx) => {
    const checkSave = await tx.savedContent.findFirst({ where: whereClause });
    if (checkSave) {
      await tx.savedContent.deleteMany({ where: whereClause });
      return { status: 201 as const };
    }
    if (alwaysRemove === true) return { status: 201 as const };

    const saved = await tx.savedContent.create({
      data: { userId, taskId, projectId, commentId, type },
      include: {
        task: includeSavedContentComment(userId, !isPrivateTaskStar),
        comment: { include: { creator: true } },
      },
    });
    return { status: 200 as const, saved };
  });
}
