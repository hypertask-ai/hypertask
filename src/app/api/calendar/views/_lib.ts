import type { Prisma } from "@prisma/client";
import type {
  CalendarDisplay,
  CalendarSavedView,
  CalendarSettings,
  CalendarSort,
  CalendarTaskFilters,
} from "@/models/Calendar/model";
import prisma from "@/lib/prisma";
import { extraMinimalProjectWhere } from "@/utils/controllers/projects/getAllMinimal";

export const calendarViewSelect = {
  id: true,
  createdAt: true,
  updatedAt: true,
  userId: true,
  title: true,
  visibility: true,
  projectIds: true,
  taskFilters: true,
  settings: true,
  sort: true,
} satisfies Prisma.Calendar_ViewSelect;

type CalendarViewRow = Prisma.Calendar_ViewGetPayload<{
  select: typeof calendarViewSelect;
}>;

export const serializeCalendarView = (
  view: CalendarViewRow,
): CalendarSavedView => ({
  id: view.id,
  createdAt: view.createdAt.toISOString(),
  updatedAt: view.updatedAt.toISOString(),
  userId: view.userId,
  title: view.title,
  visibility: view.visibility,
  checkedProjects: view.projectIds,
  taskFilters: view.taskFilters as CalendarTaskFilters,
  settings: view.settings as CalendarSettings & { view: CalendarDisplay },
  sort: view.sort as CalendarSort | null,
});

export const getAccessibleCalendarProjectIds = async (userId: number) => {
  const projects = await prisma.project.findMany({
    where: extraMinimalProjectWhere(userId),
    select: { id: true },
  });
  return projects.map((project) => project.id);
};

export const canAccessEveryCalendarProject = (
  projectIds: readonly number[],
  accessibleProjectIds: ReadonlySet<number>,
) =>
  projectIds.length > 0 &&
  projectIds.every((projectId) => accessibleProjectIds.has(projectId));
