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

export function shouldPreserveNativeInboxTab(
  activeElement: ClosestElement | null,
): boolean {
  return activeElement?.closest('[data-inbox-draft-control="true"]') != null;
}

export type InboxOpeningPosition = {
  index: number;
  resumes: boolean;
};

export function resolveInboxOpeningPosition({
  split,
  projectId,
  lastIndex,
}: {
  split?: string | null;
  projectId?: string | number | null;
  lastIndex?: number | null;
}): InboxOpeningPosition {
  const lastRow =
    typeof lastIndex === "number" && Number.isFinite(lastIndex)
      ? Math.max(0, Math.trunc(lastIndex))
      : 0;
  const resumes = Boolean(split || projectId) && lastRow > 0;

  return { index: resumes ? lastRow : 0, resumes };
}

export function shouldResumeInboxRow({
  resumes,
  openingTab,
  currentTab,
}: {
  resumes: boolean;
  openingTab: string;
  currentTab: string;
}): boolean {
  return resumes && openingTab === currentTab;
}

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
