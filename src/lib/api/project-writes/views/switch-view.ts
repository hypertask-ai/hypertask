import { z } from "zod";
import { Prisma } from "@prisma/client";
import { taskWriteRoute } from "@/lib/api/task-writes/route";
import { viewWriteJson } from "./response";
import { isFeatureEnabled } from "@/lib/flags";
import prisma from "@/lib/prisma";
import { tableSettingsPromotedFromDraft } from "@/lib/table-view/tableViewSettings";
import { savedViewBoardAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { acquireBoardFilterWriteLock } from "@/utils/controllers/projects/views/boardFilterWriteLock";
import getProjectView from "@/utils/controllers/projects/views/viewsHelperAPIfunctions";

const route = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Missing required information",
  allowNullBody: true,
  operation: async (body, session) => {
    const { projectId, newViewId } = body ?? {};
    if (!Number.isSafeInteger(projectId) || projectId <= 0 || typeof newViewId !== "string" || !newViewId.trim()) {
      return viewWriteJson({ message: "Missing required information" }, 400);
    }
    const userId = session.userId;
    const where = {
      id: newViewId,
      project_view: { projectId, project: savedViewBoardAccessWhere(userId) },
      OR: [{ visibility: "Public" as const }, { userId }],
    };
    const select = { project_view: { select: { id: true, projectId: true, default_view_id: true } } } as const;
    const notFound = () => viewWriteJson({ message: "View not found on this board" }, 404);
    try {
      if (!await prisma.view.findFirst({ where, select })) return notFound();
      const keepTableSettings = await isFeatureEnabled("htpr-8973-table-sort-columns", userId).catch(() => false);
      const switched = await prisma.$transaction(async tx => {
        await acquireBoardFilterWriteLock(tx, projectId);
        const view = await tx.view.findFirst({ where, select });
        if (!view) return false;
        const pv = view.project_view;
        const appliedViewId = pv.default_view_id === newViewId ? null : newViewId;
        const previous = keepTableSettings
          ? await tx.user_Project_View.findUnique({
            where: { user_project: { userId, project_view_id: pv.id } },
            select: { appliedViewId: true, unsavedViewId: true },
          })
          : null;
        const state = await tx.user_Project_View.upsert({
          create: { userId, project_view_id: pv.id, appliedViewId },
          update: { appliedViewId },
          where: { user_project: { userId, project_view_id: pv.id } },
        });
        const currentDate = new Date();
        await tx.view.update({ where, data: { lastUsedAt: currentDate } });
        await tx.view_Last_Used.upsert({
          create: { userId, viewId: newViewId, lastUsedAt: currentDate },
          update: { lastUsedAt: currentDate },
          where: { user_view_last_used: { userId, viewId: newViewId } },
        });
        if (state.unsavedViewId) {
          const draft = await tx.view.findFirst({ where: { id: state.unsavedViewId, userId, project_view_id: pv.id } });
          if (draft && keepTableSettings) {
            const ownerId = previous?.appliedViewId ?? pv.default_view_id;
            const owner = ownerId && ownerId !== draft.id
              ? await tx.view.findFirst({
                where: { id: ownerId, project_view_id: pv.id },
                select: {
                  id: true,
                  table_sort_stack: true,
                  table_columns: true,
                },
              })
              : null;
            if (owner) {
              const promoted = tableSettingsPromotedFromDraft(owner, draft);
              if (promoted.table_sort_stack || promoted.table_columns) {
                await tx.view.update({
                  where: { id: owner.id },
                  data: {
                    ...(promoted.table_sort_stack ? {
                      table_sort_column: promoted.table_sort_column,
                      table_sort_direction: promoted.table_sort_direction,
                      table_sort_stack: promoted.table_sort_stack as Prisma.InputJsonValue,
                    } : {}),
                    ...(promoted.table_columns ? {
                      table_columns: promoted.table_columns as Prisma.InputJsonValue,
                    } : {}),
                  },
                });
              }
            }
          }
          if (draft) await tx.view.delete({ where: { id: draft.id, userId, project_view_id: pv.id, project_view: { project: savedViewBoardAccessWhere(userId) } } });
        }
        return true;
      });
      if (!switched) return notFound();
      return viewWriteJson(await getProjectView(projectId, userId), 200);
    } catch (error) {
      if ((error as { code?: string })?.code === "P2025") return notFound();
      return viewWriteJson(error, 500);
    }
  },
});

export const POST = route;
