import type { IDraft } from "@/models/model";

// Keeping an editor in step with a draft that can be written outside this browser
// (hypertask CLI/MCP `draft create`, or another tab).
//
// Two things have to be true at once, and the second one is what the first attempt
// at this got wrong:
//
//   1. A draft that lands after the editor mounted has to reach the editor, even
//      when the editor is already showing an OLDER draft. Comparing against the
//      frozen mount value could only ever fill an empty editor, so a rewritten
//      draft left stale text on screen forever.
//   2. Once the user has touched the editor, nothing may overwrite them. Not a
//      slow refetch, not an optimistic autosave echo, not a draft the API
//      recreated from a request that was already in flight when they posted. This
//      is why "has the user edited" is a one-way flag for the life of the editor
//      rather than a content comparison: an editor whose content happens to match
//      the cache again is NOT proof the cache is authoritative, and treating it as
//      proof lets a stale response erase what they typed.

type TaskDraftContent = Pick<IDraft, "content" | "type"> &
  Partial<Pick<IDraft, "taskId">>;

export const getTaskDraftContent = (
  drafts: readonly TaskDraftContent[] | undefined,
  taskId: number | undefined,
  type: IDraft["type"],
) => {
  if (!taskId) return "";
  return drafts?.find((draft) => draft.taskId === taskId && draft.type === type)
    ?.content ?? "";
};

/** An empty editor serialises to "<p></p>", never "" — the two are one document. */
export const normalizeEditorHtml = (html?: string) => {
  const trimmed = html?.trim() ?? "";
  return trimmed === "<p></p>" ? "" : trimmed;
};

/**
 * @param incoming      stored draft content, normalized
 * @param rendered      what the editor currently shows, normalized
 * @param userHasEdited whether the editor has emitted an update since it mounted
 */
export const shouldSyncDraft = (
  incoming: string,
  rendered: string,
  userHasEdited: boolean
) => !userHasEdited && incoming !== rendered;
