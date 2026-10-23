import { withAgentScopeRequest } from "@/lib/auth/agentScope";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { includeSavedContentComment } from "@/utils/controllers/savedContent/helper";
import { withTaskStarWriteLock } from "@/lib/taskCardActions/writeLocks";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import prisma from "@/lib/prisma";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

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
    const { type, alwaysRemove } = req.body;
    const requestedTaskId = Number(req.body.taskId);
    const commentId =
      req.body.commentId == null || req.body.commentId === ""
        ? null
        : Number(req.body.commentId);
    if (
      !Number.isSafeInteger(requestedTaskId) ||
      requestedTaskId <= 0 ||
      (commentId !== null &&
        (!Number.isSafeInteger(commentId) || commentId <= 0)) ||
      (type !== "Private" && type !== "Public") ||
      (type === "Public" && commentId === null)
    ) {
      return res.status(400).json({ message: "Missing required information" });
    }

    const task = await prisma.task.findFirst({
      where: {
        id: requestedTaskId,
        project: projectContentAccessWhere(userId, session.agentId, session.teamScope),
        AND: [{ project: projectContentAccessWhere(userId) }],
      },
      select: { id: true, projectId: true },
    });
    const comment =
      task && commentId !== null
        ? await prisma.comment.findFirst({
            where: {
              id: commentId,
              taskId: task.id,
              task: { project: projectContentAccessWhere(userId, session.agentId, session.teamScope) },
            },
            select: { id: true },
          })
        : null;
    if (!task || (commentId !== null && !comment)) {
      return res.status(404).json({ message: "Not found" });
    }
    const taskId = task.id;
    const projectId = task.projectId;

    const isPrivateTaskStar = type === "Private" && commentId === null;
    const whereClause = {
      ...(isPrivateTaskStar ? {} : { projectId }),
      taskId,
      type,
      commentId,
      ...(type === "Private" ? { userId } : {}),
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
          commentId,
          type,
        },
        include: {
          task: includeSavedContentComment(userId, !isPrivateTaskStar),
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

export default ((req, res) => withAgentScopeRequest(req, () => handler(req, res))) satisfies NextApiHandler;
