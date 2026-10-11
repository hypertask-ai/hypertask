const INTERACTIVE_TARGET =
  "a, button, svg, img, video, audio, iframe, input, textarea, select, [role='button'], [role='link'], [role='menu'], [role='menuitem'], [role='dialog'], [data-task-detail-actions], [data-node-view-wrapper], [contenteditable='true']";

// React bubbles events from portals (emoji sheet, menus) through the comment,
// so only count presses that land inside the container itself.
export function isTaskDetailEditTarget(target: EventTarget | null, container?: EventTarget | null): boolean {
  if (!(target instanceof Element) || target.closest(INTERACTIVE_TARGET)) return false;
  return !(container instanceof Element) || container.contains(target);
}
