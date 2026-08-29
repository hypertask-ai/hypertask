// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from "@/lib/prisma";
import createLabelActivity from '@/utils/controllers/activities/createLabelActivity';
import { broadcastBoardChange } from '@/lib/realtime/server';
import {
  persistAgentTaskUpdatedWebhook,
  publishAgentWebhookDeliveries,
} from '@/lib/agentWebhooks/outbox';

class LabelAssignmentError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 404,
  ) {
    super(message);
    this.name = "LabelAssignmentError";
  }
}



export default  async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
 
  try {
    
    // ============== post body
    const {taskId,  labelId} = req.body;
    if (!taskId || !labelId ) return res.status(400).json({message:"Missing Required Information"})
    const userObj = JSON.parse(req.cookies.nookies_user!)
    const { projectId, taskLabels, agentWebhookDeliveryIds } =
      await prisma.$transaction(async (tx) => {
      const lockedTasks = await tx.$queryRaw<Array<{ projectId: number }>>`
          SELECT "projectId"
          FROM "Task"
          WHERE "id" = ${taskId}
          FOR UPDATE
      `;
      const task = lockedTasks[0];
      if (!task) throw new LabelAssignmentError("Task not found", 404);

        await tx.$queryRaw<Array<{ id: number }>>`
          SELECT "id"
          FROM "TaskLabel"
          WHERE "taskId" = ${taskId}
          FOR UPDATE
        `;

        const lockedLabels = await tx.$queryRaw<Array<{ projectId: number }>>`
          SELECT "projectId"
          FROM "Label"
          WHERE "id" = ${labelId}
          FOR UPDATE
        `;
        const label = lockedLabels[0];
        if (!label) {
          throw new LabelAssignmentError("Label not found", 404);
        }
        if (label.projectId !== task.projectId) {
          throw new LabelAssignmentError(
            "Label does not belong to the task project",
            400,
          );
        }

        const labelsBefore = await tx.taskLabel.findMany({
          where: { taskId },
          include: { label: true },
        });

        // Double check if it is already assigned.
        const labelToCheck = await tx.taskLabel.findFirst({
          where: { taskId, labelId },
          include: { label: true },
        });
        let projectId = task.projectId;

        if (!labelToCheck) {
          const labelAssigned = await tx.taskLabel.create({
            data: { labelId, taskId },
            include: { label: true },
          });
          await createLabelActivity({
            userObj,
            toTaskLabel: labelAssigned as any,
            taskId,
            status: "Assigned",
            transaction: tx,
          });
        } else {
          await tx.taskLabel.delete({ where: { id: labelToCheck.id } });
          await createLabelActivity({
            userObj,
            toTaskLabel: labelToCheck as any,
            taskId,
            status: "Removed",
            transaction: tx,
          });
        }

        const taskLabels = await tx.taskLabel.findMany({
          where: { taskId },
          include: { label: true },
        });
        // This endpoint always toggles one label, so every committed path
        // changes the set and must publish the matching task.updated event.
        const agentWebhookDeliveryIds = await persistAgentTaskUpdatedWebhook(tx, {
          taskId,
          actor: {
            userId: userObj.id,
            displayName: userObj.displayName,
          },
          changes: {
            labels: {
              from: labelsBefore.map(({ label }) => ({ id: label.id, value: label.value })),
              to: taskLabels.map(({ label }) => ({ id: label.id, value: label.value })),
            },
          },
        });
        return { projectId, taskLabels, agentWebhookDeliveryIds };
      });

    try {
      await publishAgentWebhookDeliveries(agentWebhookDeliveryIds);
    } catch (error) {
      console.warn("[assign-label] agent task.updated webhook publish failed; outbox sweep will retry", {
        taskId,
        error,
      });
    }
    
    void broadcastBoardChange(projectId, { originUserId: userObj.id })
    return res.status(200).json(taskLabels)

  } catch (error) {
      console.log(error)
      if (error instanceof LabelAssignmentError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      return res.status(500).json({ message: "Internal server error" })
  }
}
