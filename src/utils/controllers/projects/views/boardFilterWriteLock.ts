import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import { getLabelReferences, getSmartSplitLabel } from "@/lib/smartSplits";

export class MissingBoardFilterLabelError extends Error {
  readonly status = 409;

  constructor() {
    super("A tag used by this view no longer exists. Refresh and try again.");
  }
}

export class ManagedSmartSplitMutationError extends Error {
  readonly status = 409;

  constructor() {
    super("Manage this smart split from Manage views");
  }
}

export const acquireBoardFilterWriteLock = async (
  tx: Prisma.TransactionClient,
  projectId: number
) => {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM "Project_View" WHERE "projectId" = ${projectId} FOR UPDATE`
  );
  if (rows.length !== 1) {
    throw new Error("This board does not have a view container");
  }
};

export const validateBoardFilterLabelReferences = async (
  tx: Prisma.TransactionClient,
  projectId: number,
  boardFilters: unknown
) => {
  const labelIds = [...new Set(getLabelReferences(boardFilters))];
  if (labelIds.length === 0) return;
  const labels = await tx.label.findMany({
    where: { projectId, id: { in: labelIds } },
    select: { id: true },
  });
  if (labels.length !== labelIds.length) {
    throw new MissingBoardFilterLabelError();
  }
};

export const assertViewIsNotManagedSmartSplit = async (
  tx: Prisma.TransactionClient,
  projectId: number,
  viewId: string
) => {
  const [view, labels, savedViews] = await Promise.all([
    tx.view.findFirst({
      where: { id: viewId, project_view: { projectId } },
      select: { id: true, board_filters: true },
    }),
    tx.label.findMany({
      where: { projectId, ai_prompt: { not: null } },
      select: { id: true, value: true, ai_prompt: true },
    }),
    tx.view.findMany({
      where: {
        project_view: { projectId },
        unsaved_User_Project_View: { none: {} },
      },
      select: { id: true, board_filters: true },
    }),
  ]);
  if (!view) throw new Error("View does not exist on this board");
  if (getSmartSplitLabel(view, labels, savedViews)) {
    throw new ManagedSmartSplitMutationError();
  }
};

export const withBoardFilterWriteLock = async <T>(
  projectId: number,
  boardFilters: unknown,
  operation: (tx: Prisma.TransactionClient) => Promise<T>
) => prisma.$transaction(async (tx) => {
  await acquireBoardFilterWriteLock(tx, projectId);
  await validateBoardFilterLabelReferences(tx, projectId, boardFilters);
  return operation(tx);
});
