import { IProject, ISection, IView } from "@/models/model";
import {
  applyColumnVisibility,
  isColumnVisibleInView,
} from "@/utils/controllers/section/viewColumnVisibility";

/**
 * Client side of "Show in all views" / "Hide in all views" (HTPR-5937).
 * The same applyColumnVisibility the server writes with, so the optimistic
 * patch and the stored value cannot disagree.
 */

const unsavedViewId = (project?: IProject | null) =>
  project?.project_view?.user_project_views?.[0]?.unsavedView?.id;

/**
 * The views a person sees in the board's view strip: the board default view and
 * every named saved view, never the live "unsaved" working copy. Views the
 * column has no entry in count as hidden, which is how the board reads them.
 */
export const countViewsShowingColumn = (
  project: IProject | null | undefined,
  sectionId: number
): { visible: number; total: number } => {
  const skipId = unsavedViewId(project);
  const views = (project?.project_view?.allViews ?? []).filter(
    (view) => view.id !== skipId
  );
  return {
    visible: views.filter((view) =>
      isColumnVisibleInView(view.board_columns_view as ISection[], sectionId)
    ).length,
    total: views.length,
  };
};

const patchView = <T extends { board_columns_view?: unknown } | null | undefined>(
  view: T,
  section: ISection & { id: number },
  visible: boolean
): T =>
  view
    ? ({
        ...view,
        board_columns_view: applyColumnVisibility(
          view.board_columns_view as ISection[],
          section,
          visible
        ),
      } as T)
    : view;

/**
 * Every in-memory copy of this board's column lists after the switch. Patched
 * rather than refetched because refetching the board query remounts the command
 * tree and closes the column editor mid-action.
 */
export const applyColumnVisibilityToProject = (
  project: IProject,
  section: ISection & { id: number },
  visible: boolean
): IProject => {
  const projectView = project.project_view;
  if (!projectView) return project;
  const userProjectView = projectView.user_project_views?.[0];
  return {
    ...project,
    project_view: {
      ...projectView,
      default_view: patchView(projectView.default_view, section, visible),
      allViews: projectView.allViews?.map((view) =>
        patchView(view, section, visible)
      ) as IView[] | undefined,
      user_project_views: userProjectView
        ? [
            {
              ...userProjectView,
              appliedView: patchView(userProjectView.appliedView, section, visible),
              unsavedView: patchView(userProjectView.unsavedView, section, visible),
            },
            ...projectView.user_project_views.slice(1),
          ]
        : projectView.user_project_views,
    },
  };
};

/** "Visible in 6 of 10 saved views", or "Visible in all 10 saved views". */
export const describeViewsShowingColumn = ({
  visible,
  total,
}: {
  visible: number;
  total: number;
}): string => {
  if (total === 0) return "No saved views yet";
  if (total === 1) {
    return visible === 1 ? "Visible in the only saved view" : "Hidden in the only saved view";
  }
  if (visible === total) return `Visible in all ${total} saved views`;
  if (visible === 0) return `Hidden in all ${total} saved views`;
  return `Visible in ${visible} of ${total} saved views`;
};
