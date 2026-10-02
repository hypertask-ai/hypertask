"use client";

import AttachmentView from "@/components/Common/AttachmentsView";
import useSaveContent from "@/hooks/Task Detail/CommentAndDescriptionHooks/useSaveContent";
import { useDescriptionAndCommentsContext } from "@/lib/contexts/TaskDetail/DescriptionProvider";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { IDraft } from "@/models/model";
import { isMeaningfulDescriptionDraft } from "@/hooks/General/useHasDrafts";
import { useCallback, useContext, useMemo } from "react";
import InnerHTMLDescription from "./InnerHtmlDescription";
import { HighlightMenu } from "../ContextMenu";
import QuoteButton from "../ContextMenu/QuoteButton";
import Tiptap from "@/components/RTE/TipTapTaskDetail";
import BackgroundTaskAttachments from "../BackgroundTaskAttachments";
import type { IAttachment } from "@/models/model";
import { linkifyHtml } from "@/utils/helperFunctions/linkifyHtml";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6752_INSTANT_TICKET_OPEN_FLAG } from "@/lib/flags/keys";

const DescriptonBody = ({ draftTQ }: any) => {
  const isMbl = useContext(MobileViewContext);
  const {
    secondaryPanelsReady,
    parsedTask,
    currentTask,
    editMode,
    currentId,
    allowPerks,
    hasDraft,
    hasDraftInit,
    setCarousalItems,
  } = useTaskContext();
  const task = useMemo(() => JSON.parse(parsedTask), [parsedTask]);
  const instantTicketOpen = useFlag(HTPR_6752_INSTANT_TICKET_OPEN_FLAG);
  const creator = instantTicketOpen ? currentTask?.user : task.user;
  const {
    description,
    descriptionAttachments,
    setDescriptionAttachments,
    uploadingDescription,
  } = useDescriptionAndCommentsContext();
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
  // HTPR-6802: the editor only linkifies typed or pasted URLs, so bare URLs
  // in CLI/API-written descriptions stayed plain text here.
  const linkedContent = useMemo(() => (content ? linkifyHtml(content) : content), [content]);
  const addLinkedAttachment = useCallback(
    (attachment: IAttachment) => {
      setDescriptionAttachments((current) =>
        current.some(
          (item) =>
            item.id === attachment.id ||
            item.fileSource === attachment.fileSource,
        )
          ? current
          : [...current, attachment],
      );
    },
    [setDescriptionAttachments],
  );

  return (
    <>
      {secondaryPanelsReady !== false ? <Tiptap
        key={task.id}
        allowPerks={allowPerks}
        attachments={descriptionAttachments}
        mode="read-edit-description"
        allowEdit={isEditing && !uploadingDescription}
        handleSave={redirectAPI}
        user={creator}
        shouldTriggerAiTaskWriter={editMode === "description-ai"}
        creatorname={creator?.displayName}
        isSelected={currentId === "description"}
        id="description"
        defaultContent={linkedContent}
        isMbl={isMbl}
        descriptionClass="pb-1 flex justify-start gap-[6px]"
      /> : <InnerHTMLDescription
        id="description-input"
        descriptionText={linkedContent ?? ""}
        attachmentsFromProps={[]}
      />}

      {!isEditing && creator && (
        <HighlightMenu
          target="#description-input"
          allowedPlacements={["top", "bottom"]}
          menu={({ selectedHtml }) => (
            <QuoteButton selection={selectedHtml ?? ""} creator={creator} />
          )}
        />
      )}

      <BackgroundTaskAttachments
        taskId={task.id}
        onLinked={addLinkedAttachment}
      />

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
