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

export function focusKanbanCard(card: HTMLElement | null): void {
  if (!card) return;
  card.focus({ preventScroll: true });
  const column = card.closest<HTMLElement>('[id^="droppable-section-container-"]');
  if (!column) return;
  const list = card.closest<HTMLElement>('[id^="tasks-list-"]');
  const view = card.ownerDocument.defaultView;
  const scroller =
    list && /^(auto|scroll)$/.test(view?.getComputedStyle(list).overflowY ?? "")
      ? list
      : column;
  const rect = scroller.getBoundingClientRect();
  let top = rect.top + scroller.clientTop;
  const bottom = top + scroller.clientHeight;
  const header = column.querySelector<HTMLElement>(".task-detail-heading-tag");
  if (header && view?.getComputedStyle(header).position === "sticky") {
    top = Math.max(top, header.getBoundingClientRect().bottom);
  }
  const cardRect = card.getBoundingClientRect();
  // A card taller than the viewport should not oscillate between its edges.
  const oversized = cardRect.bottom - cardRect.top > bottom - top;
  if (cardRect.top < top && cardRect.bottom > bottom) return;
  if (cardRect.top < top) {
    scroller.scrollTop += oversized ? cardRect.bottom - bottom : cardRect.top - top;
  } else if (cardRect.bottom > bottom) {
    scroller.scrollTop += oversized ? cardRect.top - top : cardRect.bottom - bottom;
  }
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
