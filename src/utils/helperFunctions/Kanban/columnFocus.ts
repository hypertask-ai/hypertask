// Where the keyboard focus sits inside a Kanban column.
//
// HTPR-5201: horizontal navigation reused `indexOf(document.activeElement)` on
// the focused element's parent. When nothing on the board holds real DOM focus
// (right after a modal closes, focus is on <body>), that index came from the
// <html> element's children and was meaningless. moveFocusToSection then treated
// it as a row number and, whenever the target column was shorter, fell back to
// the LAST card in it. Resolving to `undefined` instead keeps the normal
// "no row selected" path.

export const TASK_ELEMENT_ID_PREFIX = "task-";
export const COLUMN_LIST_ID_PREFIX = "tasks-list-";

export type FocusedCard = {
  elementId?: string | null;
  parentElementId?: string | null;
  indexInParent: number;
};

export function resolveFocusedCardIndex(
  focused: FocusedCard | null | undefined,
): number | undefined {
  if (!focused) return undefined;
  const { elementId, parentElementId, indexInParent } = focused;
  if (!elementId?.startsWith(TASK_ELEMENT_ID_PREFIX)) return undefined;
  if (!parentElementId?.startsWith(COLUMN_LIST_ID_PREFIX)) return undefined;
  if (!Number.isInteger(indexInParent) || indexInParent < 0) return undefined;
  return indexInParent;
}

export function focusedCardIndexInColumn(
  activeElement: Element | null,
): number | undefined {
  const parent = activeElement?.parentElement ?? null;
  if (!activeElement || !parent) return undefined;
  return resolveFocusedCardIndex({
    elementId: activeElement.id,
    parentElementId: parent.id,
    indexInParent: Array.from(parent.children).indexOf(activeElement),
  });
}
