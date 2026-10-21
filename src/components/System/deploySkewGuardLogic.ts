export type ReloadDecision = "reload" | "retry" | "skip";

export const isDeploySkewReloadEligiblePath = (pathname: string | null): boolean =>
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
