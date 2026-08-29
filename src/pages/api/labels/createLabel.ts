// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from "@/lib/prisma";
import createLabelActivity from '@/utils/controllers/activities/createLabelActivity';
import { broadcastBoardChange } from '@/lib/realtime/server';
import { scheduleBackfillAiLabel } from '@/lib/ai/labelClassifier';
import { validateProjectMemberIds } from '@/lib/mcp/tasks/services';
import {
  persistAgentTaskUpdatedWebhook,
  publishAgentWebhookDeliveries,
} from '@/lib/agentWebhooks/outbox';

const MAX_AI_PROMPT_LENGTH = 1000;

export default  async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {

  try {

    // ============== post body
    const {taskId, projectId, value, ai_prompt, CreateLabelAndReturn} = req.body;
    if (!projectId || !value) return res.status(400).json({message:"Missing Required Information"})
    if (typeof ai_prompt === "string" && ai_prompt.length > MAX_AI_PROMPT_LENGTH) {
      return res.status(400).json({ message: "ai_prompt is too long" });
    }
    const aiPrompt = typeof ai_prompt === "string" && ai_prompt.trim()
      ? ai_prompt.trim()
      : null;
    let userObj;
    try {
      userObj = JSON.parse(req.cookies.nookies_user!);
    } catch (error) {
      if (aiPrompt) return res.status(403).json({ message: "Forbidden" });
      throw error;
    }
    // Smart labels run an LLM classification pass on every task in the
    // project (cost), so require project membership before setting one.
    if (aiPrompt) {
      if (typeof userObj?.id !== "number") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const memberCheck = await validateProjectMemberIds(projectId, [userObj.id]);
      if (memberCheck.error || memberCheck.invalidIds?.length) {
        return res.status(403).json({ message: "Forbidden" });
      }
    }


    // check if same projectid and value exists
    const check = await prisma.label.findFirst({
        where:{
            AND:[
                {projectId:projectId},
                {value:value}
            ]
        }
    })
    if (check) return res.status(400).json({message:"Duplicate found"})
    
    // ---------- create label

    if (CreateLabelAndReturn){
        const createdLabel= await prisma.label.create({
            data:{
                value:value,
                projectId:projectId,
                ai_prompt: aiPrompt,
            }
        })
        if (aiPrompt) scheduleBackfillAiLabel(createdLabel.id)
        void broadcastBoardChange(projectId, { originUserId: userObj.id })
        return res.status(200).json(createdLabel)
    }
    // The project-only branch returned above. This branch always attaches the
    // new label to a task, so a missing taskId is invalid here.
    if (taskId == null) {
      return res.status(400).json({ message: "taskId is required" });
    }
    const { createdLabel, taskLabels, agentWebhookDeliveryIds } =
      await prisma.$transaction(async (tx) => {
        const lockedTasks = await tx.$queryRaw<
          Array<{ id: number; projectId: number }>
        >`
          SELECT "id", "projectId"
          FROM "Task"
          WHERE "id" = ${taskId}
          FOR UPDATE
        `;
        const lockedTask = lockedTasks[0];
        if (!lockedTask) {
          throw new Error("Task not found");
        }
        if (lockedTask.projectId !== projectId) {
          throw new Error("Task does not belong to the label project");
        }

        const labelsBefore = await tx.taskLabel.findMany({
          where: { taskId },
          select: { label: { select: { id: true, value: true } } },
        });
        const createdLabel = await tx.label.create({
          data: {
            value: value,
            projectId: projectId,
            ai_prompt: aiPrompt,
            task: {
              create: {
                taskId: taskId,
              },
            },
          },
        });
        const labelToCheck = await tx.taskLabel.findFirst({
          where: {
            taskId: taskId,
            labelId: createdLabel.id,
          },
          include: {
            label: true,
          },
        });
        const taskLabels = await tx.taskLabel.findMany({
          where: { taskId },
          include: { label: true },
        });
        if (!labelToCheck) {
          throw new Error("Created label was not attached to the task");
        }
        await createLabelActivity({
          userObj,
          toTaskLabel: labelToCheck as any,
          taskId,
          status: "Created",
          transaction: tx,
        });
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
        return { createdLabel, taskLabels, agentWebhookDeliveryIds };
      });

    if (aiPrompt) scheduleBackfillAiLabel(createdLabel.id)

    try {
      await publishAgentWebhookDeliveries(agentWebhookDeliveryIds);
    } catch (error) {
      console.warn("[create-label] agent task.updated webhook publish failed; outbox sweep will retry", {
        taskId,
        error,
      });
    }
    
    void broadcastBoardChange(projectId, { originUserId: userObj.id })
    return res.status(200).json(taskLabels)
  } catch (error) {
      console.log(error)
      if (error instanceof Error && error.message === "Task not found") {
        return res.status(404).json({ message: error.message });
      }
      if (error instanceof Error && error.message === "Task does not belong to the label project") {
        return res.status(400).json({ message: error.message });
      }
      return res.status(500).json({ message: "Internal server error" })
  }
}
