import { splitGraphemes } from "unicode-segmenter/grapheme";

const MAX_PENDING_BOARD_TITLE_LENGTH = 50;

export function getCreateBoardPendingHeader(title: string): string {
  const titleGraphemes = Array.from(splitGraphemes(title));
  const visibleTitle =
    titleGraphemes.length > MAX_PENDING_BOARD_TITLE_LENGTH
      ? `${titleGraphemes.slice(0, MAX_PENDING_BOARD_TITLE_LENGTH).join("")}...`
      : title;

  return `Creating board: ${visibleTitle}`;
}
