import { z } from "zod";
import { taskWriteRoute } from "@/lib/api/task-writes/route";
import { viewWriteJson } from "./response";
import { loadSessionUserRecord } from "@/lib/auth/sessionUserRecord";
import prisma from "@/lib/prisma";
import { broadcastBoardChange } from "@/lib/realtime/server";
import {
  isBoardEmptySectionSetting,
  PERSONAL_EMPTY_SECTIONS_UPDATE_MODE,
} from "@/models/Views/model";
import getProjectView from "@/utils/controllers/projects/views/viewsHelperAPIfunctions";
import { sanitizeBoardFilters } from "@/utils/helperFunctions/Views/BoardFilterSanitizer";
import { sanitizeBoardLayout, sanitizeTableSort } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import {
  assertViewIsNotManagedSmartSplit,
  ManagedSmartSplitMutationError,
  MissingBoardFilterLabelError,
  withBoardFilterWriteLock,
} from "@/utils/controllers/projects/views/boardFilterWriteLock";
import { Prisma } from "@prisma/client";

// ============= simple stuff here
// 1. user selects the default view.
// 2. so that means the applied view in user_project_view is now null.
// 3. LITERALLY THATS IT

const route = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Missing required information",
  allowNullBody: true,
  prepare: session => loadSessionUserRecord(session.userId),
  operation: async (body, currentUser) => {
    const req = { body };
    const userId = currentUser.id;

    // lets check if the api request misses info like user, projectid.

    const { projectId, viewId, view_settings } = req.body;
    const layoutOnly = req.body.updateMode === "layout";
    const personalEmptySectionsOnly =
      req.body.updateMode === PERSONAL_EMPTY_SECTIONS_UPDATE_MODE;
    const hasBoardLayout = Object.prototype.hasOwnProperty.call(
      view_settings ?? {},
      "board_layout"
    );

    try {
      if (!projectId)
        return viewWriteJson({ message: "Authentication required" }, 401);
      const targetView = await prisma.view.findFirst({
        where: {
          id: viewId,
          project_view: {
            projectId,
            project: {
              OR: [
                { ownerId: userId },
                {
                  members: {
                    some: { userId: currentUser.id, agentId: null, status: "Accepted" },
                  },
                },
              ],
            },
          },
          OR: [{ visibility: "Public" }, { userId: userId }],
        },
        select: { id: true },
      });
      if (!targetView) {
        return viewWriteJson({ message: "View not found on this board" }, 404);
      }
      if (personalEmptySectionsOnly) {
        const boardEmptySections = view_settings?.board_empty_sections;
        if (!isBoardEmptySectionSetting(boardEmptySections)) {
          return viewWriteJson({ message: "Invalid empty column visibility" }, 400);
        }
        await prisma.view_Last_Used.upsert({
          create: {
            userId: userId,
            viewId,
            board_empty_sections: boardEmptySections,
          },
          update: {
            board_empty_sections: boardEmptySections,
          },
          where: {
            user_view_last_used: {
              userId: userId,
              viewId,
            },
          },
        });
        return viewWriteJson({
          viewId,
          board_empty_sections: boardEmptySections,
        }, 200);
      }
      const mutateView = <T>(
        boardFilters: unknown,
        operation: (tx: Prisma.TransactionClient) => Promise<T>,
      ) => withBoardFilterWriteLock(
        projectId,
        boardFilters,
        async (tx) => {
          await assertViewIsNotManagedSmartSplit(tx, projectId, viewId);
          return operation(tx);
        },
      );
      if (layoutOnly) {
        const requestedLayout = view_settings?.board_layout;
        const boardLayout = sanitizeBoardLayout(requestedLayout);
        if (requestedLayout !== null && boardLayout === null) {
          return viewWriteJson({ message: "Invalid board layout" }, 400);
        }
        await mutateView(undefined, async (tx) => {
          await tx.view.update({
            where: { id: viewId },
            data: { board_layout: boardLayout, lastUsedAt: new Date() },
          });
        });
        broadcastBoardChange(projectId, { originUserId: userId });
        return viewWriteJson({ viewId, board_layout: boardLayout }, 200);
      }
      const projectView = await prisma.project_View.upsert({
        create: {
          // ... data to create a User_Project_View
          projectId,
        },
        update: {
          // ... in case it already exists, update
        },
        where: {
          projectId,
          // ... the filter for the User_Project_View we want to update
        },
      });

      const currentDate = new Date();
      const sanitizedTableSort = sanitizeTableSort(
        view_settings.table_sort_column,
        view_settings.table_sort_direction
      );
      const sanitizedBoardFilters = sanitizeBoardFilters(view_settings.board_filters);
      const updatedView = await mutateView(
        sanitizedBoardFilters,
        async (tx) => {
          return tx.view.update({
            where: {
              id: viewId,
            },
            include: {
              project_view: { select: { projectId: true } },
            },
            data: {
              board_columns_view: view_settings.board_columns_view,
              board_filters: sanitizedBoardFilters,
              board_sorting_mode: view_settings.board_sorting_mode,
              board_sorting_order: view_settings.board_sorting_order,
              // Only write the stack when the caller actually sent one. Defaulting to [] would let any
              // partial update (a filter-only save) silently wipe a view's tie-break levels.
              ...(view_settings.board_sorting_stack === undefined
                ? {}
                : { board_sorting_stack: view_settings.board_sorting_stack ?? [] }),
              board_subtask_setting: view_settings.board_subtask_setting,
              board_empty_sections: view_settings.board_empty_sections,
              board_staleness: view_settings.board_staleness ?? null,
              // Same reason as the sorting stack: a filter-only save omits this field, and
              // defaulting to null would wipe a view's saved "show archived" choice.
              ...(view_settings.board_show_archived === undefined
                ? {}
                : { board_show_archived: view_settings.board_show_archived ?? null }),
              table_sort_column: sanitizedTableSort.column,
              table_sort_direction: sanitizedTableSort.direction,
              ...(hasBoardLayout
                ? { board_layout: sanitizeBoardLayout(view_settings.board_layout) }
                : {}),
              lastUsedAt: currentDate,
            },
          });
        }
      );

      await prisma.view_Last_Used.upsert({
        create: {
          userId: updatedView.userId,
          viewId: viewId,
          lastUsedAt: currentDate,
        },
        update: {
          lastUsedAt: currentDate,
        },
        where: {
          user_view_last_used: {
            userId: updatedView.userId,
            viewId: viewId,
          },
        },
      });

      const updatedUserProjectView = await prisma.user_Project_View.upsert({
        create: {
          // ... data to create a User_Project_View
          userId: userId,
          project_view_id: projectView.id,
          appliedViewId: updatedView.id,
        },
        update: {},
        where: {
          // ... the filter for the User_Project_View we want to update
          user_project: {
            userId: userId,
            project_view_id: projectView.id,
          },
        },
      });
      if (updatedUserProjectView.unsavedViewId)
        await prisma.view.delete({
          where: {
            id: updatedUserProjectView.unsavedViewId,
          },
        });
      console.log(
        "🚀 ~ consthandler:NextApiHandler= ~ updatedView:",
        updatedView
      );
      const viewProjectId = updatedView.project_view.projectId;
      const project_view_updated = await getProjectView(
        viewProjectId,
        userId
      );
      console.log(
        "🚀 ~ consthandler:NextApiHandler= ~ project_view_updated:",
        project_view_updated
      );
      broadcastBoardChange(viewProjectId, { originUserId: userId });

      return viewWriteJson(project_view_updated, 200);
    } catch (error) {
      console.log("🚀 ~ consthandler:NextApiHandler= ~ error:", error);
      if (
        error instanceof MissingBoardFilterLabelError ||
        error instanceof ManagedSmartSplitMutationError
      ) {
        return viewWriteJson({ message: error.message }, error.status);
      }
      return viewWriteJson(error, 500);
    }

  },
});

export const POST = route;
