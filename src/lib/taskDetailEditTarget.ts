const INTERACTIVE_TARGET =
  "a, button, svg, img, video, audio, iframe, input, textarea, select, [role='button'], [role='link'], [role='menu'], [role='menuitem'], [role='dialog'], [data-task-detail-actions], [data-node-view-wrapper], [contenteditable='true']";

export function isTaskDetailEditTarget(target: EventTarget | null, container?: EventTarget | null): boolean {
  if (!(target instanceof Element) || target.closest(INTERACTIVE_TARGET)) return false;
  return !(container instanceof Element) || container.contains(target);
}
