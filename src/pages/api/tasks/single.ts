import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import {
  deleteTaskSingle,
  getTaskSingle,
  updateTaskSingle,
} from "@/utils/controllers/tasks/single";
import {
  broadcastBoardChange,
  broadcastTaskChange,
} from "@/lib/realtime/server";
import prisma from "@/lib/prisma";
import { extractTaskReferencesFromCommentText } from "@/utils/controllers/comments/extractTaskReferences";
import { addRelatedTasks } from "@/utils/controllers/tasks/addRelatedTasks";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { IUser } from "@/models/model";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

const readUserIdFromCookie = (req: NextApiRequest): number | null => {
  try {
    const id = JSON.parse(req.cookies.nookies_user ?? "null")?.id;
    return typeof id === "number" ? id : null;
  } catch {
    return null;
  }
};

const userCanAccessProject = async (
  userId: number,
  projectId: number,
  agentId?: string | null,
) => {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      ...taskWriteAccessWhere(userId, agentId),
    },
    select: { id: true },
  });
  return !!project;
};

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse,
) => {
  if (req.method === "GET") {
    try {
      const { id } = req.query;
      if (!id) {
        return res.status(400).json({ message: "Task id is required" });
      }
      // GET returns the task body, so it must be gated on board access
      const currentUserId = readUserIdFromCookie(req);
      if (!currentUserId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const response = await getTaskSingle(parseInt(id as string));
      const task = response.json as { projectId?: number } | null;
      if (
        response.status === 200 &&
        task?.projectId &&
        !(await userCanAccessProject(currentUserId, task.projectId))
      ) {
        return res.status(403).json({ message: "Forbidden" });
      }

      return res.status(response.status).json(response.json);
    } catch (error) {
      console.log({ error });
      return res
        .status(500)
        .json({ message: "Internal server error" + JSON.stringify(error) });
    }
  }
  if (req.method === "PUT") {
    try {
      const { newTask, agentId } = req.body;
      if (!newTask || !newTask.id) {
        return res.status(400).json({ message: "Task id is required" });
      }
      // HTPR-4810: authorize task edits with the signed session and both boards.
      const session = await getSessionUser(
        new Headers(req.headers as Record<string, string>),
      );
      if (!session) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const actingAgentId =
        typeof agentId === "string" && agentId.length > 0 ? agentId : null;
      if (agentId != null && !actingAgentId) {
        return res.status(400).json({ message: "Invalid agent id" });
      }
      const [taskToUpdate, sessionUser, ownedAgent] = await Promise.all([
        prisma.task.findUnique({
          where: { id: newTask.id },
          select: { projectId: true },
        }),
        prisma.user.findUnique({
          where: { id: session.userId },
          // photoURL/email too: the auto-assign path stores this object straight
          // into the activity record, and the feed reads the actor's avatar off
          // it, so a stub would render assignment activities without a face.
          select: { displayName: true, photoURL: true, email: true },
        }),
        actingAgentId
          ? prisma.agent.findFirst({
              where: {
                id: actingAgentId,
                userId: session.userId,
                revokedAt: null,
              },
              select: { id: true },
            })
          : Promise.resolve(null),
      ]);
      // agentId is body-supplied actor identity. Board membership is not proof
      // that this session owns that agent, so validate it independently before
      // the human-access branches in taskWriteAccessWhere can authorize a write.
      if (actingAgentId && !ownedAgent) {
        return res.status(403).json({ message: "Forbidden" });
      }
      if (
        taskToUpdate &&
        !(await userCanAccessProject(
          session.userId,
          taskToUpdate.projectId,
          actingAgentId,
        ))
      ) {
        return res.status(403).json({ message: "Forbidden" });
      }
      if (
        taskToUpdate &&
        newTask.projectId != null &&
        newTask.projectId !== taskToUpdate.projectId &&
        !(await userCanAccessProject(
          session.userId,
          newTask.projectId,
          actingAgentId,
        ))
      ) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const currentUser = {
        id: session.userId,
        displayName: sessionUser?.displayName ?? "",
        photoURL: sessionUser?.photoURL ?? undefined,
        email: sessionUser?.email ?? undefined,
      } as IUser;
      const response = await updateTaskSingle(
        newTask,
        currentUser,
        actingAgentId,
      );
      if (response.status === 200) {
        void broadcastBoardChange(
          (response.json as any)?.projectId ?? newTask?.projectId,
          {
            originUserId: currentUser?.id,
          },
        );
        if (
          newTask?.description !== undefined ||
          newTask?.title !== undefined ||
          newTask?.status !== undefined
        ) {
          try {
            await broadcastTaskChange(
              (response.json as any)?.id ?? newTask?.id,
              {
                originUserId: currentUser?.id,
              },
            );
          } catch (error) {
            console.warn(
              "[tasks/single] task realtime broadcast failed",
              error,
            );
          }
        }

        // HTPR-3916: a ticket mentioned in the DESCRIPTION never became a
        // Related task. Comments have done this since createCommentService,
        // but nothing ever scanned a description, so referencing INNE-418
        // there left the Related tasks panel empty. Same extractor, same
        // addRelatedTasks, so both surfaces behave identically, including the
        // guard that ignores AI-linkified ticket refs.
        if (typeof newTask?.description === "string") {
          const relatedTaskId = (response.json as any)?.id ?? newTask.id;
          void (async () => {
            try {
              const refs = extractTaskReferencesFromCommentText(
                newTask.description,
              );
              if (refs.length === 0) return;
              await addRelatedTasks(
                { relatedTasks: refs, currentTaskId: relatedTaskId },
                currentUser.id,
              );
            } catch (error) {
              // Never fail the save over a relation: the description is the
              // thing the user asked to persist.
              console.warn(
                "[tasks/single] description relations failed:",
                error,
              );
            }
          })();
        }
      }
      return res.status(response.status).json(response.json);
    } catch (error) {
      console.log(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
  if (req.method === "DELETE") {
    try {
      const { id } = req.query;
      if (!id) return res.status(400).json({ message: "Missing ID" });
      const session = await getSessionUser(
        new Headers(req.headers as Record<string, string>),
      );
      if (!session) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const currentUserId = session.userId;
      const taskToDelete = await prisma.task.findUnique({
        where: { id: parseInt(id as string) },
        select: { projectId: true },
      });
      if (
        taskToDelete &&
        !(await userCanAccessProject(currentUserId, taskToDelete.projectId))
      ) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const response = await deleteTaskSingle(
        parseInt(id as string),
        currentUserId,
      );
      return res.status(response.status).json(response.json);
    } catch (error) {
      console.log(error);

      return res.status(500).json({ message: "Internal server error" });
    }
  } else {
    return res.status(405).json({ message: "Method not allowed" });
  }
};

export default handler;
