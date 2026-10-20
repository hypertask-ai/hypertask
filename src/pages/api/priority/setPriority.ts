import { withAgentScopeRequest, agentScopeEnforced, recordAgentBoardScopeMiss } from "@/lib/auth/agentScope";
import { resolveActingAgent } from "@/lib/auth/resolveActingAgent";
import { userCanAccessTask } from "@/utils/controllers/tasks/assertTaskAccess";
import prisma from "@/lib/prisma";
import createPriorityActivity from "@/utils/controllers/activities/CreatePriorityActivity";
import { NextApiHandler } from "next";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { loadSessionUserRecord } from "@/lib/auth/sessionUserRecord";
import type { IUser } from "@/models/model";

const handler: NextApiHandler = async (req, res) => {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed" });

  const session = await getSessionUser(
    new Headers(req.headers as Record<string, string>)
  );
  if (!session) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const user = await loadSessionUserRecord(session.userId);

  try {
    const { taskId, priority_index, Priority_Value, agentId: requestedAgentId } = req.body;
    if (!taskId || !Priority_Value)
      return res.status(400).json({ message: "Missing Required Task ID" });

    if (session.agentId && requestedAgentId !== session.agentId) {
      return res.status(403).json({ message: "Agent id must match authenticated session" });
    }
    const actingAgent = resolveActingAgent({ sessionAgentId: session.agentId, bodyAgentId: requestedAgentId });
    if (!actingAgent.ok) return res.status(actingAgent.status).json({ message: actingAgent.message });
    const agentId = actingAgent.agentId;
    if ((!agentId || agentScopeEnforced()) && !(await userCanAccessTask(session.userId, taskId, agentId))) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const agent = agentId
      ? await prisma.agent.findUnique({ where: { id: agentId } })
      : null;

    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        project: taskWriteAccessWhere(
          session.userId,
          typeof agentId === "string" ? agentId : null,
        ),
      },
      include: { priority: true },
    });

    if (!task) return res.status(404).json({ message: "Task not found" });
    recordAgentBoardScopeMiss(task.projectId, "write");

    if (priority_index === 0) {
      await prisma.priority.deleteMany({ where: { taskId: task.id } });
      createPriorityActivity({
        userObj: user,
        taskId,
        toPriority: { priority_index: 0, Priority_Value: "No Priority" },
        fromAgent: agent ?? undefined,
      });
      return res.status(200).json({ message: "Successfully deleted" });
    }

    if (!task.priority) {
      const priority = await prisma.priority.create({
        data: {
          taskId,
          sectionId: task.sectionId ?? -1,
          projectId: task.projectId,
          addedByUserId: user.id,
          priority_index,
          Priority_Value,
          addedByAgentId: agentId ?? undefined,
        },
      });

      createPriorityActivity({
        userObj: user,
        taskId,
        toPriority: { priority, priority_index, Priority_Value },
        fromAgent: agent ?? undefined,
      });

      return res.status(200).json(priority);
    }

    if (task.priority.priority_index !== priority_index) {
      const updatedPriority = await prisma.priority.update({
        where: { id: task.priority.id },
        data: {
          addedByUserId: user.id,
          priority_index,
          Priority_Value,
          addedByAgentId: agentId ?? undefined,
        },
      });

      createPriorityActivity({
        userObj: user,
        taskId,
        toPriority: {
          priority: updatedPriority,
          priority_index,
          Priority_Value,
        },
        fromPriority: {
          priority: task.priority,
          priority_index: task.priority.priority_index,
          Priority_Value: task.priority.Priority_Value,
        },
        fromAgent: agent ?? undefined,
      });

      return res.status(200).json(updatedPriority);
    }

    return res.status(400).json({ message: "Priority already exists" });
  } catch (error) {
    console.error(error);
    return res.status(400).json({ message: JSON.stringify(error) });
  }
};

export default ((req, res) => withAgentScopeRequest(req, () => handler(req, res))) satisfies NextApiHandler;
