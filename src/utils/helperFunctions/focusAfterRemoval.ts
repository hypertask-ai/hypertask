
type FocusSection = { items: { id: number }[] };

export function focusCandidates(
  items: { id: number }[] | undefined,
  removedIndex: number,
): number[] {
  const list = items ?? [];
  const last = list.length - 1;
  const from = removedIndex >= 0 && removedIndex <= last ? removedIndex : last;
  const below = list.slice(from + 1).map((item) => item.id);
  const above = list.slice(0, Math.max(from, 0)).reverse().map((item) => item.id);
  return [...below, ...above];
}

export function focusFirstRenderedCard(
  candidateIds: number[],
  column: () => HTMLElement | null,
): number | null {
  for (const id of candidateIds) {
    const card = globalThis.document?.getElementById(`task-${id}`);
    if (card && card.getClientRects().length > 0) {
      card.focus({ preventScroll: true });
      return id;
    }
  }
  column()?.focus({ preventScroll: true });
  return null;
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
