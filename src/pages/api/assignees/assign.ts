import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import assigneesAssign, {
  type AssigneeIntent,
} from "@/utils/controllers/assignees/assign";
import prisma from "@/lib/prisma";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import type { IUser } from "@/models/model";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }
  try {
    const { userId, taskId, mode, userIds, agentId, intent } = req.body;
    // HTPR-5090: an agent request carries no userId, and it does not need to.
    // The board payload selects only { id, displayName, photoURL } for an
    // assignee's agent, so the modal has no userId to send for an agent that
    // is ALREADY assigned, and every removal 400'd here. Assigning worked
    // because an unassigned agent comes from boardAgents, which is the full
    // row. assigneesAssign resolves the agent's own userId from agentId, so
    // requiring it from the caller was never load-bearing.
    if ((!userId && !agentId) || !taskId)
      return res.status(400).json({ message: "Bad request" });
    if (
      intent !== undefined &&
      !(["assign", "unassign", "toggle"] as const).includes(intent)
    ) {
      return res.status(400).json({ message: "Invalid assignee intent" });
    }

    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>)
    );
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, email: true, displayName: true, photoURL: true },
    });
    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const currentUser = user as IUser;
    const task = await prisma.task.findFirst({
      where: {
        id: Number(taskId),
        status: { not: "Deleted" },
        project: getProjectWhere(currentUser.id),
      },
      select: { projectId: true },
    });
    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }

    if (mode && mode === "multiple" && userIds.length > 0) {
      // Map through the array and create a promise for each async function call
      const assignTasks = userIds.map((userId_: number) =>
        assigneesAssign(currentUser, userId_, taskId, agentId)
      );
      await Promise.all(assignTasks);
      void broadcastBoardChange(task?.projectId, { originUserId: currentUser.id });
      return res.status(200).json({ message: "Success" });
    } else if (mode && !userIds) {
      return res.status(400).json({
        message: "Please provide userIds when assign mode is set to multiple",
      });
    } else {
      const response = await assigneesAssign(
        currentUser,
        userId,
        taskId,
        agentId,
        undefined,
        intent ? { intent: intent as AssigneeIntent } : undefined
      );
      if (response.status === 200) {
        void broadcastBoardChange(task?.projectId, { originUserId: currentUser.id });
      }
      return res.status(response.status).json(response.json);
    }
  } catch (error) {
    console.error("🚀 ~ handler /api/assignees/assign ~ error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export default handler;
