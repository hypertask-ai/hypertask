export const OLDER_CHAT_RAIL_SECTION = "Older";

const OLDER_OPENED_MARK = "older-opened";

function sectionList(stored: readonly string[] | null | undefined): string[] {
  if (!Array.isArray(stored)) return [];
  return stored.filter((item) => item !== OLDER_OPENED_MARK);
}

export function railCollapsedSections(
  stored: readonly string[] | null | undefined,
  foldOlderByDefault: boolean,
): string[] {
  const titles = sectionList(stored);
  const opened = Array.isArray(stored) && stored.includes(OLDER_OPENED_MARK);
  if (
    foldOlderByDefault &&
    !opened &&
    !titles.includes(OLDER_CHAT_RAIL_SECTION)
  ) {
    titles.push(OLDER_CHAT_RAIL_SECTION);
  }
  return titles;
}

export function nextCollapsedRailSections(
  stored: readonly string[] | null | undefined,
  title: string,
  wasShut: boolean,
  rememberOlderOpen = false,
): string[] {
  const opened =
    (Array.isArray(stored) && stored.includes(OLDER_OPENED_MARK)) ||
    (rememberOlderOpen && title === OLDER_CHAT_RAIL_SECTION && wasShut);
  const titles = sectionList(stored).filter((item) => !wasShut || item !== title);
  if (!wasShut && !titles.includes(title)) titles.push(title);
  if (opened) titles.push(OLDER_OPENED_MARK);
  return titles;
}
