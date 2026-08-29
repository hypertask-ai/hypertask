import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { scheduleBackfillAiLabel } from "@/lib/ai/labelClassifier";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import prisma from "@/lib/prisma";
import { broadcastBoardChange } from "@/lib/realtime/server";
import {
  buildSmartSplitBoardFilters,
  getLabelReferences,
  removeLabelFromBoardFilters,
  replaceLabelNameInBoardFilters,
} from "@/lib/smartSplits";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { sanitizeBoardFilters } from "@/utils/helperFunctions/Views/BoardFilterSanitizer";
import { acquireBoardFilterWriteLock } from "@/utils/controllers/projects/views/boardFilterWriteLock";

const MAX_AI_PROMPT_LENGTH = 1000;
const SERIALIZABLE_TRANSACTION_ATTEMPTS = 3;

class SmartSplitError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const validateFields = (body: NextApiRequest["body"]) => {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const rawPrompt = typeof body.prompt === "string" ? body.prompt : "";
  const prompt = rawPrompt.trim();
  if (!name) throw new SmartSplitError("Smart split name is required");
  if (!prompt) throw new SmartSplitError("Smart split prompt is required");
  if (rawPrompt.length > MAX_AI_PROMPT_LENGTH) {
    throw new SmartSplitError("Smart split prompt must be 1,000 characters or fewer");
  }
  return { name, prompt };
};

const runSerializableTransaction = async <T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> => {
  for (let attempt = 0; attempt < SERIALIZABLE_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: "Serializable" });
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      if (code !== "P2034" && code !== "P2002") throw error;
      if (attempt === SERIALIZABLE_TRANSACTION_ATTEMPTS - 1) {
        throw new SmartSplitError(
          "Another smart split changed at the same time. Try again.",
          409
        );
      }
    }
  }
  throw new SmartSplitError("Could not save the smart split", 409);
};

const slugify = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "smart-split";

const uniqueSlug = async (
  tx: Prisma.TransactionClient,
  projectViewId: string,
  title: string,
  excludingViewId?: string
) => {
  const base = slugify(title);
  let candidate = base;
  for (let suffix = 2; ; suffix += 1) {
    const existing = await tx.view.findFirst({
      where: {
        project_view_id: projectViewId,
        slug: candidate,
        ...(excludingViewId ? { id: { not: excludingViewId } } : {}),
      },
      select: { id: true },
    });
    if (!existing) return candidate;
    candidate = `${base}-${suffix}`;
  }
};

const requireProjectAccess = async (projectId: number, userId: number) => {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      status: "Normal",
      ...taskWriteAccessWhere(userId),
    },
    select: { id: true },
  });
  if (!project) throw new SmartSplitError("You do not have access to this board", 403);
};

const requireUniqueNames = async (
  tx: Prisma.TransactionClient,
  projectId: number,
  name: string,
  excluding?: { viewId: string; labelId: string }
) => {
  const [view, label] = await Promise.all([
    tx.view.findFirst({
      where: {
        project_view: { projectId },
        title: { equals: name, mode: "insensitive" },
        ...(excluding ? { id: { not: excluding.viewId } } : {}),
      },
      select: { id: true },
    }),
    tx.label.findFirst({
      where: {
        projectId,
        value: { equals: name, mode: "insensitive" },
        ...(excluding ? { id: { not: excluding.labelId } } : {}),
      },
      select: { id: true },
    }),
  ]);
  if (view || label) {
    throw new SmartSplitError(`A view or tag named "${name}" already exists`, 409);
  }
};

const requireSmartLabelForView = async (
  tx: Prisma.TransactionClient,
  projectId: number,
  view: { id: string; project_view_id: string; board_filters: unknown }
) => {
  const references = getLabelReferences(view.board_filters);
  const labels = references.length
    ? await tx.label.findMany({
        where: { id: { in: references }, projectId, ai_prompt: { not: null } },
        select: { id: true, value: true, ai_prompt: true, projectId: true },
      })
    : [];
  const smartLabels = labels.filter((label) => Boolean(label.ai_prompt?.trim()));
  const pairedLabel = smartLabels.find(
    (label) => label.id === view.id && references.includes(label.id)
  );
  if (pairedLabel) return pairedLabel;

  const smartIds = new Set(smartLabels.map((label) => label.id));
  const matches = references.filter((id) => smartIds.has(id));
  if (matches.length !== 1) {
    throw new SmartSplitError(
      "This view must reference exactly one smart tag before it can be managed as a smart split",
      409
    );
  }
  const label = labels.find((candidate) => candidate.id === matches[0]);
  if (!label) throw new SmartSplitError("The smart split tag no longer exists", 409);
  const views = await tx.view.findMany({
    where: {
      project_view_id: view.project_view_id,
      unsaved_User_Project_View: { none: {} },
    },
    select: { id: true, board_filters: true },
  });
  const linkedViews = views.filter((candidate) =>
    getLabelReferences(candidate.board_filters).includes(label.id)
  );
  if (linkedViews.length !== 1 || linkedViews[0]?.id !== view.id) {
    throw new SmartSplitError(
      "This smart tag is linked to multiple views and cannot be edited safely",
      409
    );
  }
  return label;
};

const updateLabelPayloads = async (
  tx: Prisma.TransactionClient,
  projectViewId: string,
  userId: number,
  labelId: string,
  operation: { renameTo: string } | { remove: true },
  excludingViewId?: string
) => {
  const protectedViews = await tx.view.findMany({
    where: {
      project_view_id: projectViewId,
      ...(excludingViewId ? { id: { not: excludingViewId } } : {}),
      userId: { not: userId },
      OR: [
        { visibility: "Private" },
        { unsaved_User_Project_View: { some: {} } },
      ],
    },
    select: { board_filters: true },
  });
  if (
    protectedViews.some((view) =>
      getLabelReferences(view.board_filters).includes(labelId)
    )
  ) {
    throw new SmartSplitError(
      "Another member's private view uses this smart split. Ask them to remove it before changing the split.",
      409
    );
  }

  const views = await tx.view.findMany({
    where: {
      project_view_id: projectViewId,
      ...(excludingViewId ? { id: { not: excludingViewId } } : {}),
      OR: [
        {
          visibility: "Public",
          unsaved_User_Project_View: { none: {} },
        },
        { userId },
      ],
    },
    select: { id: true, board_filters: true },
  });
  for (const view of views) {
    const nextFilters = "renameTo" in operation
      ? replaceLabelNameInBoardFilters(view.board_filters, labelId, operation.renameTo)
      : removeLabelFromBoardFilters(view.board_filters, labelId);
    if (nextFilters !== view.board_filters) {
      await tx.view.update({
        where: { id: view.id },
        data: {
          board_filters: sanitizeBoardFilters(nextFilters) as Prisma.InputJsonValue,
        },
      });
    }
  }
};

const createSmartSplit = async (
  projectId: number,
  userId: number,
  name: string,
  prompt: string
) => {
  const splitId = randomUUID();
  return runSerializableTransaction(async (tx) => {
    await acquireBoardFilterWriteLock(tx, projectId);
    const projectView = await tx.project_View.findUnique({
      where: { projectId },
      select: {
        id: true,
        default_view: {
          select: {
            board_sorting_mode: true,
            board_sorting_order: true,
            board_sorting_stack: true,
            board_columns_view: true,
            board_subtask_setting: true,
            board_empty_sections: true,
            board_staleness: true,
            board_show_archived: true,
            table_sort_column: true,
            table_sort_direction: true,
            board_layout: true,
          },
        },
      },
    });
    if (!projectView?.default_view) {
      throw new SmartSplitError("This board does not have a default view", 409);
    }
    await requireUniqueNames(tx, projectId, name);

    const label = await tx.label.create({
      data: { id: splitId, projectId, value: name, ai_prompt: prompt },
      select: { id: true, value: true, ai_prompt: true, projectId: true },
    });
    const base = projectView.default_view;
    const view = await tx.view.create({
      data: {
        id: splitId,
        project_view_id: projectView.id,
        userId,
        title: name,
        slug: await uniqueSlug(tx, projectView.id, name),
        visibility: "Public",
        board_sorting_mode: base.board_sorting_mode,
        board_sorting_order: base.board_sorting_order,
        board_sorting_stack: base.board_sorting_stack ?? Prisma.JsonNull,
        board_columns_view: base.board_columns_view ?? Prisma.JsonNull,
        board_filters: buildSmartSplitBoardFilters({
          id: label.id,
          value: label.value ?? name,
        }) as Prisma.InputJsonValue,
        board_subtask_setting: base.board_subtask_setting,
        board_empty_sections: base.board_empty_sections,
        board_staleness: base.board_staleness,
        board_show_archived: base.board_show_archived,
        table_sort_column: base.table_sort_column,
        table_sort_direction: base.table_sort_direction,
        board_layout: base.board_layout,
        lastUsedAt: new Date(),
      },
    });
    return { label, view };
  });
};

const editSmartSplit = async (
  projectId: number,
  userId: number,
  viewId: string,
  name: string,
  prompt: string
) =>
  runSerializableTransaction(async (tx) => {
    await acquireBoardFilterWriteLock(tx, projectId);
    const view = await tx.view.findFirst({
      where: {
        id: viewId,
        project_view: { projectId },
        OR: [
          { visibility: "Public" },
          { visibility: "Private", userId },
        ],
      },
      select: { id: true, slug: true, board_filters: true, project_view_id: true },
    });
    if (!view) throw new SmartSplitError("Smart split not found", 404);
    const label = await requireSmartLabelForView(tx, projectId, view);
    const promptChanged = prompt !== label.ai_prompt?.trim();
    const nameChanged = name !== (label.value ?? "");
    if (nameChanged) {
      await requireUniqueNames(tx, projectId, name, {
        viewId: view.id,
        labelId: label.id,
      });
    }
    await tx.label.update({
      where: { id: label.id },
      data: { value: name, ai_prompt: prompt },
    });
    const updatedView = nameChanged
      ? await tx.view.update({
          where: { id: view.id },
          data: {
            title: name,
            slug: await uniqueSlug(tx, view.project_view_id, name, view.id),
            board_filters: replaceLabelNameInBoardFilters(
              view.board_filters,
              label.id,
              name
            ) as Prisma.InputJsonValue,
          },
        })
      : view;
    if (nameChanged) {
      await updateLabelPayloads(
        tx,
        view.project_view_id,
        userId,
        label.id,
        { renameTo: name },
        view.id
      );
    }
    return { labelId: label.id, promptChanged, slug: updatedView.slug };
  });

const deleteSmartSplit = async (
  projectId: number,
  userId: number,
  viewId: string
) =>
  runSerializableTransaction(async (tx) => {
    await acquireBoardFilterWriteLock(tx, projectId);
    const view = await tx.view.findFirst({
      where: {
        id: viewId,
        project_view: { projectId },
        OR: [
          { visibility: "Public" },
          { visibility: "Private", userId },
        ],
      },
      select: {
        id: true,
        board_filters: true,
        project_view_id: true,
        project_view: { select: { default_view_id: true, default_view_order: true } },
      },
    });
    if (!view) throw new SmartSplitError("Smart split not found", 404);
    if (view.project_view.default_view_id === view.id) {
      throw new SmartSplitError(
        "Choose another default view before deleting this smart split",
        409
      );
    }
    const label = await requireSmartLabelForView(tx, projectId, view);

    await updateLabelPayloads(
      tx,
      view.project_view_id,
      userId,
      label.id,
      { remove: true },
      view.id
    );
    await tx.user_Project_View.updateMany({
      where: { appliedViewId: view.id },
      data: { appliedViewId: null },
    });
    await tx.user_Project_View.updateMany({
      where: { unsavedViewId: view.id },
      data: { unsavedViewId: null },
    });

    const userOrders = await tx.user_Project_View.findMany({
      where: { project_view_id: view.project_view_id },
      select: { id: true, view_order: true },
    });
    for (const row of userOrders) {
      if (!Array.isArray(row.view_order) || !row.view_order.includes(view.id)) continue;
      await tx.user_Project_View.update({
        where: { id: row.id },
        data: { view_order: row.view_order.filter((id) => id !== view.id) },
      });
    }
    if (
      Array.isArray(view.project_view.default_view_order) &&
      view.project_view.default_view_order.includes(view.id)
    ) {
      await tx.project_View.update({
        where: { id: view.project_view_id },
        data: {
          default_view_order: view.project_view.default_view_order.filter(
            (id) => id !== view.id
          ),
        },
      });
    }

    await tx.view_Last_Used.deleteMany({ where: { viewId: view.id } });
    await tx.view.delete({ where: { id: view.id } });
    await tx.taskLabel.deleteMany({ where: { labelId: label.id } });
    await tx.label.delete({ where: { id: label.id } });
  });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getSessionUser(
    new Headers(req.headers as Record<string, string>)
  );
  if (!session) {
    return res.status(401).json({
      message: "Sign in to manage smart splits",
      code: "SESSION_REQUIRED",
    });
  }
  const userId = session.userId;

  const projectId = Number(req.body?.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return res.status(400).json({ message: "A valid board is required" });
  }

  try {
    await requireProjectAccess(projectId, userId);

    if (req.method === "POST") {
      const { name, prompt } = validateFields(req.body);
      const result = await createSmartSplit(projectId, userId, name, prompt);
      scheduleBackfillAiLabel(result.label.id);
      void broadcastBoardChange(projectId, { originUserId: userId });
      return res.status(201).json(result);
    }

    if (req.method === "PATCH") {
      const viewId = typeof req.body.viewId === "string" ? req.body.viewId : "";
      if (!viewId) throw new SmartSplitError("Smart split view is required");
      const { name, prompt } = validateFields(req.body);
      const result = await editSmartSplit(projectId, userId, viewId, name, prompt);
      if (result.promptChanged) scheduleBackfillAiLabel(result.labelId);
      void broadcastBoardChange(projectId, { originUserId: userId });
      return res.status(200).json({ success: true, slug: result.slug });
    }

    if (req.method === "DELETE") {
      const viewId = typeof req.body.viewId === "string" ? req.body.viewId : "";
      if (!viewId) throw new SmartSplitError("Smart split view is required");
      await deleteSmartSplit(projectId, userId, viewId);
      void broadcastBoardChange(projectId, { originUserId: userId });
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    if (error instanceof SmartSplitError) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error("smart split mutation failed", error);
    return res.status(500).json({ message: "Could not save the smart split" });
  }
}
