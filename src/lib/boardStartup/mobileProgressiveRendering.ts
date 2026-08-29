export type ProgressiveTaskRenderMode = "skeleton" | "placeholder" | "task";

export const shouldWarmInitialBoardTasks = ({
  isMobile,
  progressiveRendering,
  sectionNearViewport,
}: {
  isMobile: boolean;
  progressiveRendering: boolean;
  sectionNearViewport: boolean;
}) => !isMobile || !progressiveRendering || sectionNearViewport;

export const getProgressiveTaskRenderMode = ({
  isMobile,
  taskModuleReady,
  taskModuleFailed,
  shouldRenderTask,
}: {
  isMobile: boolean;
  taskModuleReady: boolean;
  taskModuleFailed: boolean;
  shouldRenderTask: boolean;
}): ProgressiveTaskRenderMode => {
  // Preserve the existing desktop loading state. Only mobile large boards may
  // show lightweight titled placeholders before the card module is ready.
  if (!isMobile && !taskModuleReady && !taskModuleFailed) return "skeleton";
  if (taskModuleFailed || !shouldRenderTask) return "placeholder";
  if (!taskModuleReady) return "skeleton";
  return "task";
};

export const getMobileSectionObserverOptions = (
  horizontalScroller: Element | null,
): IntersectionObserverInit => ({
  root: horizontalScroller,
  rootMargin: "0px 160px",
});
