// PERT-5: pick the next logical task to focus after one leaves its column
// (deleted, archived, moved out, or filtered out by removing its tag/due date).
// `sections` is the DISPLAYED (filtered + sorted) order, still containing the
// leaving task at `removedIndex` within `sections[sectionIndex]`.

type FocusSection = { items: { id: number }[] };

export function nextFocusAfterRemoval(
  sections: FocusSection[],
  sectionIndex: number,
  removedIndex: number,
): number | null {
  const items = sections?.[sectionIndex]?.items;

  if (items && items.length > 1) {
    if (removedIndex >= 0 && removedIndex < items.length) {
      // last task in the column -> the task above; otherwise the task below
      // (which slides up into the freed slot). Array still holds the leaving task.
      const target =
        removedIndex >= items.length - 1
          ? items[items.length - 2]
          : items[removedIndex + 1];
      return target?.id ?? null;
    }
    // index unknown but the column keeps tasks -> stay in this column
    return items[0]?.id ?? null;
  }

  // column empties -> nearest task in an adjacent column (prefer right, then left)
  for (let d = 1; d < (sections?.length ?? 0); d++) {
    const right = sections[sectionIndex + d]?.items;
    if (right?.length) return right[0].id;
    const left = sections[sectionIndex - d]?.items;
    if (left?.length) return left[left.length - 1].id;
  }
  return null;
}
