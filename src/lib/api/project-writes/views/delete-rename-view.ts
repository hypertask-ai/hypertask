import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import { viewWriteJson } from "./response";
import { taskReadQuery } from "@/lib/api/task-writes/read-query";
import prisma from "@/lib/prisma";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { savedViewBoardAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import getProjectView, { getUniqueSlug } from "@/utils/controllers/projects/views/viewsHelperAPIfunctions";
import { sanitizeViewBoardFilters } from "@/utils/helperFunctions/Views/BoardFilterSanitizer";
import {
  acquireBoardFilterWriteLock,
  assertViewIsNotManagedSmartSplit,
  ManagedSmartSplitMutationError,
} from "@/utils/controllers/projects/views/boardFilterWriteLock";

const route = (method: string) => taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Missing required information",
  allowNullBody: true,
  operation: async (body, session, request) => {
    const input = method === "DELETE" ? taskReadQuery(request) : body;
    const { viewId, projectId: suppliedProjectId, title } = input ?? {};
    const projectId = method === "DELETE" && typeof suppliedProjectId === "string" && /^\d+$/.test(suppliedProjectId)
      ? Number(suppliedProjectId) : suppliedProjectId;
    if (typeof viewId !== "string" || !viewId.trim() ||
      (projectId !== undefined && (!Number.isSafeInteger(projectId) || projectId <= 0))) {
      return viewWriteJson({ message: "Missing required information" }, 400);
    }
    if (method === "POST" && (typeof title !== "string" || title.length < 2)) {
      return viewWriteJson({ message: "Title length too low!" }, 400);
    }
    const userId = session.userId;
    const where = {
      id: viewId,
      project_view: { ...(projectId !== undefined ? { projectId } : {}), project: savedViewBoardAccessWhere(userId) },
      OR: [{ visibility: "Public" as const }, { userId }],
    };
    const select = { id: true, project_view_id: true, project_view: { select: { id: true, projectId: true } } } as const;
    const notFound = () => viewWriteJson({ message: "View not found on this board" }, 404);
    try {
      const target = await prisma.view.findFirst({ where, select });
      if (!target) return notFound();
      const viewProjectId = target.project_view.projectId;
      const newSlug = method === "POST" ? await getUniqueSlug(target.project_view_id, title) : null;
      const result = await prisma.$transaction(async tx => {
        await acquireBoardFilterWriteLock(tx, viewProjectId);
        const current = await tx.view.findFirst({ where: { ...where, project_view_id: target.project_view_id }, select });
        if (!current) return null;
        await assertViewIsNotManagedSmartSplit(tx, viewProjectId, current.id);
        if (method === "POST") {
          return tx.view.update({ where: { ...where, id: current.id, project_view_id: target.project_view_id }, data: { title, slug: newSlug } });
        }
        const state = await tx.user_Project_View.findUnique({
          where: { user_project: { userId, project_view_id: current.project_view_id } },
        });
        if (state?.unsavedViewId && state.appliedViewId === current.id) {
          const draft = await tx.view.findFirst({ where: { id: state.unsavedViewId, userId, project_view_id: current.project_view_id } });
          if (draft) {
            await tx.view_Last_Used.deleteMany({ where: { viewId: draft.id } });
            await tx.view.delete({ where: { id: draft.id, userId, project_view_id: current.project_view_id, project_view: { project: savedViewBoardAccessWhere(userId) } } });
          }
        }
        await tx.view_Last_Used.deleteMany({ where: { viewId: current.id } });
        return tx.view.delete({ where: { ...where, id: current.id, project_view_id: target.project_view_id } });
      });
      if (!result) return notFound();
      const project_view_updated = await getProjectView(viewProjectId, userId);
      broadcastBoardChange(viewProjectId, { originUserId: userId });
      return viewWriteJson(method === "POST"
        ? { view: newSlug === null ? undefined : sanitizeViewBoardFilters(result), project_view_updated }
        : project_view_updated, 200);
    } catch (error) {
      if (error instanceof ManagedSmartSplitMutationError) return viewWriteJson({ message: error.message }, error.status);
      if ((error as { code?: string })?.code === "P2025") return notFound();
      return viewWriteJson(error, 500);
    }
  },
});

export const POST = route("POST");
export const DELETE: TaskWriteRoute = (request, session) =>
  route("DELETE")({ headers: request.headers, cookies: request.cookies, query: request.query, url: request.url, json: async () => undefined }, session);
