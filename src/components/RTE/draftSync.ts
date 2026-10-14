import type { IDraft, RedirectMode } from "@/models/model";


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

export const normalizeEditorHtml = (html?: string) => {
  const trimmed = html?.trim() ?? "";
  return trimmed === "<p></p>" ? "" : trimmed;
};

export const shouldSyncDraft = (
  incoming: string,
  rendered: string,
  userHasEdited: boolean
) => !userHasEdited && incoming !== rendered;

export function shouldSkipUnchangedMobileDescriptionSave({
  isMobileExistingSave,
  mode,
  hasDraft,
  openingHtml,
  currentHtml,
  attachmentsChanged,
}: {
  isMobileExistingSave: boolean;
  mode: RedirectMode;
  hasDraft: boolean;
  openingHtml?: string;
  currentHtml?: string;
  attachmentsChanged: boolean;
}) {
  return (
    isMobileExistingSave &&
    mode === "read-edit-description" &&
    !hasDraft &&
    normalizeEditorHtml(openingHtml) === normalizeEditorHtml(currentHtml) &&
    !attachmentsChanged
  );
}
