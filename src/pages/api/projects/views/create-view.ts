import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

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

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "POST") {
    try {
      const {
        projectId,
        view_settings,
        setAsDefault,
        viewTitle,
        visibility,
      } = req.body as TCreate_view_body;

      // HTPR-3997: authenticate from the session cookie, never trust a
      // client-supplied userId. Every sibling view route derives the user
      // from nookies_user; create-view was the odd one out.
      const userId = JSON.parse(req.cookies.nookies_user ?? "{}").id;

      var updatedProjectView;
      if (!Number.isInteger(userId)) {
        return res.status(401).json({ message: "Authentication required" });
      }
      if (!Number.isInteger(projectId)) {
        return res.status(400).json({ message: "Missing required information!" });
      }
      const accessibleProject = await prisma.project.findFirst({
        where: {
          id: projectId,
          OR: [
            { ownerId: userId },
            { members: { some: { userId, status: "Accepted" } } },
          ],
        },
        select: { id: true },
      });
      if (!accessibleProject) {
        return res.status(403).json({ message: "Board access required" });
      }
      // a view with no name is unfindable in Manage Views, so reject it here
      // (every client - UI, CLI, MCP - goes through this route).
      const title = viewTitle?.trim();
      if (!title)
        return res.status(400).json({ message: "View name is required!" });
      // lets check if its a new view or an old one.
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
          // ... data to create a Project_View
          projectId,
        },
        update: {
          // ... in case it already exists, update
        },
        where: {
          projectId,
          // ... the filter for the Project_View we want to update
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

      // HTPR-3836: views inherit column order from the board's default view,
      // not from whichever view happened to be on screen when saving.
      const defaultColumns = project_view.default_view
        ?.board_columns_view as ISection[] | null;
      const incomingColumns = view_settings.board_columns_view as
        | ISection[]
        | undefined;
      if (defaultColumns?.length && incomingColumns?.length) {
        const orderById = new Map(
          defaultColumns.map((col, index) => [col.id, index])
        );
        // stable sort: sections missing from the default view keep their relative order at the end
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

      // =============== new title means new view.
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
                // Preserve a saved "show archived" choice when the caller omits the field.
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
      // ========== add it against the user_project_view
      const user_Project_View = await prisma.user_Project_View.upsert({
        create: {
          // ... data to create a Project_View
          userId,
          project_view_id: project_view.id,
          appliedViewId: setAsDefault ? null : view.id,
        },
        update: {
          // ... in case it already exists, update
          userId,
          project_view_id: project_view.id,
          appliedViewId: setAsDefault ? null : view.id,
        },
        where: {
          user_project: {
            userId,
            project_view_id: project_view.id,
          },
          // ... the filter for the Project_View we want to update
        },
      });

      // ========== if there were any unsaved view, remove it.
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

      return res.status(200).json({
        view: setAsDefault ? undefined : newSlug ?? view.slug,
        project_view_updated,
      });
    } catch (error) {
      console.log(error);
      if (
        error instanceof MissingBoardFilterLabelError ||
        error instanceof ManagedSmartSplitMutationError
      ) {
        return res.status(error.status).json({ message: error.message });
      }
      return res.status(400).json({ message: JSON.stringify(error) });
    }
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
};

export default handler;
