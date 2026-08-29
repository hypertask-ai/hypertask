export type ReloadDecision = "reload" | "retry" | "skip";

// Boards are collaborative, continuously updating workspaces. Reloading one
// underneath the user after every deploy looks like a navigation loop and
// tears down its realtime subscription, so board tabs update only in place.
export const isDeploySkewReloadEligiblePath = (pathname: string | null): boolean =>
  // usePathname() is null before the router hydrates; treat that as a board
  // until proven otherwise, so an unknown route is never hard-reloaded.
  pathname !== null && pathname !== "/project" && !pathname.startsWith("/project/");

type SharedReloadState = {
  expectedVisibilityCycle: number;
  getVisibilityCycle: () => number;
  getVisibilityState: () => DocumentVisibilityState;
  isCancelled: () => boolean;
  isEditing: () => boolean;
  canReachOrigin: () => Promise<boolean>;
};

export async function decideHiddenReload(
  state: SharedReloadState,
): Promise<ReloadDecision> {
  if (state.getVisibilityState() !== "hidden" || state.isEditing()) {
    return "skip";
  }

  const reachable = await state.canReachOrigin();

  // A preflight result belongs only to the visibility cycle that started it.
  // visible -> hidden is a new cycle even if the final state is hidden.
  if (
    state.isCancelled() ||
    state.getVisibilityCycle() !== state.expectedVisibilityCycle ||
    state.getVisibilityState() !== "hidden" ||
    state.isEditing()
  ) {
    return "skip";
  }

  return reachable ? "reload" : "retry";
}

export async function decideIdleReload(
  state: SharedReloadState & {
    isIdle: () => boolean;
  },
): Promise<ReloadDecision> {
  if (
    state.getVisibilityState() !== "visible" ||
    state.isEditing() ||
    !state.isIdle()
  ) {
    return "skip";
  }

  const reachable = await state.canReachOrigin();

  if (
    !reachable ||
    state.isCancelled() ||
    state.getVisibilityCycle() !== state.expectedVisibilityCycle ||
    state.getVisibilityState() !== "visible" ||
    state.isEditing() ||
    !state.isIdle()
  ) {
    return "skip";
  }

  return "reload";
}
