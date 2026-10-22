import type { IProject } from "@/models/model";

export function matchComposeTaskBoard(text: string, boards: Pick<IProject, "id" | "title" | "uniqueIdentifier">[]): number | undefined {
  const note = text.replace(/\s+/gu, " ");
  const references = boards.flatMap((board) => [board.title, board.uniqueIdentifier].flatMap((value) => {
    const name = value?.trim().replace(/\s+/gu, " ");
    if (!name) return [];
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^\\p{L}\\p{N}_])(?:for|on|in|into|to) (?:the )?(?:(?:project|board) )?["'‘’“”]?${escaped}(?=$|[^\\p{L}\\p{N}_])`, "iu").test(note) ? [name] : [];
  }));
  const matches = boards.filter((board) => [board.title, board.uniqueIdentifier].some((value) => {
    const name = value?.trim().replace(/\s+/gu, " ");
    if (!name) return false;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return references.some((reference) => new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, "iu").test(reference));
  }));
  return matches.length === 1 ? matches[0].id : undefined;
}
