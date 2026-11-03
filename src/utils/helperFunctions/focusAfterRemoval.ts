
type FocusSection = { items: { id: number }[] };

export function focusCardNextTo(column: HTMLElement | null, removedId: number): number | null {
  if (!column) return null;
  const cards = Array.from(column.querySelectorAll<HTMLElement>('[id^="task-"]')).filter(
    (card) => /^task-\d+$/.test(card.id) && card.getClientRects().length > 0,
  );
  const removedIndex = cards.findIndex((card) => card.id === `task-${removedId}`);
  const order =
    removedIndex >= 0
      ? [...cards.slice(removedIndex + 1), ...cards.slice(0, removedIndex).reverse()]
      : cards;
  const target = order[0];
  if (!target) {
    column.focus({ preventScroll: true });
    return null;
  }
  target.focus({ preventScroll: true });
  return Number(target.id.slice("task-".length));
}

export function keepBoardFocus(attempt = 0): void {
  setTimeout(() => {
    const doc = globalThis.document;
    const active = doc?.activeElement as HTMLElement | null;
    const focusLost = !active || active === doc?.body || active.id === "body-layout";
    if (!focusLost) return;
    const container = doc?.getElementById("sectionsContainer");
    if (!container) return;
    container.setAttribute("tabindex", "-1");
    container.focus({ preventScroll: true });
    if (doc?.activeElement !== container && attempt < 10) keepBoardFocus(attempt + 1);
  }, 50);
}

export function nextFocusAfterRemoval(
  sections: FocusSection[],
  sectionIndex: number,
  removedIndex: number,
  scope: "board" | "column" = "board",
): number | null {
  const items = sections?.[sectionIndex]?.items;

  if (items && items.length > 1) {
    if (removedIndex >= 0 && removedIndex < items.length) {
      const target =
        removedIndex >= items.length - 1
          ? items[items.length - 2]
          : items[removedIndex + 1];
      return target?.id ?? null;
    }
    return items[0]?.id ?? null;
  }

  if (scope === "column") return null;

  for (let d = 1; d < (sections?.length ?? 0); d++) {
    const right = sections[sectionIndex + d]?.items;
    if (right?.length) return right[0].id;
    const left = sections[sectionIndex - d]?.items;
    if (left?.length) return left[left.length - 1].id;
  }
  return null;
}
