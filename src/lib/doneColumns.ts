// The explicit flag is the single shared rule. Name fallbacks deliberately
// remain consumer-specific because unifying them measurably changed live boards.
// Each consumer passes the fallback it historically used.
export const DONE_SECTION_NAMES: string[] = [
  "done",
  "complete",
  "completed",
  "shipped",
  "closed",
  "finished",
  "live",
  "released",
];

const normalizeTitle = (title: string | null | undefined): string =>
  title?.trim().toLowerCase() ?? "";

/** Name-only guess. The fallback used when a column has no explicit flag. */
export function isDoneByName(title: string | null | undefined): boolean {
  return DONE_SECTION_NAMES.includes(normalizeTitle(title));
}

export type DoneColumnInput = {
  section_title: string;
  isDone?: boolean | null;
};

export type NameFallback = (title: string) => boolean;

/**
 * Lowercased titles of the columns that end a ticket's life on this board.
 * Explicit isDone wins per column; null falls back to the name.
 */
export function doneColumnTitles(
  sections: DoneColumnInput[],
  nameFallback: NameFallback = isDoneByName
): Set<string> {
  const resolved = new Set<string>();

  for (const section of sections) {
    const title = normalizeTitle(section.section_title);
    // Tasks store only a denormalized title, not a sectionId, so same-named
    // columns cannot be distinguished. Only add true values so true wins.
    if (section.isDone ?? nameFallback(section.section_title)) {
      resolved.add(title);
    }
  }

  return resolved;
}

/**
 * Whether a task sitting in `title` is finished.
 * Pass the board's resolved set when you have it; without it this degrades to
 * the name guess, which is what every caller did before this change.
 */
export function isDoneColumn(
  title: string | null | undefined,
  doneTitles?: ReadonlySet<string> | null,
  nameFallback: NameFallback = isDoneByName
): boolean {
  if (doneTitles != null) return doneTitles.has(normalizeTitle(title));
  return nameFallback(title ?? "");
}
