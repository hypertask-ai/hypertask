export interface MentionNavigationItem {
  type?: string;
}

export const NON_SELECTABLE_MENTION_TYPES = [
  "peopleHeading",
  "modelHeading",
  "taskHeading",
  "projectHeading",
  "agentHeading",
  "loading",
  "no-results",
  "error",
] as const;

export const isSelectableMentionItem = (
  item: MentionNavigationItem | undefined,
  ignoredTypes: readonly string[] = NON_SELECTABLE_MENTION_TYPES,
): boolean => Boolean(item && !ignoredTypes.includes(item.type ?? ""));

export const firstSelectableMentionIndex = (
  items: MentionNavigationItem[],
  ignoredTypes: readonly string[] = NON_SELECTABLE_MENTION_TYPES,
): number =>
  items.findIndex((item) => isSelectableMentionItem(item, ignoredTypes));

export const nextSelectableMentionIndex = (
  items: MentionNavigationItem[],
  selectedIndex: number,
  direction: -1 | 1,
  ignoredTypes: readonly string[] = NON_SELECTABLE_MENTION_TYPES,
): number => {
  if (items.length === 0) return -1;

  const startingIndex =
    selectedIndex >= 0 && selectedIndex < items.length
      ? selectedIndex
      : direction === 1
        ? -1
        : items.length;

  for (let step = 1; step <= items.length; step += 1) {
    const candidate =
      (startingIndex + direction * step + items.length) % items.length;
    if (isSelectableMentionItem(items[candidate], ignoredTypes)) {
      return candidate;
    }
  }

  return -1;
};
