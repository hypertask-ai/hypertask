export interface PhoneNewTaskViewport {
  layoutHeight: number;
  visibleHeight: number;
  bottomInset: number;
}

export interface PhoneNewTaskViewportOffsets {
  top: string;
  keyboard: string;
  keyboardOpen: boolean;
}

const finiteNonNegative = (value: number) =>
  Number.isFinite(value) ? Math.max(0, value) : 0;

export const PHONE_NEW_TASK_SHORT_VIEWPORT_PX = 640;

export function phoneNewTaskShortSheet(
  viewport: PhoneNewTaskViewport | null,
): boolean {
  if (!viewport) return false;
  const visibleHeight = finiteNonNegative(viewport.visibleHeight);
  const keyboard = finiteNonNegative(viewport.bottomInset);
  if (keyboard > 0) return true;
  return visibleHeight > 0 && visibleHeight <= PHONE_NEW_TASK_SHORT_VIEWPORT_PX;
}

export function phoneNewTaskViewportOffsets(
  viewport: PhoneNewTaskViewport | null,
): PhoneNewTaskViewportOffsets {
  if (!viewport) return { top: "0px", keyboard: "0px", keyboardOpen: false };
  const layoutHeight = finiteNonNegative(viewport.layoutHeight);
  const visibleHeight = finiteNonNegative(viewport.visibleHeight);
  const keyboard = finiteNonNegative(viewport.bottomInset);
  if (keyboard <= 0) return { top: "0px", keyboard: "0px", keyboardOpen: false };
  const top = Math.max(0, layoutHeight - visibleHeight - keyboard);
  return {
    top: `${top}px`,
    keyboard: `${keyboard}px`,
    keyboardOpen: true,
  };
}
