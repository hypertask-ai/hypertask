// route = "/api/projects/views/update-view"
import prisma from "@/lib/prisma";
import { broadcastBoardChange } from "@/lib/realtime/server";
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
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

// ============= simple stuff here
// 1. user selects the default view.
// 2. so that means the applied view in user_project_view is now null.
// 3. LITERALLY THATS IT
const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "POST") {
    // lets check if the api request misses info like user, projectid.

    const { projectId, viewId, view_settings } = req.body;
    const layoutOnly = req.body.updateMode === "layout";
    const hasBoardLayout = Object.prototype.hasOwnProperty.call(
      view_settings ?? {},
      "board_layout"
    );

    const currentUser = JSON.parse(req.cookies.nookies_user ?? "{}");
    try {
      if (!projectId || !Number.isInteger(currentUser.id))
        return res
          .status(401)
          .json({ message: "Authentication required" });
      const targetView = await prisma.view.findFirst({
        where: {
          id: viewId,
          project_view: {
            projectId,
            project: {
              OR: [
                { ownerId: currentUser.id },
                {
                  members: {
                    some: { userId: currentUser.id, status: "Accepted" },
                  },
                },
              ],
            },
          },
          OR: [{ visibility: "Public" }, { userId: currentUser.id }],
        },
        select: { id: true },
      });
      if (!targetView) {
        return res.status(404).json({ message: "View not found on this board" });
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
          return res.status(400).json({ message: "Invalid board layout" });
        }
        await mutateView(undefined, async (tx) => {
          await tx.view.update({
            where: { id: viewId },
            data: { board_layout: boardLayout, lastUsedAt: new Date() },
          });
        });
        broadcastBoardChange(projectId, { originUserId: currentUser.id });
        return res.status(200).json({ viewId, board_layout: boardLayout });
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
          userId: currentUser.id,
          project_view_id: projectView.id,
          appliedViewId: updatedView.id,
        },
        update: {},
        where: {
          // ... the filter for the User_Project_View we want to update
          user_project: {
            userId: currentUser.id,
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
        currentUser.id
      );
      console.log(
        "🚀 ~ consthandler:NextApiHandler= ~ project_view_updated:",
        project_view_updated
      );
      broadcastBoardChange(viewProjectId, { originUserId: currentUser.id });

      return res.status(200).json(project_view_updated);
    } catch (error) {
      console.log("🚀 ~ consthandler:NextApiHandler= ~ error:", error);
      if (
        error instanceof MissingBoardFilterLabelError ||
        error instanceof ManagedSmartSplitMutationError
      ) {
        return res.status(error.status).json({ message: error.message });
      }
      return res.status(500).json(error);
    }
  }
};

export default handler;
