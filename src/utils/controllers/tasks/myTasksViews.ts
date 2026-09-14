import { isFeatureEnabled } from "@/lib/flags";
import { MY_TASKS_VIEWS_FLAG } from "@/lib/flags/keys";
import prisma from "@/lib/prisma";
import {
  parseMyTasksViewConfig,
  type MyTasksSavedView,
} from "@/models/MyTasksView";

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

export const myTasksViewsEnabled = (userId: number) =>
  isFeatureEnabled(MY_TASKS_VIEWS_FLAG, userId);

export const getMyTasksViews = async (userId: number): Promise<MyTasksSavedView[]> => {
  const views = await prisma.myTasksView.findMany({
    where: { userId },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: viewSelect,
  });
  return views.map(serializeMyTasksView);
};

export { viewSelect as myTasksViewSelect };
