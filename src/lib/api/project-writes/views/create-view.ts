import { z } from "zod";
import { taskWriteRoute } from "@/lib/api/task-writes/route";
import { viewWriteJson } from "./response";

import prisma from "@/lib/prisma";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { ISection } from "@/models/model";
import { TCreate_view_body } from "@/models/Views/model";
import getProjectView, { getUniqueSlug } from "@/utils/controllers/projects/views/viewsHelperAPIfunctions";
import { sanitizeBoardFilters } from "@/utils/helperFunctions/Views/BoardFilterSanitizer";
import { getBoardLayoutRequestUpdate, sanitizeBoardLayout, sanitizeTableSort } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import {
  assertViewIsNotManagedSmartSplit,
  ManagedSmartSplitMutationError,
  MissingBoardFilterLabelError,
  withBoardFilterWriteLock,
} from "@/utils/controllers/projects/views/boardFilterWriteLock";


const route = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Missing required information",
  allowNullBody: true,
  operation: async (body, session) => {
    const req = { body };
    const userId = session.userId;

    try {
      const {
        projectId,
        view_settings,
        setAsDefault,
        viewTitle,
        visibility,
      } = req.body as TCreate_view_body;


      var updatedProjectView;
      if (!Number.isInteger(projectId)) {
        return viewWriteJson({ message: "Missing required information!" }, 400);
      }
      const accessibleProject = await prisma.project.findFirst({
        where: {
          id: projectId,
          OR: [
            { ownerId: userId },
            { members: { some: { userId, agentId: null, status: "Accepted" } } },
          ],
        },
        select: { id: true },
      });
      if (!accessibleProject) {
        return viewWriteJson({ message: "Board access required" }, 403);
      }
      const title = viewTitle?.trim();
      if (!title)
        return viewWriteJson({ message: "View name is required!" }, 400);
      const viewPromise = prisma.view.findFirst({
        where: {
          title: { equals: title },
          project_view: {
            projectId,
          },
          ...(visibility === "Private"
            ? { userId, visibility: "Private" as const }
            : { OR: [{ visibility: "Public" as const }, { userId }] }),
        },
      });
      console.log(
        "🚀 ~ consthandler:NextApiHandler= ~ viewPromise:",
        viewPromise
      );
      const project_view_promise = prisma.project_View.upsert({
        create: {
          projectId,
        },
        update: {
        },
        where: {
          projectId,
        },
        include: {
          default_view: { select: { board_columns_view: true } },
        },
      });
      var [project_view, view] = await Promise.all([
        project_view_promise,
        viewPromise,
      ]);
      console.log("🚀 ~ consthandler:NextApiHandler= ~ view:", view);

      const defaultColumns = project_view.default_view
        ?.board_columns_view as ISection[] | null;
      const incomingColumns = view_settings.board_columns_view as
        | ISection[]
        | undefined;
      if (defaultColumns?.length && incomingColumns?.length) {
        const orderById = new Map(
          defaultColumns.map((col, index) => [col.id, index])
        );
        view_settings.board_columns_view = [...incomingColumns].sort(
          (a, b) =>
            (orderById.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
            (orderById.get(b.id) ?? Number.MAX_SAFE_INTEGER)
        );
      }
      const sanitizedTableSort = sanitizeTableSort(
        view_settings.table_sort_column,
        view_settings.table_sort_direction
      );
      const sanitizedBoardFilters = sanitizeBoardFilters(
        view_settings.board_filters
      );

      const currentDate = new Date();
      if (!view) {
        view = await withBoardFilterWriteLock(projectId, sanitizedBoardFilters, (tx) => tx.view.create({
          data: {
            title,
            project_view_id: project_view.id,
            userId,
            board_sorting_mode: view_settings.board_sorting_mode,
            board_sorting_order: view_settings.board_sorting_order,
            board_sorting_stack: view_settings.board_sorting_stack ?? [],
            board_filters: sanitizedBoardFilters,
            board_columns_view: view_settings.board_columns_view,
            board_subtask_setting: view_settings.board_subtask_setting,
            board_empty_sections: view_settings.board_empty_sections,
            board_staleness: view_settings.board_staleness ?? null,
            board_show_archived: view_settings.board_show_archived ?? null,
            table_sort_column: sanitizedTableSort.column,
            table_sort_direction: sanitizedTableSort.direction,
            board_layout: sanitizeBoardLayout(view_settings.board_layout),
            visibility,
            lastUsedAt: currentDate,
          },
        }));
      } else {
        const existingViewId = view.id;
        view = await withBoardFilterWriteLock(
          projectId,
          sanitizedBoardFilters,
          async (tx) => {
            await assertViewIsNotManagedSmartSplit(tx, projectId, existingViewId);
            return tx.view.update({
              where: { id: existingViewId },
              data: {
                board_sorting_mode: view_settings.board_sorting_mode,
                board_sorting_order: view_settings.board_sorting_order,
                board_sorting_stack: view_settings.board_sorting_stack ?? [],
                board_filters: sanitizedBoardFilters,
                board_columns_view: view_settings.board_columns_view,
                board_subtask_setting: view_settings.board_subtask_setting,
                board_empty_sections: view_settings.board_empty_sections,
                board_staleness: view_settings.board_staleness ?? null,
                ...(view_settings.board_show_archived === undefined
                  ? {}
                  : { board_show_archived: view_settings.board_show_archived ?? null }),
                table_sort_column: sanitizedTableSort.column,
                table_sort_direction: sanitizedTableSort.direction,
                ...getBoardLayoutRequestUpdate(view_settings),
                visibility,
                lastUsedAt: currentDate,
              },
            });
          }
        );
      }

      await prisma.view_Last_Used.upsert({
        create: {
          userId: userId,
          viewId: view.id,
          lastUsedAt: currentDate,
        },
        update: {
          lastUsedAt: currentDate,
        },
        where: {
          user_view_last_used: {
            userId: userId,
            viewId: view.id,
          },
        },
      });

      console.log("🚀 ~ consthandler:NextApiHandler= ~ view:", view);
      const user_Project_View = await prisma.user_Project_View.upsert({
        create: {
          userId,
          project_view_id: project_view.id,
          appliedViewId: setAsDefault ? null : view.id,
        },
        update: {
          userId,
          project_view_id: project_view.id,
          appliedViewId: setAsDefault ? null : view.id,
        },
        where: {
          user_project: {
            userId,
            project_view_id: project_view.id,
          },
        },
      });

      if (user_Project_View.unsavedViewId)
        await prisma.view.delete({
          where: { id: user_Project_View.unsavedViewId },
        });

      console.log(
        "🚀 ~ consthandler:NextApiHandler= ~ user_Project_View:",
        user_Project_View
      );

      if (setAsDefault) {
        updatedProjectView = await prisma.project_View.update({
          where: { projectId },
          data: {
            default_view_id: view.id,
          },
        });
      }

      let newSlug;
      if(!view.slug){
        newSlug = await getUniqueSlug(view.project_view_id, view.title)
        await prisma.view.update({
          where:{
            id: view.id,
          },
          data:{
            slug: newSlug
          }
        })
      }

      console.log(
        "🚀 ~ consthandler:NextApiHandler= ~ updatedProjectView:",
        updatedProjectView
      );
      const project_view_updated = await getProjectView(projectId, userId);
      broadcastBoardChange(projectId, { originUserId: userId });

      return viewWriteJson({
        view: setAsDefault ? undefined : newSlug ?? view.slug,
        project_view_updated,
      }, 200);
    } catch (error) {
      console.log(error);
      if (
        error instanceof MissingBoardFilterLabelError ||
        error instanceof ManagedSmartSplitMutationError
      ) {
        return viewWriteJson({ message: error.message }, error.status);
      }
      return viewWriteJson({ message: JSON.stringify(error) }, 400);
    }

  },
});

export const POST = route;
