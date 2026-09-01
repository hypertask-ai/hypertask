export const BOARD_OVERVIEW_SCALE = 0.6;
export const BOARD_PINCH_THRESHOLD = 0.15;
export const MOBILE_TASK_DRAG_DELAY_MS = 900;
export const MOBILE_COLUMN_DRAG_DELAY_MS = 120;

export const getMobileDragDelay = (draggableId: string) =>
  draggableId.startsWith("task-")
    ? MOBILE_TASK_DRAG_DELAY_MS
    : MOBILE_COLUMN_DRAG_DELAY_MS;

export const setProjectBoardZoom = (
  current: Record<number, boolean>,
  projectId: number,
  zoomedOut: boolean,
) => ({ ...current, [projectId]: zoomedOut });

export const toggleProjectBoardZoom = (
  current: Record<number, boolean>,
  projectId: number,
) => setProjectBoardZoom(current, projectId, !(current[projectId] ?? false));

export const getPinchZoomState = ({
  zoomedOut,
  startDistance,
  currentDistance,
  touchCount,
}: {
  zoomedOut: boolean;
  startDistance: number;
  currentDistance: number;
  touchCount: number;
}) => {
  if (
    touchCount !== 2 ||
    !Number.isFinite(startDistance) ||
    !Number.isFinite(currentDistance) ||
    startDistance <= 0 ||
    currentDistance <= 0
  ) {
    return zoomedOut;
  }

  const ratio = currentDistance / startDistance;
  if (!zoomedOut && ratio <= 1 - BOARD_PINCH_THRESHOLD) return true;
  if (zoomedOut && ratio >= 1 + BOARD_PINCH_THRESHOLD) return false;
  return zoomedOut;
};
