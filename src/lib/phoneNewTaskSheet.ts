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

export function phoneNewTaskViewportOffsets(
  viewport: PhoneNewTaskViewport | null,
): PhoneNewTaskViewportOffsets {
  if (!viewport) return { top: "0px", keyboard: "0px", keyboardOpen: false };
  const layoutHeight = finiteNonNegative(viewport.layoutHeight);
  const visibleHeight = finiteNonNegative(viewport.visibleHeight);
  const keyboard = finiteNonNegative(viewport.bottomInset);
  const top = Math.max(0, layoutHeight - visibleHeight - keyboard);
  return {
    top: `${top}px`,
    keyboard: `${keyboard}px`,
    keyboardOpen: keyboard > 0,
  };
}
