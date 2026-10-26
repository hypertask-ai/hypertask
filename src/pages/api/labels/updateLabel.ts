import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma, type Label, type View } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { scheduleBackfillAiLabel } from "@/lib/ai/labelClassifier";
import { validateProjectMemberIds } from "@/lib/mcp/tasks/services";
import {
  buildSmartSplitBoardFilters,
  getLabelReferences,
  getManagedSmartLabelIds,
  removeLabelFromBoardFilters,
} from "@/lib/smartSplits";
import {
  getProjectLabelView,
  isProjectLabelView,
  replaceProjectLabelInBoardFilters,
} from "@/lib/projectLabelViews";
import { acquireBoardFilterWriteLock } from "@/utils/controllers/projects/views/boardFilterWriteLock";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const updateLabelBody = z.object({
  value: z.string().trim().min(1),
  labelId: z.string().min(1),
  ai_prompt: z.string().max(1000).nullable().optional(),
  projectView: z.boolean().optional(),
  mergeIntoLabelId: z.string().min(1).optional(),
});

type BoardFilterView = Pick<View, "id" | "title" | "visibility" | "userId" | "board_filters"> & {
  unsaved_User_Project_View: { id: string }[];
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

const getBoardFilterViews = (tx: Prisma.TransactionClient, projectId: number) =>
  tx.view.findMany({
    where: { project_view: { projectId } },
    select: {
      id: true,
      title: true,
      visibility: true,
      userId: true,
      board_filters: true,
      unsaved_User_Project_View: { select: { id: true } },
    },
  });

const requireEditableReferences = (
  views: ReadonlyArray<BoardFilterView>,
  labelId: string,
  userId: number
) => {
  if (views.some((view) =>
    view.userId !== userId &&
    (view.visibility !== "Public" || view.unsaved_User_Project_View.length > 0) &&
    getLabelReferences(view.board_filters).includes(labelId)
  )) {
    throw new LabelMutationError("Another member's private view uses this tag. Remove that reference first.", 409);
  }
};

const createProjectLabelView = async (
  tx: Prisma.TransactionClient,
  projectId: number,
  userId: number,
  label: Label
) => {
  const collision = await tx.view.findUnique({ where: { id: label.id }, select: { id: true } });
  if (collision) throw new LabelMutationError("This tag already has a different paired view", 409);
  const projectView = await tx.project_View.findUnique({
    where: { projectId },
    include: { default_view: true },
  });
  const base = projectView?.default_view;
  if (!projectView || !base) throw new LabelMutationError("This board does not have a default view", 409);
  const slugBase = (label.value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project";
  let slug = slugBase;
  for (let suffix = 2; ; suffix += 1) {
    const existing = await tx.view.findFirst({
      where: { project_view_id: projectView.id, slug },
      select: { id: true },
    });
    if (!existing) break;
    slug = `${slugBase}-${suffix}`;
  }
  return tx.view.create({
    data: {
      id: label.id,
      title: label.value,
      userId,
      visibility: "Public",
      project_view_id: projectView.id,
      slug,
      board_sorting_mode: base.board_sorting_mode,
      board_sorting_order: base.board_sorting_order,
      board_sorting_stack: base.board_sorting_stack ?? Prisma.JsonNull,
      board_columns_view: base.board_columns_view ?? Prisma.JsonNull,
      board_subtask_setting: base.board_subtask_setting,
      board_empty_sections: base.board_empty_sections,
      board_empty_sections_staged: base.board_empty_sections_staged,
      board_staleness: base.board_staleness,
      board_show_archived: base.board_show_archived,
      table_sort_column: base.table_sort_column,
      table_sort_direction: base.table_sort_direction,
      board_layout: base.board_layout,
      board_filters: buildSmartSplitBoardFilters({ id: label.id, value: label.value ?? "" }),
      lastUsedAt: new Date(),
    },
  });
};

const updateFilterReferences = async (
  tx: Prisma.TransactionClient,
  views: ReadonlyArray<BoardFilterView>,
  source: Label,
  target: Label
) => {
  for (const view of views) {
    const boardFilters = replaceProjectLabelInBoardFilters(view.board_filters, source.id, target);
    const title = isProjectLabelView(view, source) ? target.value : view.title;
    if (boardFilters === view.board_filters && title === view.title) continue;
    await tx.view.update({
      where: { id: view.id },
      data: { title, board_filters: boardFilters ?? Prisma.JsonNull },
    });
  }
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(key, value);
      else if (value) for (const entry of value) headers.append(key, entry);
    }
    const session = await getSessionUser(headers);
    if (!session) return res.status(401).json({ message: "Unauthorized" });
    const isProjectMember = async (projectId: number) => {
      const memberCheck = await validateProjectMemberIds(projectId, [session.userId]);
      return !memberCheck.error && !memberCheck.invalidIds?.length;
    };

    if (req.method === "POST") {
      const parsed = updateLabelBody.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid label information" });
      const { value, labelId, ai_prompt, projectView, mergeIntoLabelId } = parsed.data;
      const normalizedAiPrompt = ai_prompt === undefined ? undefined : ai_prompt?.trim() || null;
      const existingLabel = await prisma.label.findUnique({ where: { id: labelId } });
      if (!existingLabel) return res.status(404).json({ message: "Label not found" });
      const projectId = existingLabel.projectId;
      if ((normalizedAiPrompt || projectView || mergeIntoLabelId) && projectId == null) {
        return res.status(400).json({ message: "Label has no project" });
      }
      if (projectId != null && !(await isProjectMember(projectId))) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const updateData = {
        value,
        ...(normalizedAiPrompt !== undefined ? { ai_prompt: normalizedAiPrompt } : {}),
      };
      const result = projectId == null
        ? {
            updatedLabel: await prisma.label.update({ where: { id: labelId }, data: updateData }),
            previousAiPrompt: existingLabel.ai_prompt,
            projectViewId: undefined,
          }
        : await prisma.$transaction(async (tx) => {
            await acquireBoardFilterWriteLock(tx, projectId);
            const source = await tx.label.findUnique({ where: { id: labelId } });
            if (!source || source.projectId !== projectId) throw new LabelMutationError("Label not found", 404);
            if (await isManagedSmartSplitLabel(tx, labelId, projectId)) {
              throw new LabelMutationError("Manage this smart split from Manage views", 409);
            }
            const views = await getBoardFilterViews(tx, projectId);
            const sourceProjectView = getProjectLabelView(views, source);
            if ((projectView || sourceProjectView) && (normalizedAiPrompt || source.ai_prompt?.trim())) {
              throw new LabelMutationError("Only ordinary tags can be projects", 409);
            }
            if (mergeIntoLabelId) {
              if (mergeIntoLabelId === source.id) throw new LabelMutationError("Choose a different tag to merge into", 400);
              const target = await tx.label.findUnique({ where: { id: mergeIntoLabelId } });
              if (!target || target.projectId !== projectId) {
                throw new LabelMutationError("Merge target must be on the same board", 400);
              }
              if (source.ai_prompt?.trim() || target.ai_prompt?.trim() || normalizedAiPrompt) {
                throw new LabelMutationError("Smart tags cannot be merged", 409);
              }
              requireEditableReferences(views, source.id, session.userId);
              const personalReference = await tx.myTasksView.findFirst({
                where: {
                  OR: [
                    { config: { path: ["filters", "labelIds"], array_contains: [source.id] } },
                    { config: { path: ["filterSettings", "addedFilters"], array_contains: [
                      { type: "Labels", searchPayload: [{ id: source.id }] },
                    ] } },
                  ],
                },
                select: { id: true },
              });
              if (personalReference) {
                throw new LabelMutationError("A saved My Tasks view uses this tag. Remove that filter before merging.", 409);
              }
              await tx.$queryRaw(Prisma.sql`SELECT id FROM "Label" WHERE id = ${source.id} FOR UPDATE`);
              const targetProjectView = getProjectLabelView(views, target);
              await updateFilterReferences(tx, views, source, target);
              const assignments = await tx.taskLabel.findMany({
                where: { labelId: source.id },
                select: { taskId: true },
              });
              if (assignments.length) {
                await tx.taskLabel.createMany({
                  data: assignments.map(({ taskId }) => ({ taskId, labelId: target.id })),
                  skipDuplicates: true,
                });
              }
              await tx.taskLabel.deleteMany({ where: { labelId: source.id } });
              await tx.label.delete({ where: { id: source.id } });
              const inheritedView = targetProjectView ?? sourceProjectView;
              const savedView = !inheritedView && projectView
                ? await createProjectLabelView(tx, projectId, session.userId, target)
                : inheritedView;
              return { updatedLabel: target, previousAiPrompt: source.ai_prompt, projectViewId: savedView?.id };
            }
            if (source.value !== value) requireEditableReferences(views, source.id, session.userId);
            const updatedLabel = await tx.label.update({ where: { id: labelId }, data: updateData });
            if (source.value !== value) await updateFilterReferences(tx, views, source, updatedLabel);
            const savedView = sourceProjectView ?? getProjectLabelView(views, updatedLabel) ?? (projectView
              ? await createProjectLabelView(tx, projectId, session.userId, updatedLabel)
              : undefined);
            return { updatedLabel, previousAiPrompt: source.ai_prompt, projectViewId: savedView?.id };
          });
      const { updatedLabel, previousAiPrompt, projectViewId } = result;
      if (!mergeIntoLabelId && updatedLabel.ai_prompt && normalizedAiPrompt !== undefined &&
        normalizedAiPrompt !== (previousAiPrompt?.trim() || null)) {
        scheduleBackfillAiLabel(updatedLabel.id, session.userId);
      }
      void broadcastBoardChange(updatedLabel.projectId);
      return res.status(200).json({ ...updatedLabel, ...(projectViewId ? { projectViewId } : {}) });
    }

    if (req.method === "DELETE") {
      const labelId = req.query.labelId;
      if (typeof labelId !== "string" || !labelId) {
        return res.status(400).json({ message: "Missing required Information" });
      }
      const existingLabel = await prisma.label.findUnique({ where: { id: labelId } });
      if (!existingLabel) return res.status(404).json({ message: "Label not found" });
      if (existingLabel.projectId != null && !(await isProjectMember(existingLabel.projectId))) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const deleted = await prisma.$transaction(async (tx) => {
        const projectId = existingLabel.projectId;
        if (projectId != null) {
          await acquireBoardFilterWriteLock(tx, projectId);
          const lockedLabel = await tx.label.findUnique({ where: { id: labelId } });
          if (!lockedLabel || lockedLabel.projectId !== projectId) throw new LabelMutationError("Label not found", 404);
          if (await isManagedSmartSplitLabel(tx, labelId, projectId)) {
            throw new LabelMutationError("Manage this smart split from Manage views", 409);
          }
          const views = await getBoardFilterViews(tx, projectId);
          if (getProjectLabelView(views, lockedLabel)) {
            throw new LabelMutationError("Remove this tag's project view before deleting the tag", 409);
          }
          requireEditableReferences(views, labelId, session.userId);
          for (const view of views) {
            const nextFilters = removeLabelFromBoardFilters(view.board_filters, labelId);
            if (nextFilters === view.board_filters) continue;
            await tx.view.update({
              where: { id: view.id },
              data: { board_filters: z.json().parse(nextFilters) ?? Prisma.JsonNull },
            });
          }
        }
        await tx.taskLabel.deleteMany({ where: { labelId } });
        return tx.label.delete({ where: { id: labelId } });
      });
      void broadcastBoardChange(deleted.projectId);
      return res.status(200).json(deleted);
    }
    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    if (error instanceof LabelMutationError) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error("Label mutation failed", error);
    return res.status(500).json({ message: "Could not update the tag" });
  }
}
