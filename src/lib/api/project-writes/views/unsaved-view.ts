import { z } from "zod";
import { taskWriteRoute } from "@/lib/api/task-writes/route";
import { viewWriteJson } from "./response";
import { loadSessionUserRecord } from "@/lib/auth/sessionUserRecord";
import prisma from "@/lib/prisma";
import getProjectView from "@/utils/controllers/projects/views/viewsHelperAPIfunctions";
import { isDeepEqual } from "@/utils/helperFunctions/helperFunctions";
import { sanitizeBoardFilters, projectVisibleViewRelations } from "@/utils/helperFunctions/Views/BoardFilterSanitizer";
import { defaultEmptySections } from "@/utils/helperFunctions/Views/EmptySectionsHelperFunction";
import { defaultFilterSettings } from "@/utils/helperFunctions/Views/FilterHelperFunctions";
import { defaultSubtaskSettings } from "@/utils/helperFunctions/Views/SubtaskHelperFunction";
import {
  applyTransientTabSettings,
  canUseViewAsTabBase,
  shouldUseTransientTabSettings,
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
import {
  MissingBoardFilterLabelError,
  withBoardFilterWriteLock,
} from "@/utils/controllers/projects/views/boardFilterWriteLock";


const route = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Missing required information",
  allowNullBody: true,
  prepare: session => loadSessionUserRecord(session.userId),
  operation: async (body, currentUser) => {
    const req = { body };
    const userId = currentUser.id;


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
    if (!Number.isInteger(projectId)) {
      return viewWriteJson({ message: "Missing required information!" }, 400);
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
          { ownerId: userId },
          {
            members: {
              some: { userId: currentUser.id, agentId: null, status: "Accepted" },
            },
          },
        ],
      },
      include: { section: true },
    });
    if (!project) {
      return viewWriteJson({ message: "Board access required" }, 403);
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
      const loadedProjectView = await prisma.project_View.upsert({
        create: {
          projectId,
        },
        update: {
        },
        where: {
          projectId,
        },
        include: {
          default_view: true,
        },
      });
      console.log(
        "🚀 ~ consthandler:NextApiHandler= ~ projectView:",
        loadedProjectView
      );

      const loadedUserProjectView = await prisma.user_Project_View.findUnique({
        where: {
          user_project: {
            userId: userId,
            project_view_id: loadedProjectView.id,
          },
        },
        include: {
          appliedView: true,
          unsavedView: true,
        },
      });
      const projectView = projectVisibleViewRelations({
        ...loadedProjectView,
        user_project_views: loadedUserProjectView ? [loadedUserProjectView] : [],
      }, userId);
      const user_project_view = projectView.user_project_views[0] ?? null;
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
        (!baseView || !canUseViewAsTabBase(baseView, userId))
      ) {
        return viewWriteJson({ message: "View is not accessible" }, 403);
      }

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

      if (
        shouldUseTransientTabSettings(
          hasBaseViewId,
          baseViewId,
          user_project_view?.appliedViewId,
        )
      ) {
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
          userId
        );
        if (!projectViewResponse) {
          return viewWriteJson({ message: "Project view not found" }, 404);
        }
        return viewWriteJson(applyTransientTabSettings(
            projectViewResponse,
            userId,
            baseViewId == null ? null : baseView,
            settingsFromReqBody,
            !isDeepEqual(settingsFromReqBody, comparisonSettings),
          ), 200);
      }

      const resolvedAppliedViewId =
        hasBaseViewId && baseViewId != null && baseView ? baseView.id : null;

      const createUnsavedViewHandler = async (
        project_view_id: string,
        user_Project_ViewId: string
      ) => {
        const unsavedViewCreated = await withBoardFilterWriteLock(projectId, sanitizedBoardFilters, (tx) => tx.view.create({
          data: {
            userId: userId,
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

      if (!user_project_view) {
        console.log(
          "------------------------ need to create anew user_project_view ------------ "
        );
        const user_project_view = await createUserProjectView(
          userId,
          projectView.id
        );

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
      else {
        console.log(
          "------------------------ user_project_view already exists,------------ "
        );
        console.log("🚀 ~  user_project_view:", user_project_view);
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

        else {
          var shouldDeleteUnsaved: boolean = false;

          const comparisonView = hasBaseViewId
            ? baseView
            : user_project_view.appliedView ?? projectView.default_view;

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

            if (isDeepEqual(settingsFromReqBody, settingsFromDB))
              shouldDeleteUnsaved = true;
          } else {
            console.log(
              "there is no default view, so lets compare with defaults. \n"
            );

            if (isDeepEqual(superDefault, settingsFromReqBody))
              shouldDeleteUnsaved = true;
          }

          if (!shouldDeleteUnsaved && user_project_view.unsavedView) {
            console.log(
              "============== no equality found, updating the previous unsaved"
            );
            const unsavedViewId = user_project_view.unsavedView.id;
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
        userId
      );
      return viewWriteJson(project_view_updated, 200);
    } catch (error) {
      console.log("🚀 ~ consthandler:NextApiHandler= ~ error:", error);
      if (error instanceof MissingBoardFilterLabelError) {
        return viewWriteJson({ message: error.message }, error.status);
      }
      return viewWriteJson(error, 500);
    }

  },
});

export const POST = route;

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
