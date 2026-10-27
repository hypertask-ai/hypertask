
type FocusSection = { items: { id: number }[] };

export function nextFocusAfterRemoval(
  sections: FocusSection[],
  sectionIndex: number,
  removedIndex: number,
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

  for (let d = 1; d < (sections?.length ?? 0); d++) {
    const right = sections[sectionIndex + d]?.items;
    if (right?.length) return right[0].id;
    const left = sections[sectionIndex - d]?.items;
    if (left?.length) return left[left.length - 1].id;
  }
  return null;
}
