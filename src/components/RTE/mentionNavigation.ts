export interface MentionNavigationItem {
  type?: string;
}

export const NON_SELECTABLE_MENTION_TYPES = [
  "peopleHeading",
  "modelHeading",
  "taskHeading",
  "pageHeading",
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

const isMentionHeading = (item: MentionNavigationItem): boolean =>
  (item.type ?? "").endsWith("Heading");

export const moveAgentMentionsFirst = <T extends MentionNavigationItem>(
  items: T[],
): T[] => {
  const start = items.findIndex((item) => item.type === "agentHeading");
  if (start <= 0) return items;
  let end = start + 1;
  while (end < items.length && !isMentionHeading(items[end])) end += 1;
  if (end === start + 1) return items;
  return [...items.slice(start, end), ...items.slice(0, start), ...items.slice(end)];
};
