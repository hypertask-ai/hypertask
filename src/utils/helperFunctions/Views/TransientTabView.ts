type BaseView = {
  id: string;
  userId: number;
  visibility: "Public" | "Private";
};

type ProjectViewResponse = {
  id: string;
  allViews?: Array<Record<string, unknown>>;
  user_project_views: Array<Record<string, unknown>>;
};

export function canUseViewAsTabBase(
  view: BaseView,
  currentUserId: number,
) {
  return view.visibility === "Public" || view.userId === currentUserId;
}

export function shouldUseTransientTabSettings(
  hasBaseViewId: boolean,
  requestedBaseViewId: string | null | undefined,
  appliedViewId: string | null | undefined,
) {
  return (
    hasBaseViewId &&
    (requestedBaseViewId ?? null) !== (appliedViewId ?? null)
  );
}

export function applyTransientTabSettings(
  projectView: ProjectViewResponse,
  currentUserId: number,
  baseView: Record<string, unknown> | null,
  settings: Record<string, unknown>,
  isDirty: boolean,
) {
  const existing = projectView.user_project_views[0];
  const persistedUnsavedId = existing?.unsavedViewId;
  const transientId = `tab-unsaved:${baseView?.id ?? "default"}`;
  const transientView = isDirty
    ? {
        id: transientId,
        userId: currentUserId,
        createdAt: new Date(0),
        visibility: "Private",
        title: null,
        slug: null,
        project_view_id: projectView.id,
        ViewLastUsed: [],
        ...settings,
      }
    : undefined;

  const row = {
    ...(existing || {}),
    id: existing?.id ?? `tab-user-project:${currentUserId}`,
    userId: currentUserId,
    project_view_id: projectView.id,
    appliedViewId: baseView?.id,
    appliedView: baseView || undefined,
    unsavedViewId: transientView?.id,
    unsavedView: transientView,
  };

  return {
    ...projectView,
    ...(projectView.allViews
      ? {
          allViews: projectView.allViews.filter(
            (view) => view.id !== persistedUnsavedId,
          ),
        }
      : {}),
    user_project_views: [
      row,
      ...projectView.user_project_views.slice(1),
    ],
  };
}
