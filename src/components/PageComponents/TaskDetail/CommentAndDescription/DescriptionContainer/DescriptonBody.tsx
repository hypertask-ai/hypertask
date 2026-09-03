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
import InnerHTMLDescription from "./InnerHtmlDescription";
import { shouldMountTaskDescriptionEditor } from "./descriptionRenderMode";

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
  const isEditing = shouldMountTaskDescriptionEditor({
    editMode,
    hasDraft,
    hasDraftInit,
  });
  const content =
    uploadingDescription?.content ??
    draftTQ?.find((draft: IDraft) => isMeaningfulDescriptionDraft(draft))
      ?.content ??
    description;

  return (
    <>
      {isEditing ? (
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
        />
      ) : (
        <InnerHTMLDescription
          descriptionText={content}
          id="description-input"
          attachmentsFromProps={descriptionAttachments}
          allowQuote={Boolean(task.user)}
          setCarousalItems={setCarousalItems}
          taskCreator={task.user}
          taskDetailContentReady
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
