import { z } from "zod";
import { taskWriteRoute } from "@/lib/api/task-writes/route";
import { viewWriteJson } from "./response";
import prisma from "@/lib/prisma";
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
      const switched = await prisma.$transaction(async tx => {
        await acquireBoardFilterWriteLock(tx, projectId);
        const view = await tx.view.findFirst({ where, select });
        if (!view) return false;
        const pv = view.project_view;
        const appliedViewId = pv.default_view_id === newViewId ? null : newViewId;
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
