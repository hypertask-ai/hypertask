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

export function isDoneByName(title: string | null | undefined): boolean {
  return DONE_SECTION_NAMES.includes(normalizeTitle(title));
}

export type DoneColumnInput = {
  section_title: string;
  isDone?: boolean | null;
};

export type NameFallback = (title: string) => boolean;

export function doneColumnTitles(
  sections: DoneColumnInput[],
  nameFallback: NameFallback = isDoneByName
): Set<string> {
  const resolved = new Set<string>();

  for (const section of sections) {
    const title = normalizeTitle(section.section_title);
    if (section.isDone ?? nameFallback(section.section_title)) {
      resolved.add(title);
    }
  }

  return resolved;
}

export function isDoneColumn(
  title: string | null | undefined,
  doneTitles?: ReadonlySet<string> | null,
  nameFallback: NameFallback = isDoneByName
): boolean {
  if (doneTitles != null) return doneTitles.has(normalizeTitle(title));
  return nameFallback(title ?? "");
}
