type InboxBoundaryItem = {
  id: string | number;
};

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
