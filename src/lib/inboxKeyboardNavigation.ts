type InboxBoundaryItem = {
  id: string | number;
};

export type InboxKeyboardRow = {
  key: string;
};

export function reconcileInboxKeyboardRow<T extends InboxKeyboardRow>(
  rows: readonly T[],
  currentKey: string | null,
  fallbackKey: string | null,
): T | null {
  return (
    rows.find((row) => row.key === currentKey) ??
    rows.find((row) => row.key === fallbackKey) ??
    rows[0] ??
    null
  );
}

export function getAdjacentInboxKeyboardRow<T extends InboxKeyboardRow>(
  rows: readonly T[],
  currentKey: string | null,
  direction: -1 | 1,
): T | null {
  if (rows.length === 0) return null;

  const currentIndex = rows.findIndex((row) => row.key === currentKey);
  const targetIndex =
    currentIndex === -1
      ? 0
      : Math.max(0, Math.min(rows.length - 1, currentIndex + direction));

  return rows[targetIndex];
}

type ScrollableInboxRow = {
  scrollIntoView: (options?: ScrollIntoViewOptions) => void;
};

type InboxRowLookup = (id: string) => ScrollableInboxRow | null;

type ClosestElement = Pick<Element, "closest">;

/** Keeps native Tab traversal only after the user has entered draft controls. */
export function shouldPreserveNativeInboxTab(
  activeElement: ClosestElement | null,
): boolean {
  return activeElement?.closest('[data-inbox-draft-control="true"]') != null;
}

/** Moves a keyboard jump to the first/last inbox row and keeps it visible. */
export function jumpToInboxBoundary(
  items: InboxBoundaryItem[],
  toEnd: boolean,
  getRow: InboxRowLookup = (id) => document.getElementById(id),
): number | null {
  if (items.length === 0) return null;

  const targetIndex = toEnd ? items.length - 1 : 0;
  getRow(`inbox-${items[targetIndex].id}`)?.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });

  return targetIndex;
}
