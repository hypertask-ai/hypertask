export const OLDER_CHAT_RAIL_SECTION = "Older";

const OLDER_OPENED_MARK = "older-opened";

type SavedRailFolds = readonly string[] | null | undefined;

type RailFoldInput = {
  stored: SavedRailFolds;
  foldOlderByDefault: boolean;
};

type RailFoldToggle = RailFoldInput & {
  title: string;
  wasShut: boolean;
};

function sectionList(stored: SavedRailFolds): string[] {
  if (!Array.isArray(stored)) return [];
  return stored.filter((item) => item !== OLDER_OPENED_MARK);
}

function olderWasOpened(stored: SavedRailFolds): boolean {
  return Array.isArray(stored) && stored.includes(OLDER_OPENED_MARK);
}

export function railCollapsedSections({
  stored,
  foldOlderByDefault,
}: RailFoldInput): string[] {
  const titles = sectionList(stored);
  const foldOlder =
    foldOlderByDefault &&
    !olderWasOpened(stored) &&
    !titles.includes(OLDER_CHAT_RAIL_SECTION);
  if (foldOlder) titles.push(OLDER_CHAT_RAIL_SECTION);
  return titles;
}

export function nextCollapsedRailSections({
  stored,
  title,
  wasShut,
  foldOlderByDefault,
}: RailFoldToggle): string[] {
  const keepsOlderOpen =
    olderWasOpened(stored) ||
    (foldOlderByDefault && title === OLDER_CHAT_RAIL_SECTION && wasShut);
  const titles = sectionList(stored).filter((item) => !wasShut || item !== title);
  if (!wasShut && !titles.includes(title)) titles.push(title);
  if (keepsOlderOpen) titles.push(OLDER_OPENED_MARK);
  return titles;
}
