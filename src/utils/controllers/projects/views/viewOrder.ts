import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import isProjectAdmin from "@/utils/controllers/projects/isProjectAdmin";
import { isBuiltinViewId } from "@/lib/constants/builtinViews";

const MAX_ORDERED_VIEWS = 500;

export class ViewOrderError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export const parseViewOrder = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length > MAX_ORDERED_VIEWS) {
    throw new ViewOrderError("viewOrder must be an array of view ids", 400);
  }

  const order: string[] = [];
  const seen = new Set<string>();
  for (const id of value) {
    if (typeof id !== "string" || !id) {
      throw new ViewOrderError("viewOrder must contain only view ids", 400);
    }
    if (!seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }
  return order;
};

const requireProjectAccess = async (projectId: number, userId: number) => {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      status: "Normal",
      ...getProjectWhere(userId),
    },
    select: { id: true },
  });
  if (!project) {
    throw new ViewOrderError("You do not have access to this board", 403);
  }
};

const getProjectView = async (projectId: number) => {
  const projectView = await prisma.project_View.findUnique({
    where: { projectId },
    select: { id: true },
  });
  if (!projectView) {
    throw new ViewOrderError("This board does not have views configured", 404);
  }
  return projectView;
};

const filterToAvailableViews = async (
  projectViewId: string,
  userId: number,
  requestedOrder: string[],
  publicOnly = false
) => {
  const availableViews = await prisma.view.findMany({
    where: {
      project_view_id: projectViewId,
      ...(publicOnly
        ? { visibility: "Public" as const }
        : {
            OR: [
              { visibility: "Public" as const },
              { visibility: "Private" as const, userId },
            ],
          }),
    },
    select: { id: true },
  });
  const availableIds = new Set(availableViews.map((view) => view.id));
  // Built-in views (Overdue, Blocked, ...) are client-side constants with no row
  // in the View table, but they share the same order list, so keep their ids.
  return requestedOrder.filter(
    (id) => availableIds.has(id) || isBuiltinViewId(id)
  );
};

export const saveUserViewOrder = async (
  projectId: number,
  userId: number,
  requestedOrder: string[]
) => {
  await requireProjectAccess(projectId, userId);
  const projectView = await getProjectView(projectId);
  const viewOrder = await filterToAvailableViews(
    projectView.id,
    userId,
    requestedOrder
  );

  await prisma.user_Project_View.upsert({
    where: {
      user_project: {
        userId,
        project_view_id: projectView.id,
      },
    },
    create: {
      userId,
      project_view_id: projectView.id,
      view_order: viewOrder,
    },
    update: { view_order: viewOrder },
  });

  return viewOrder;
};

export const resetUserViewOrder = async (
  projectId: number,
  userId: number
) => {
  await requireProjectAccess(projectId, userId);
  const projectView = await getProjectView(projectId);
  await prisma.user_Project_View.updateMany({
    where: { userId, project_view_id: projectView.id },
    data: { view_order: Prisma.DbNull },
  });
};

export const saveDefaultViewOrder = async (
  projectId: number,
  userId: number,
  requestedOrder: string[]
) => {
  if (!(await isProjectAdmin(userId, projectId))) {
    throw new ViewOrderError(
      "Only the board owner or an admin can set the default view order",
      403
    );
  }

  const projectView = await getProjectView(projectId);
  // Private views are user-specific and cannot define a useful order for the team.
  const defaultViewOrder = await filterToAvailableViews(
    projectView.id,
    userId,
    requestedOrder,
    true
  );
  await prisma.project_View.update({
    where: { id: projectView.id },
    data: { default_view_order: defaultViewOrder },
  });
  return defaultViewOrder;
};
