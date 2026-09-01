"use client";

import AttachmentView from "@/components/Common/AttachmentsView";
import useSaveContent from "@/hooks/Task Detail/CommentAndDescriptionHooks/useSaveContent";
import { useDescriptionAndCommentsContext } from "@/lib/contexts/TaskDetail/DescriptionProvider";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { IDraft } from "@/models/model";
import { isMeaningfulDescriptionDraft } from "@/hooks/General/useHasDrafts";
import dynamic from "next/dynamic";
import { useContext, useMemo } from "react";
import { HighlightMenu } from "../ContextMenu";
import QuoteButton from "../ContextMenu/QuoteButton";

const Tiptap = dynamic(() => import("@/components/RTE/TipTapTaskDetail"));

const DescriptonBody = ({ draftTQ }: any) => {
  const isMbl = useContext(MobileViewContext);
  const {
    parsedTask,
    editMode,
    currentId,
    allowPerks,
    hasDraft,
    hasDraftInit,
    setCarousalItems,
  } = useTaskContext();
  const task = useMemo(() => JSON.parse(parsedTask), [parsedTask]);
  const { description, descriptionAttachments, uploadingDescription } =
    useDescriptionAndCommentsContext();
  const { redirectAPI } = useSaveContent();
  const isEditing =
    editMode === "description" ||
    editMode === "description-ai" ||
    hasDraft ||
    hasDraftInit;
  const content =
    uploadingDescription?.content ??
    draftTQ?.find((draft: IDraft) => isMeaningfulDescriptionDraft(draft))
      ?.content ??
    description;

  return (
    <>
      <Tiptap
        key={task.id}
        allowPerks={allowPerks}
        attachments={descriptionAttachments}
        mode="read-edit-description"
        allowEdit={isEditing && !uploadingDescription}
        handleSave={redirectAPI}
        user={task.user}
        shouldTriggerAiTaskWriter={editMode === "description-ai"}
        creatorname={task.user?.displayName}
        isSelected={currentId === "description"}
        id="description"
        defaultContent={content}
        isMbl={isMbl}
        descriptionClass="pb-1 flex justify-start gap-[6px]"
        autoDescriptionSlotId="auto-description-suggestion-slot"
      />

      {!isEditing && task.user && (
        <HighlightMenu
          target="#description-input"
          allowedPlacements={["top", "bottom"]}
          menu={({ selectedHtml }) => (
            <QuoteButton selection={selectedHtml ?? ""} creator={task.user} />
          )}
        />
      )}

      {!isEditing && (
        <AttachmentView
          active={false}
          attachments={descriptionAttachments}
          setCarousalItems={setCarousalItems}
          compact={false}
        />
      )}
    </>
  );
};

export default DescriptonBody;
