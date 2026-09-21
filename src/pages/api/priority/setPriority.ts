import prisma from "@/lib/prisma";
import createPriorityActivity from "@/utils/controllers/activities/CreatePriorityActivity";
import { NextApiHandler } from "next";

const handler: NextApiHandler = async (req, res) => {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed" });

  try {
    const { taskId, priority_index, Priority_Value, agentId } = req.body;
    if (!taskId || !Priority_Value)
      return res.status(400).json({ message: "Missing Required Task ID" });

    const user = JSON.parse(req.cookies.nookies_user!);

    // Only fetch agent if provided
    const agent = agentId
      ? await prisma.agent.findUnique({ where: { id: agentId } })
      : null;

    // Delete priority if priority_index is 0
    if (priority_index === 0) {
      await prisma.priority.deleteMany({ where: { taskId } });
      createPriorityActivity({
        userObj: user,
        taskId,
        toPriority: { priority_index: 0, Priority_Value: "No Priority" },
        fromAgent: agent ?? undefined,
      });
      return res.status(200).json({ message: "Successfully deleted" });
    }

    // Try to find the task and its current priority
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { priority: true },
    });

    if (!task) return res.status(404).json({ message: "Task not found" });

    // If there's no priority for this task, create it
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

    // If updating to a new index, update existing, otherwise error
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

export default handler;
