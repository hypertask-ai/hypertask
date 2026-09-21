// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { IFilterSettings } from "@/models/Filters/model";
import { ILabel } from "@/models/model";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { scheduleBackfillAiLabel } from "@/lib/ai/labelClassifier";
import { validateProjectMemberIds } from "@/lib/mcp/tasks/services";
import { sanitizeBoardFilters } from "@/utils/helperFunctions/Views/BoardFilterSanitizer";
import { getManagedSmartLabelIds } from "@/lib/smartSplits";
import { Prisma } from "@prisma/client";
import { acquireBoardFilterWriteLock } from "@/utils/controllers/projects/views/boardFilterWriteLock";

const MAX_AI_PROMPT_LENGTH = 1000;

type BoardFilterView = {
  id: string;
  board_filters: unknown;
};

class LabelMutationError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const isManagedSmartSplitLabel = async (
  client: Pick<Prisma.TransactionClient, "label" | "view">,
  labelId: string,
  projectId: number
) => {
  const [labels, views] = await Promise.all([
    client.label.findMany({
      where: { projectId, ai_prompt: { not: null } },
      select: { id: true, value: true, ai_prompt: true, projectId: true },
    }),
    client.view.findMany({
      where: {
        project_view: { projectId },
        unsaved_User_Project_View: { none: {} },
      },
      select: { id: true, board_filters: true },
    }),
  ]);
  return getManagedSmartLabelIds(views, labels).has(labelId);
};

// "/api/labels/updateLabel"

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    //   ==================== IF POST
    if (req.method === "POST") {
      const { value, labelId, ai_prompt } = req.body;
      if (!value || !labelId)
        return res
          .status(400)
          .json({ message: "Missing required Information" });
      if (typeof ai_prompt === "string" && ai_prompt.length > MAX_AI_PROMPT_LENGTH) {
        return res.status(400).json({ message: "ai_prompt is too long" });
      }

      const normalizedAiPrompt =
        ai_prompt !== undefined
          ? typeof ai_prompt === "string" && ai_prompt.trim()
            ? ai_prompt.trim()
            : null
          : undefined;

      // Smart labels run an LLM classification pass on every task in the
      // project (cost), so require project membership before setting one.
      const existingLabel = await prisma.label.findUnique({
        where: { id: labelId },
        select: { projectId: true, ai_prompt: true },
      });
      if (!existingLabel)
        return res.status(404).json({ message: "Label not found" });
      const existingLabelProjectId = existingLabel.projectId;
      if (normalizedAiPrompt) {
        if (existingLabelProjectId == null) {
          return res.status(400).json({ message: "Label has no project" });
        }
        let userId: unknown;
        try {
          userId = JSON.parse(req.cookies.nookies_user ?? "null")?.id;
        } catch {
          return res.status(403).json({ message: "Forbidden" });
        }
        if (typeof userId !== "number") {
          return res.status(403).json({ message: "Forbidden" });
        }
        const memberCheck = await validateProjectMemberIds(
          existingLabelProjectId,
          [userId]
        );
        if (memberCheck.error || memberCheck.invalidIds?.length) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }

      // ============  update the value
      const updateData = {
        value,
        ...(normalizedAiPrompt !== undefined
          ? { ai_prompt: normalizedAiPrompt }
          : {}),
      };
      const { updatedLabel, previousAiPrompt } = existingLabelProjectId == null
        ? {
            updatedLabel: await prisma.label.update({
              where: { id: labelId },
              data: updateData,
            }),
            previousAiPrompt: existingLabel.ai_prompt,
          }
        : await prisma.$transaction(async (tx) => {
            await acquireBoardFilterWriteLock(tx, existingLabelProjectId);
            const lockedLabel = await tx.label.findUnique({
              where: { id: labelId },
              select: { projectId: true, ai_prompt: true },
            });
            if (!lockedLabel || lockedLabel.projectId !== existingLabelProjectId) {
              throw new LabelMutationError("Label not found", 404);
            }
            if (await isManagedSmartSplitLabel(tx, labelId, existingLabelProjectId)) {
              throw new LabelMutationError("Manage this smart split from Manage views", 409);
            }
            return {
              updatedLabel: await tx.label.update({
                where: { id: labelId },
                data: updateData,
              }),
              previousAiPrompt: lockedLabel.ai_prompt,
            };
          });

      const promptChanged =
        normalizedAiPrompt !== undefined &&
        normalizedAiPrompt !== (previousAiPrompt?.trim() || null);
      if (updatedLabel.ai_prompt && promptChanged) {
        scheduleBackfillAiLabel(updatedLabel.id);
      }
      void broadcastBoardChange(updatedLabel.projectId);
      return res.status(200).json(updatedLabel);
    }

    // ===================== IF DELETE
    else if (req.method === "DELETE") {
      const { labelId } = req.query;
      if (!labelId)
        return res
          .status(400)
          .json({ message: "Missing required Information" });

      const existingLabel = await prisma.label.findUnique({
        where: { id: labelId as string },
        select: { projectId: true },
      });
      if (!existingLabel) {
        return res.status(404).json({ message: "Label not found" });
      }
      const deleted = await prisma.$transaction(async (tx) => {
        const actualProjectId = existingLabel.projectId;
        if (actualProjectId != null) {
          await acquireBoardFilterWriteLock(tx, actualProjectId);
          const lockedLabel = await tx.label.findUnique({
            where: { id: labelId as string },
            select: { id: true },
          });
          if (!lockedLabel) throw new LabelMutationError("Label not found", 404);
          if (await isManagedSmartSplitLabel(tx, labelId as string, actualProjectId)) {
            throw new LabelMutationError("Manage this smart split from Manage views", 409);
          }

          const projectView = await tx.project_View.findFirst({
            where: {
              projectId: actualProjectId,
            },
            select: {
              allViews: {
                select: {
                  id: true,
                  board_filters: true,
                },
              },
            },
          });

          if (projectView) {
            for (const view of projectView.allViews) {
              await filterAndRemoveTags(tx, view, labelId as string);
            }
          }
        }

        const deleteTaskLabels = await tx.taskLabel.deleteMany({
          where: { labelId: labelId as string },
        });
        console.log("🚀 ~ deleteTaskLabels:", deleteTaskLabels);
        return tx.label.delete({ where: { id: labelId as string } });
      });

      console.log("🚀 ~ deleted:", deleted);
      void broadcastBoardChange(deleted.projectId);
      return res.status(200).json(deleted);
    }
  } catch (error) {
    console.log(error);
    if (error instanceof LabelMutationError) {
      return res.status(error.status).json({ message: error.message });
    }
    return res.status(500).json(error);
  }
}

const filterAndRemoveTags = async (
  tx: Prisma.TransactionClient,
  viewToUpdate: BoardFilterView,
  labelId: string
) => {
  if (!viewToUpdate) return;
  const currentBoardFilter = {
    ...(viewToUpdate.board_filters as unknown as IFilterSettings),
  };

  if (Array.isArray(currentBoardFilter.addedFilters)) {
    const currentAddedFilters = [...currentBoardFilter.addedFilters];
    if (currentAddedFilters.length !== 0) {
      let removedReference = false;
      const newAddedFilters = currentAddedFilters
        .map((filter) => {
          if (filter.type === "Labels" && Array.isArray(filter.searchPayload)) {
            const newPayload = filter.searchPayload.filter(
              (item: ILabel) => item.id !== labelId
            );
            if (newPayload.length === filter.searchPayload.length) return filter;
            removedReference = true;
            console.log("🚀 ~ newAddedFilters ~ newPayload:", newPayload);
            if (newPayload.length === 0) {
              return undefined;
            } else return { ...filter, searchPayload: newPayload };
          }
          return filter;
        })
        .filter((filter) => filter !== undefined);
      if (!removedReference) return;
      const newBoardFilter = {
        ...currentBoardFilter,
        addedFilters: newAddedFilters,
      };
      await tx.view.update({
        where: {
          id: viewToUpdate.id,
        },
        data: {
          board_filters: sanitizeBoardFilters(newBoardFilter) as any,
        },
      });
    }
  }
};
