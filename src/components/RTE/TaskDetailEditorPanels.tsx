import { HTPR_6929_COMPOSE_TASK_WRITER_FLAG, HTPR_6937_NEW_TASK_WINDOW_FLAG } from "@/lib/flags/keys";
import { useSetRecoilState } from "@/lib/state";
import { showCommandsAtom } from "@/store";
import { CommandMode } from "@/models/enums";

import { useFlag } from "@/hooks/useFlag";
import { HTPR_6752_INSTANT_TICKET_OPEN_FLAG } from "@/lib/flags/keys";
import { createPortal } from "react-dom";
import TiptapProvider from "@/lib/contexts/TaskDetail/TiptapProvider";
import TiptapBubbleMenu from "./Components/TiptapBubbleMenu";
import TiptapMainContainer from "./Components/TiptapMainContainer";
import InnerHTMLDescription from "../PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/InnerHtmlDescription";
import { AITaskWriterWithProvider as AITaskWriterContainer } from "../PageComponents/TaskDetail/AI Task Writer/AITaskWriterContainer";
import dynamic from "next/dynamic";
import { cn } from "@/utils/undoActions/helperFuncs";
import { taskDetailSpacing } from "@/lib/configs/taskDetail.config";
import EmojiGifPicker from "./Components/EmojiGifPicker";
const SetLinkModal = dynamic(
  () => import("../Modals/LinksModal/SetLinkModal"),
  {
    ssr: false,
  }
);

type AIGeneratedAttachment = {
  id?: string;
  file: Pick<File, "name" | "size" | "type">;
  preview: string;
};
import type { TaskDetailEditorPresentation } from "./taskDetailEditorPresentation";
export function TaskDetailEditorPanels(context: TaskDetailEditorPresentation) {
  const { divIds, handleReadOnlyContentClick, isMbl, id, newCommentAttachments, creatorname, trigger, allowEdit, isRecording, saveInFlight, mode, uploadingDescription, toggleHighlightHandler, createdAt, editor, stack, user, isSelected, handleCallback, sendComment, handleFocus, getAttachments, handleKeydown, handleCommentEscape, inInbox, currentTask, handleTaskOptions, handleFileDrop, filesDropped, resetDropFiles, discardDraft, toggleAiTaskWriter, shouldShowInlineDraftAi, setShouldShowAITaskWriter, setAiTriggerData, inViewObject, hasCommentDraft, audioTiptapCallback, toggleRecording, allowPerks, toggleHighlight, shouldShowAiTaskWriter, shouldShowFullAiTaskWriter, getBackgroundContent, handleEscape, handleAISave, handleTitleAndDescriptionReturn, getDefaultMode, taskWriterOpening, editMode, mobileExistingEditOpen, mobileEditViewport, mobileEditHeight, mobileEditSaving, cancelMobileExistingEdit, showSetLinkModal, setShowSetLinkModal, setLinkHandlerCallback, emojiGifPicker, setEmojiGifPicker } = context;

  const composeEnabled = useFlag(HTPR_6929_COMPOSE_TASK_WRITER_FLAG);
  const newTaskWindowFlag = useFlag(HTPR_6937_NEW_TASK_WINDOW_FLAG);
  const setCommands = useSetRecoilState(showCommandsAtom);
  const instantTicketOpen = useFlag(HTPR_6752_INSTANT_TICKET_OPEN_FLAG);
  const mainContainer = instantTicketOpen && !editor && mode === "read-edit-description" ? (
    <InnerHTMLDescription
      id={`${id}-input`}
      descriptionText={context.defaultContent}
      attachmentsFromProps={context.attachments ?? []}
    />
  ) : <TiptapMainContainer mobileEditSaving={saveInFlight} />;

  return (
    <>
    <div
      id={divIds.wrapperId}
      onClickCapture={handleReadOnlyContentClick}
      className={cn("col-start-1 col-end-3 relative text-white-black", isMbl ? taskDetailSpacing.mobile.descriptionContainer : "")}
    >
        <TiptapProvider
          id={id}
          newCommentAttachments={newCommentAttachments}
          creator={{ creator: creatorname, createdAt }}
          trigger={trigger}
          isEditable={
            allowEdit &&
            !isRecording &&
            !saveInFlight &&
            !(mode === "read-edit-description" && uploadingDescription)
          }
          isEditModeActive={allowEdit}
          toggleHighlightHandler={toggleHighlightHandler}
          createdAt={createdAt}
          editor={editor}
          stack={stack}
          user={user}
          isSelected={isSelected}
          handleCallback={handleCallback}
          sendComment={sendComment}
          handleFocus={(e) => handleFocus(e)}
          getAttachments={getAttachments}
          handleKeydown={handleKeydown}
          handleCommentEscape={handleCommentEscape}
          mode={mode}
          inbox={inInbox}
          status={currentTask?.status}
          handleTaskOptions={handleTaskOptions}
          handleFileDrop={handleFileDrop}
          droppedFiles={filesDropped}
          resetDropFiles={resetDropFiles}
          discardDraft={discardDraft}
          toggleAiTaskWriter={toggleAiTaskWriter}
          shouldShowInlineDraftAi={shouldShowInlineDraftAi}
          closeInlineDraftAi={() => {
            setShouldShowAITaskWriter(false);
            setAiTriggerData({ initialPrompt: "", autoTrigger: false });
          }}
          aiProjectId={inViewObject.taskProjectId}
          aiTaskId={currentTask.id}
          showDeleteComment={hasCommentDraft}
          audioTiptapCallback={audioTiptapCallback}
          toggleRecording={toggleRecording}
          isRecording={isRecording}
        >
          {!isMbl && allowEdit && (
            <TiptapBubbleMenu
              currentProjectId={inViewObject.taskProjectId}
              currentTaskId={currentTask.id}
              toggleHighlightHandler={toggleHighlightHandler}
              allowPerks={allowPerks}
              editor={editor}
              toggleHighlight={toggleHighlight}
              hideMenu={shouldShowAiTaskWriter}
            />
          )}

          <div
            id={divIds.popoverContainer}
            className={`w-full absolute z-[1000] ${
              shouldShowFullAiTaskWriter
                ? "block h-full"
                : "hidden h-0"
            }`}
          >
            {shouldShowFullAiTaskWriter && (
              <AITaskWriterContainer
                id={divIds.popoverId}
                backgroundContent={getBackgroundContent()}
                EscapeHandler={handleEscape}
                AISaveHandler={handleAISave}
                attachments={newCommentAttachments}
                returnTitleAndDescription={handleTitleAndDescriptionReturn}
                defaultMode={getDefaultMode()}
                // additionalContext={getAdditionalContext()}
                toggleRecording={toggleRecording}
                isRecording={isRecording}
                // A fresh opening intentionally requests a fresh draft. The
                // container guard prevents duplicates within that opening.
                autoTrigger={taskWriterOpening.autoTrigger}
                initialPrompt={taskWriterOpening.initialPrompt}
                currentTask={currentTask}
                editMode={editMode}
              />
            )}
          </div>

          {mobileExistingEditOpen && typeof document !== "undefined" ? (
            createPortal(
              <div
                data-mobile-existing-content-editor
                className="fixed inset-x-0 z-[1200] bg-modalBackground"
                style={{
                  bottom: mobileEditViewport?.bottomInset ?? 0,
                  height: mobileEditHeight,
                }}
              >
                <TiptapMainContainer
                  mobileEditOpen
                  mobileEditSaving={mobileEditSaving || saveInFlight}
                  onCancelMobileEdit={cancelMobileExistingEdit}
                />
              </div>,
              document.body,
            )
          ) : (
            mainContainer
          )}

          <button
            className="hidden"
            onClick={() => {
              if (composeEnabled && newTaskWindowFlag) setCommands({ show: true, mode: CommandMode.Command, paletteTab: "compose" });
              else setShouldShowAITaskWriter((prev) => !prev);
            }}
            id={divIds.popoverTriggerButtonId}
          />
        </TiptapProvider>
      </div>
      {showSetLinkModal && (
        <SetLinkModal
          closeHandler={() => setShowSetLinkModal(false)}
          callbackHandler={setLinkHandlerCallback}
        />
      )}
      {emojiGifPicker && editor && (
        <EmojiGifPicker
          anchorRect={emojiGifPicker.anchorRect}
          editor={editor}
          initialTab={emojiGifPicker.initialTab}
          insertPosition={emojiGifPicker.position}
          onClose={() => setEmojiGifPicker(null)}
        />
      )}
    </>
  );
}
