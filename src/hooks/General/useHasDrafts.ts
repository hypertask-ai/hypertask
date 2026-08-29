import { useMemo } from "react";
import { useGetDrafts } from "../Task Detail/useGetDrafts";
import { IDraft } from "@/models/model";

const EMPTY_DESCRIPTION_DRAFTS = new Set([
  "",
  "<p></p>",
  "<html><head></head><body><p></p></body></html>",
  "<html><head></head><body></body></html>",
]);

/** Align with getDraftsController — empty drafts should not force description edit UI. */
export const isMeaningfulDescriptionDraft = (draft: IDraft) => {
  const content = draft?.content?.trim() ?? "";
  return (
    draft?.type === "Description" &&
    !EMPTY_DESCRIPTION_DRAFTS.has(content)
  );
};

const useHasDrafts = (taskId: number | undefined, userId: number | undefined) => {
  const { data: draftsFromTQ = [], isFetching } = useGetDrafts(taskId!, userId);
  const hasDraft = useMemo(() => {
    return (
      draftsFromTQ?.some((draft: IDraft) => isMeaningfulDescriptionDraft(draft)) ??
      false
    );
  }, [isFetching, draftsFromTQ]);

  const hasCommentDraft = useMemo(() => {
    // Only a comment draft with real content counts, so the discard-draft trash
    // stays hidden on an empty composer (mirrors isMeaningfulDescriptionDraft).
    return (
      draftsFromTQ?.some((draft: IDraft) => {
        if (draft?.type !== "Comment") return false;
        const content = draft?.content?.trim() ?? "";
        return content !== "" && content !== "<p></p>";
      }) ?? false
    );
  }, [isFetching, draftsFromTQ]);

  

  return { hasDraft, hasCommentDraft, draftsFromTQ};
};

export default useHasDrafts;
