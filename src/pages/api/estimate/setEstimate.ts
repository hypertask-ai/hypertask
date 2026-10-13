import prisma from "@/lib/prisma";
import createEstimateActivity from "@/utils/controllers/activities/createEstimateActivity";
import { NextApiHandler } from "next";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { loadSessionUserRecord } from "@/lib/auth/sessionUserRecord";
import type { IUser } from "@/models/model";

const handler: NextApiHandler = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getSessionUser(
    new Headers(req.headers as Record<string, string>)
  );
  if (!session) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const user = await loadSessionUserRecord(session.userId);

  try {
    const { taskId, estimate_index, estimate_value, agentId } = req.body;
    if (!taskId || !estimate_value) {
      return res.status(400).json({ message: "Missing Required Task ID" });
    }

    // Only fetch agent if provided
    const agent = agentId
      ? await prisma.agent.findUnique({
          where: { id: agentId },
          select: {
            id: true,
            userId: true,
            displayName: true,
            photoURL: true,
          },
        })
      : null;

    // HTPR-7163: only someone who may write to the task's board may change
    // its estimate, and every branch below works on this checked task.
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        project: taskWriteAccessWhere(
          session.userId,
          typeof agentId === "string" ? agentId : null,
        ),
      },
      include: { estimate: true },
    });

    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }

    // Delete estimate if required
    if (estimate_index === 0) {
      await prisma.estimate.deleteMany({
        where: { taskId: task.id },
      });
      return res.status(200).json({ message: "Successfully deleted" });
    }

    // CREATE or UPDATE estimate
    if (!task.estimate) {
      const estimate = await prisma.estimate.create({
        data: {
          taskId,
          sectionId: task.sectionId ?? -1,
          projectId: task.projectId,
          addedByUserId: user.id,
          estimate_index,
          estimate_value,
          addedByAgentId: agentId ?? undefined,
        },
      });

      createEstimateActivity({
        fromUser: user,
        taskId,
        toEstimate: { estimate, estimate_value, estimate_index },
        fromAgent: agent,
      });

      return res.status(200).json(estimate);
    } else {
      const updatedEstimate = await prisma.estimate.update({
        where: { id: task.estimate.id },
        data: {
          addedByUserId: user.id,
          estimate_index,
          estimate_value,
          updatedAt: new Date(),
          addedByAgentId: agentId ?? undefined,
        },
      });

      createEstimateActivity({
        fromUser: user,
        taskId,
        toEstimate: { estimate: updatedEstimate, estimate_value, estimate_index },
        fromEstimate: {
          estimate: task.estimate,
          estimate_value: task.estimate.estimate_value,
          estimate_index: task.estimate.estimate_index,
        },
        fromAgent: agent,
      });

      return res.status(200).json(updatedEstimate);
    }
  } catch (error) {
    console.error(error);
    return res.status(400).json({ message: JSON.stringify(error) });
  }
};

export default handler;
