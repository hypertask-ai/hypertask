import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getLabelReferences } from "@/lib/smartSplits";
import {
  parseMyTasksViewConfig,
  type MyTasksSavedView,
  type MyTasksViewConfig,
} from "@/models/MyTasksView";

export const MAX_MY_TASKS_VIEWS = 30;

const viewSelect = {
  id: true,
  name: true,
  position: true,
  isDefault: true,
  config: true,
} as const;

export const serializeMyTasksView = (view: {
  id: number;
  name: string;
  position: number;
  isDefault: boolean;
  config: unknown;
}): MyTasksSavedView => ({
  ...view,
  config: parseMyTasksViewConfig(view.config),
});

export const getMyTasksViews = async (userId: number): Promise<MyTasksSavedView[]> => {
  const views = await prisma.myTasksView.findMany({
    where: { userId },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    take: MAX_MY_TASKS_VIEWS,
    select: viewSelect,
  });
  return views.map(serializeMyTasksView);
};

export { viewSelect as myTasksViewSelect };


export class MissingMyTasksViewLabelError extends Error {
  constructor() {
    super("A tag in this view no longer exists. Refresh and try again.");
  }
}

export const lockMyTasksViewLabels = async (
  tx: Prisma.TransactionClient,
  config: MyTasksViewConfig
) => {
  const labelIds = [...new Set([
    ...config.filters.labelIds.map(String),
    ...getLabelReferences(config.filterSettings),
  ])].sort();
  if (!labelIds.length) return;
  const labels = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM "Label" WHERE id IN (${Prisma.join(labelIds)}) ORDER BY id FOR KEY SHARE
  `);
  if (labels.length !== labelIds.length) throw new MissingMyTasksViewLabelError();
};
