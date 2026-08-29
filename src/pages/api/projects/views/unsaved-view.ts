// route = "/api/projects/views/unsaved-view"
import prisma from "@/lib/prisma";
import getProjectView from "@/utils/controllers/projects/views/viewsHelperAPIfunctions";
import { isDeepEqual } from "@/utils/helperFunctions/helperFunctions";
import { sanitizeBoardFilters } from "@/utils/helperFunctions/Views/BoardFilterSanitizer";
import { defaultEmptySections } from "@/utils/helperFunctions/Views/EmptySectionsHelperFunction";
import { defaultFilterSettings } from "@/utils/helperFunctions/Views/FilterHelperFunctions";
import { defaultSubtaskSettings } from "@/utils/helperFunctions/Views/SubtaskHelperFunction";
import {
  applyTransientTabSettings,
  canUseViewAsTabBase,
} from "@/utils/helperFunctions/Views/TransientTabView";
import {
  defaultBoardSortingOrder,
  defaultBoardSortingSettings,
  getSavedBoardLayoutFromActiveView,
  resolveBoardLayoutRequest,
  resolveShowArchivedRequest,
  sanitizeBoardLayout,
  sanitizeTableSort,
} from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import {
  MissingBoardFilterLabelError,
  withBoardFilterWriteLock,
} from "@/utils/controllers/projects/views/boardFilterWriteLock";

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

    const {
      projectId,
      board_columns_view,
      board_sorting_mode,
      board_filters,
      board_subtask_setting,
      board_sorting_order,
      board_sorting_stack,
      board_empty_sections,
      board_staleness,
      table_sort_column,
      table_sort_direction,
      baseViewId,
    } = req.body;
    const hasBaseViewId = Object.prototype.hasOwnProperty.call(
      req.body,
      "baseViewId"
    );
    const currentUser = JSON.parse(req.cookies.nookies_user ?? "{}");
    if (!Number.isInteger(currentUser.id)) {
      return res.status(401).json({ message: "Authentication required" });
    }
    if (!Number.isInteger(projectId)) {
      return res.status(400).json({ message: "Missing required information!" });
    }
    const sanitizedBoardFilters = sanitizeBoardFilters(board_filters);
    const sanitizedTableSort = sanitizeTableSort(
      table_sort_column,
      table_sort_direction
    );
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { ownerId: currentUser.id },
          {
            members: {
              some: { userId: currentUser.id, status: "Accepted" },
            },
          },
        ],
      },
      include: { section: true },
    });
    if (!project) {
      return res.status(403).json({ message: "Board access required" });
    }
    const superDefault = {
      board_columns_view: project?.section ?? [],
      board_filters: defaultFilterSettings,
      board_sorting_mode: defaultBoardSortingSettings,
      board_sorting_order: defaultBoardSortingOrder,
      board_sorting_stack: [],
      board_subtask_setting: defaultSubtaskSettings,
      board_empty_sections: defaultEmptySections,
      board_staleness: null,
      board_show_archived: null,
      table_sort_column: null,
      table_sort_direction: null,
      board_layout: null,
    };
    try {
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
        include: {
          default_view: true,
        },
      });
      console.log(
        "🚀 ~ consthandler:NextApiHandler= ~ projectView:",
        projectView
      );

      const user_project_view = await prisma.user_Project_View.findUnique({
        where: {
          user_project: {
            userId: currentUser.id,
            project_view_id: projectView.id,
          },
        },
        include: {
          appliedView: true,
          unsavedView: true,
        },
      });
      console.log("🚀 ~ 55: ~ user_project_view:", user_project_view);

      const baseView = hasBaseViewId
        ? baseViewId == null
          ? projectView.default_view
          : await prisma.view.findFirst({
              where: { id: baseViewId, project_view_id: projectView.id },
            })
        : null;
      if (
        hasBaseViewId &&
        baseViewId != null &&
        (!baseView || !canUseViewAsTabBase(baseView, currentUser.id))
      ) {
        return res.status(403).json({ message: "View is not accessible" });
      }

      // Older clients do not send board_layout. Preserve the tab/base layout
      // in that case; only an explicit null means "inherit browser".
      const inheritedBoardLayout = hasBaseViewId
        ? sanitizeBoardLayout(baseView?.board_layout)
        : getSavedBoardLayoutFromActiveView({
            unsavedView: user_project_view?.unsavedView,
            appliedView: user_project_view?.appliedView,
            defaultView: projectView.default_view,
          });
      const resolvedBoardLayout = resolveBoardLayoutRequest(
        req.body,
        inheritedBoardLayout
      );
      // Same reason as board_layout: a partial caller (an older bundle, a
      // filter-only save) omits board_show_archived, and coalescing to null
      // would drop the view's pinned "show archived" choice (HTPR-5540).
      const inheritedShowArchived = hasBaseViewId
        ? baseView?.board_show_archived ?? null
        : user_project_view?.unsavedView?.board_show_archived ??
          user_project_view?.appliedView?.board_show_archived ??
          projectView.default_view?.board_show_archived ??
          null;
      const resolvedShowArchived = resolveShowArchivedRequest(
        req.body,
        inheritedShowArchived
      );
      const settingsFromReqBody = {
        board_columns_view,
        board_sorting_mode,
        board_filters: sanitizedBoardFilters,
        board_subtask_setting,
        board_sorting_order,
        board_sorting_stack: board_sorting_stack ?? [],
        board_empty_sections,
        board_staleness: board_staleness ?? null,
        board_show_archived: resolvedShowArchived,
        table_sort_column: sanitizedTableSort.column,
        table_sort_direction: sanitizedTableSort.direction,
        board_layout: resolvedBoardLayout,
      };

      // URL-aware clients keep unsaved settings in this tab's query cache.
      // Persisting them through User_Project_View would give every tab one
      // shared slot, so editing view B could erase view A's unsaved filters.
      // Explicit Save View calls persist the settings through create/update.
      if (hasBaseViewId) {
        const comparisonSettings = baseView
          ? {
              board_columns_view: baseView.board_columns_view,
              board_filters: sanitizeBoardFilters(baseView.board_filters),
              board_sorting_mode: baseView.board_sorting_mode,
              board_sorting_order: baseView.board_sorting_order,
              board_sorting_stack: baseView.board_sorting_stack ?? [],
              board_subtask_setting: baseView.board_subtask_setting,
              board_empty_sections: baseView.board_empty_sections,
              board_staleness: baseView.board_staleness,
              board_show_archived: baseView.board_show_archived,
              table_sort_column: baseView.table_sort_column,
              table_sort_direction: baseView.table_sort_direction,
              board_layout: sanitizeBoardLayout(baseView.board_layout),
            }
          : superDefault;
        const projectViewResponse = await getProjectView(
          projectId,
          currentUser.id
        );
        if (!projectViewResponse) {
          return res.status(404).json({ message: "Project view not found" });
        }
        return res.status(200).json(
          applyTransientTabSettings(
            projectViewResponse,
            currentUser.id,
            baseViewId == null ? null : baseView,
            settingsFromReqBody,
            !isDeepEqual(settingsFromReqBody, comparisonSettings),
          )
        );
      }

      const resolvedAppliedViewId =
        hasBaseViewId && baseViewId != null && baseView ? baseView.id : null;

      // =========== creates a new view and adds it against unsaved.
      const createUnsavedViewHandler = async (
        project_view_id: string,
        user_Project_ViewId: string
      ) => {
        const unsavedViewCreated = await withBoardFilterWriteLock(projectId, sanitizedBoardFilters, (tx) => tx.view.create({
          data: {
            userId: currentUser.id,
            project_view_id: project_view_id,
            board_columns_view,
            board_sorting_mode,
            board_sorting_order,
            board_sorting_stack: board_sorting_stack ?? [],
            board_subtask_setting,
            board_filters: sanitizedBoardFilters,
            board_empty_sections,
            board_staleness: board_staleness ?? null,
            board_show_archived: resolvedShowArchived,
            table_sort_column: sanitizedTableSort.column,
            table_sort_direction: sanitizedTableSort.direction,
            board_layout: resolvedBoardLayout,
            visibility: "Private",
          },
        }));
        const updated_user_project_view = await prisma.user_Project_View.update(
          {
            where: {
              id: user_Project_ViewId,
            },
            data: {
              unsavedViewId: unsavedViewCreated.id,
              ...(hasBaseViewId
                ? { appliedViewId: resolvedAppliedViewId }
                : {}),
            },
            include: {
              unsavedView: true,
              appliedView: true,
            },
          }
        );
        return {
          unsavedViewCreated,
          updated_user_project_view,
        };
      };

      // ================ if NEW USER_PROJECT_VIEW,
      if (!user_project_view) {
        console.log(
          "------------------------ need to create anew user_project_view ------------ "
        );
        const user_project_view = await createUserProjectView(
          currentUser.id,
          projectView.id
        );

        // that means it has no applied view or unsaved, so the first one is the unsaved anyways.
        const { unsavedViewCreated, updated_user_project_view } =
          await createUnsavedViewHandler(
            user_project_view.project_view_id,
            user_project_view.id
          );
        console.log(
          "🚀 ~ consthandler:NextApiHandler= ~ updated_user_project_view:",
          updated_user_project_view
        );
        console.log(
          "🚀 ~ consthandler:NextApiHandler= ~ unsavedViewCreated:",
          unsavedViewCreated
        );
      }
      // if the user_project_view already exists, we need to check if
      // it already has unsaved changes.
      else {
        console.log(
          "------------------------ user_project_view already exists,------------ "
        );
        console.log("🚀 ~  user_project_view:", user_project_view);
        // ============== if there are NO unsaved changes, means we need to ADD it, for sure.
        // also if the settings are same as the actual default then don't bother please
        if (!user_project_view.unsavedView) {
          const { updated_user_project_view, unsavedViewCreated } =
            await createUnsavedViewHandler(
              user_project_view.project_view_id,
              user_project_view.id
            );
          console.log(
            "🚀 ~ consthandler:NextApiHandler= ~ updated_user_project_view:",
            updated_user_project_view
          );
          console.log(
            "🚀 ~ consthandler:NextApiHandler= ~ unsavedViewCreated:",
            unsavedViewCreated
          );
        }

        // ============= if there ARE previous unsaved changes
        // unsavedView IS PRESENT
        // then we need to check if the incoming changes are equal to the previously saved.
        // first check if there's an applied view at all.
        else {
          var shouldDeleteUnsaved: boolean = false;

          const comparisonView = hasBaseViewId
            ? baseView
            : user_project_view.appliedView ?? projectView.default_view;

          // New clients compare against their URL-pinned base. Old clients retain the stored applied/default chain.
          if (comparisonView) {
            console.log("============== checking for equality in appliedView");
            const settingsFromDB = {
              board_columns_view: comparisonView.board_columns_view,
              board_filters: sanitizeBoardFilters(
                comparisonView.board_filters
              ),
              board_sorting_mode: comparisonView.board_sorting_mode,
              board_sorting_order: comparisonView.board_sorting_order,
              board_sorting_stack:
                comparisonView.board_sorting_stack ?? [],
              board_subtask_setting: comparisonView.board_subtask_setting,
              board_empty_sections: comparisonView.board_empty_sections,
              board_staleness: comparisonView.board_staleness,
              board_show_archived: comparisonView.board_show_archived,
              table_sort_column: comparisonView.table_sort_column,
              table_sort_direction: comparisonView.table_sort_direction,
              board_layout: sanitizeBoardLayout(comparisonView.board_layout),
            };

            // ... check equality
            if (isDeepEqual(settingsFromReqBody, settingsFromDB))
              shouldDeleteUnsaved = true;
            // if equality found, toggle the boolean to true
          } else {
            console.log(
              "there is no default view, so lets compare with defaults. \n"
            );

            if (isDeepEqual(superDefault, settingsFromReqBody))
              shouldDeleteUnsaved = true;

            // --------- check if there's even an unsaved view
          }

          //===================== if by then, no equality has been found, we're safe to update the unsaved view.
          if (!shouldDeleteUnsaved && user_project_view.unsavedView) {
            console.log(
              "============== no equality found, updating the previous unsaved"
            );
            const unsavedViewId = user_project_view.unsavedView.id;
            // ... update the unsaved view.
            const updatedView = await withBoardFilterWriteLock(projectId, sanitizedBoardFilters, (tx) => tx.view.update({
              where: {
                id: unsavedViewId,
              },
              data: {
                board_columns_view,
                board_sorting_mode,
                board_filters: sanitizedBoardFilters,
                board_subtask_setting,
                board_sorting_order,
                board_sorting_stack: board_sorting_stack ?? [],
                board_empty_sections,
                board_staleness: board_staleness ?? null,
                board_show_archived: resolvedShowArchived,
                table_sort_column: sanitizedTableSort.column,
                table_sort_direction: sanitizedTableSort.direction,
                board_layout: resolvedBoardLayout,
              },
            }));

            console.log(
              "🚀 ~ consthandler:NextApiHandler= ~ updatedView:",
              updatedView
            );
            await prisma.user_Project_View.update({
              where: {
                id: user_project_view.id,
              },
              data: {
                unsavedViewId: updatedView.id,
                ...(hasBaseViewId
                  ? { appliedViewId: resolvedAppliedViewId }
                  : {}),
              },
              include: {
                unsavedView: true,
                appliedView: true,
              },
            });
          }
          // ==================== equality found.
          else if (shouldDeleteUnsaved && user_project_view.unsavedViewId) {
            console.log(
              "*==================* found equality. lets delete the view: ",
              user_project_view.unsavedViewId
            );
            if (hasBaseViewId) {
              await prisma.user_Project_View.update({
                where: { id: user_project_view.id },
                data: {
                  unsavedViewId: null,
                  appliedViewId: resolvedAppliedViewId,
                },
              });
            }
            const deletedView = await prisma.view.delete({
              where: { id: user_project_view.unsavedViewId },
            });
            console.log(
              "🚀 ~ consthandler:NextApiHandler= ~ deletedView:",
              deletedView
            );
          }
          console.log("-============ equality variable ", shouldDeleteUnsaved);
        }
      }

      const project_view_updated = await getProjectView(
        projectId,
        currentUser.id
      );
      return res.status(200).json(project_view_updated);
    } catch (error) {
      console.log("🚀 ~ consthandler:NextApiHandler= ~ error:", error);
      if (error instanceof MissingBoardFilterLabelError) {
        return res.status(error.status).json({ message: error.message });
      }
      return res.status(500).json(error);
    }
  }
};

export default handler;

const createUserProjectView = async (
  userId: number,
  project_view_id: string
) => {
  const res = await prisma.user_Project_View.create({
    data: {
      userId,
      project_view_id,
    },
  });
  return res;
};
