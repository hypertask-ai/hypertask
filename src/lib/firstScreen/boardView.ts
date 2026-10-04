import type { IProject, IUserProjectView, IViewType } from "@/models/model";

export const getViewFromProject = (project?: any | null): IViewType | undefined=> {
  if (!project) return undefined
  const view = project.project_view?.user_project_views[0]
  const unsaved = view?.unsavedView
  const applied = view?.appliedView
  const defaultView = project.project_view?.default_view
  if(unsaved) return {view: unsaved, type: "Unsaved"};
  else if(applied) return {view: applied, type: "Applied"};
  else if(defaultView) return {view: defaultView, type: "Default"};
  return undefined
}


export function projectBoardFirstScreen(
  project: IProject,
  requestedSurface: unknown,
  browserLayout: "board" | "table",
  viewSlug?: string | null,
) {
  project = pinProjectViewToUrl(project, viewSlug);
  const selected = getViewFromProject(project);
  const saved = selected?.view.board_layout;
  const surface = requestedSurface === "board" || requestedSurface === "table"
    ? requestedSurface
    : saved === "Board" ? "board" : saved === "Table" ? "table" : browserLayout;
  const slug = selected?.type === "Applied"
    ? selected.view.slug
    : selected?.type === "Unsaved"
      ? project.project_view?.user_project_views[0]?.appliedView?.slug ?? "default"
      : "default";
  return { view: selected ?? null, slug, surface };
}

export const pinProjectViewToUrl = (project: IProject, viewSlug?: string | null) => {
  if (!viewSlug) return project
  const projectView = project.project_view
  const userProjectView = projectView?.user_project_views?.[0]
  const targetView = projectView?.allViews?.find((view) => view.slug === viewSlug)
  if (!projectView || (!targetView && viewSlug !== "default")) return project

  if (userProjectView) {
    const appliedOrDefaultView = userProjectView.appliedView ?? projectView.default_view
    // Tabs pinned to the same view intentionally share one unsaved working context.
    if (targetView && appliedOrDefaultView?.id === targetView.id) return project
    // A tab pinned to the default sentinel with no applied view is already on
    // the default base, so its unsaved overlay IS this tab's working context,
    // the same rule as pinning to a named view's own base above. Clearing it
    // hid the Save-view affordance after any sort/filter change on the default
    // view, because the URL always carries view=default there (HTPR-5900).
    if (
      !targetView &&
      !userProjectView.appliedView &&
      !userProjectView.appliedViewId
    ) return project
  }

  const isDefaultView = !targetView ||
    targetView.id === projectView.default_view_id ||
    targetView.id === projectView.default_view?.id
  // The synthesized row intentionally omits DB row fields consumers never read.
  const userProjectViewOverride = (
    userProjectView
      ? {
        ...userProjectView,
        appliedView: isDefaultView ? undefined : targetView,
        appliedViewId: isDefaultView ? undefined : targetView.id,
        unsavedView: undefined,
        unsavedViewId: undefined,
      }
      : {
        appliedView: isDefaultView ? undefined : targetView,
        appliedViewId: isDefaultView ? undefined : targetView.id,
        unsavedView: undefined,
        unsavedViewId: undefined,
      }
  ) as unknown as IUserProjectView
  const pinnedProject = {
    ...project,
    project_view: {
      ...projectView,
      user_project_views: [
        userProjectViewOverride,
        ...projectView.user_project_views.slice(1),
      ],
    },
  }

  return pinnedProject
}
