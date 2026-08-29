export const DEFAULT_ERROR_BOARD_SECTION_TITLE = "Bugs";

export type ErrorBoardSection = {
  id: number;
  section_title: string;
};

export function selectErrorBoardSection(
  sections: ErrorBoardSection[],
  configuredTitle?: string,
): ErrorBoardSection {
  const title = configuredTitle?.trim() || DEFAULT_ERROR_BOARD_SECTION_TITLE;
  const matches = sections.filter((section) => section.section_title === title);

  if (matches.length !== 1) {
    throw new Error(
      `Error board must have exactly one visible section named "${title}"; found ${matches.length}`,
    );
  }

  return matches[0];
}
