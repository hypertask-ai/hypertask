import { withAgentScopeRequest } from "@/lib/auth/agentScope";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { getDesktopCliTokenUser, logDesktopCliAuthorization } from "@/lib/auth/desktopCliTokenUser";
import { getSessionUser, type SessionUser } from "@/lib/auth/getSessionUser";
import prisma from "@/lib/prisma";
import { toggleSavedContent } from "@/utils/controllers/savedContent/toggleSavedContent";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  let session: SessionUser | null = null;
  try {
    const headers = new Headers(req.headers as Record<string, string>);
    session = (await getSessionUser(headers)) ??
      (req.method === "POST" && req.body?.commentId != null && req.body.commentId !== ""
        ? await getDesktopCliTokenUser(headers, "comment-star-pin")
        : null);
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

    const result = await toggleSavedContent({ userId, agentId: commentId === null ? null : session.agentId ?? null, taskId, projectId, commentId, type, alwaysRemove });
    return result.status === 200
      ? res.status(200).json({ saved: result.saved })
      : res.status(201).json({});
  } catch (error) {
    console.log("🚀 ~ error:", error);
    return res.status(400).json({ message: JSON.stringify(error) });
  } finally {
    logDesktopCliAuthorization(session, "comment-star-pin", res.statusCode);
  }
};

export default ((req, res) => withAgentScopeRequest(req, () => handler(req, res))) satisfies NextApiHandler;
