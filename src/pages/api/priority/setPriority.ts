import type { Prisma } from '@prisma/client';
import { withAgentScopeRequest, prepareAgentScope, agentScopeEnforced, recordAgentBoardScopeMiss } from "@/lib/auth/agentScope";
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
    const agentId = typeof requestedAgentId === "string" ? requestedAgentId : null;
    await prepareAgentScope(session.userId, agentId);
    if (agentId && agentScopeEnforced()) {
      const actingAgent = resolveActingAgent({ sessionAgentId: session.agentId, bodyAgentId: requestedAgentId });
      if (!actingAgent.ok) return res.status(actingAgent.status).json({ message: actingAgent.message });
      if (!(await userCanAccessTask(session.userId, taskId, agentId, session.teamScope))) {
        return res.status(403).json({ message: "Forbidden" });
      }
    }

    const agent = agentId
      ? await prisma.agent.findUnique({ where: { id: agentId } })
      : null;

    const mutate = async (database: typeof prisma | Prisma.TransactionClient) => {
      const task = await database.task.findFirst({
        where: {
          id: taskId,
          project: taskWriteAccessWhere(
            session.userId,
            typeof agentId === "string" ? agentId : null,
            session.teamScope,
          ),
        },
        include: { priority: true },
      });

      if (!task) return { status: 404, body: { message: "Task not found" } };
      recordAgentBoardScopeMiss(task.projectId, "write");

      if (priority_index === 0) {
        await database.priority.deleteMany({ where: { taskId: task.id } });
        createPriorityActivity({
          userObj: user,
          taskId,
          toPriority: { priority_index: 0, Priority_Value: "No Priority" },
          fromAgent: agent ?? undefined,
        });
        return { status: 200, body: { message: "Successfully deleted" } };
      }

      if (!task.priority) {
        const priority = await database.priority.create({
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

        return { status: 200, body: priority };
      }

      if (task.priority.priority_index !== priority_index) {
        const updatedPriority = await database.priority.update({
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

        return { status: 200, body: updatedPriority };
      }

      return { status: 400, body: { message: "Priority already exists" } };
    };
    const result = session.teamScope == null ? await mutate(prisma) : await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${taskId} FOR UPDATE`;
      return mutate(tx);
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error(error);
    return res.status(400).json({ message: JSON.stringify(error) });
  }
};

export default ((req, res) => withAgentScopeRequest(req, () => handler(req, res))) satisfies NextApiHandler;
