import prisma from "@/lib/prisma";
import {
  parseMyTasksViewConfig,
  type MyTasksSavedView,
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
