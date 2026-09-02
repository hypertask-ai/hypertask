import { useTiptapGlobalContext } from "@/lib/contexts/TaskDetail/TiptapProvider";
import React, { useContext } from "react";
import styles from "@/styles/tiptap.module.scss";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import CreatedInfoTiptap from "./CreatedInfoTiptap";
import TiptapEditor from "./TiptapEditor";
import AttachmentsUpload from "@/components/Common/AttachmentsUpload";
import FileDragOverlay from "@/components/Common/FileDragAndDrop";
import InlineDraftAiFloat from "./InlineDraftAiFloat";
import { X } from "lucide-react";

interface TiptapMainContainerProps {
  mobileEditOpen?: boolean;
  mobileEditSaving?: boolean;
  onCancelMobileEdit?: () => void;
}

const TiptapMainContainer = ({
  mobileEditOpen = false,
  mobileEditSaving = false,
  onCancelMobileEdit,
}: TiptapMainContainerProps) => {
  const {
    mode,
    isEditable,
    isEditModeActive,
    stack,
    id,
    handleFocus,
    toggleExpansion,
    handleKeydown,
    handleCommentEscape,
    isSelected,
    trigger,
    newCommentAttachments,
    getAttachments,
    editor,
    handleCallback,
    sendComment,
    inbox,
    status,
    handleTaskOptions,
    handleFileDrop,
    droppedFiles,
    resetDropFiles,
    discardDraft,
    showDeleteComment,
    toggleAiTaskWriter,
    shouldShowInlineDraftAi,
    closeInlineDraftAi,
    aiProjectId,
    aiTaskId,
    audioTiptapCallback,
    toggleRecording,
    isRecording,
  } = useTiptapGlobalContext();
  const isMbl = useContext(MobileViewContext);
  const allowedAttachmentModes = [
    "read-edit-description",
    "create-comment",
    "read-edit-comments",
  ];
  const isReadOnlyExistingContent =
    !isEditModeActive &&
    (mode === "read-edit-description" || mode === "read-edit-comments");
  // =============================================== Mobile
  if (isMbl) {
    if (mobileEditOpen) {
      const aiOpen = shouldShowInlineDraftAi && !!editor;
      const title =
        mode === "read-edit-description" ? "Edit description" : "Edit comment";
      const wellSurface =
        mode === "read-edit-description"
          ? "rounded-[5px] bg-comment-description"
          : "rounded-[8px] bg-newcomment-well";

      return (
        <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-modalBackground text-white-black">
          <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 px-4">
            <h1
              className={
                aiOpen
                  ? "truncate text-content font-semibold text-hypertasks-ai-purple"
                  : "truncate text-content font-semibold"
              }
            >
              {aiOpen ? "Write with AI" : title}
            </h1>
            <button
              type="button"
              aria-label={`Close ${title.toLowerCase()}`}
              disabled={mobileEditSaving}
              onClick={onCancelMobileEdit}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[4px] text-icon-dark-gray hover:text-white-black disabled:opacity-40"
            >
              <X size={20} strokeWidth={1.75} aria-hidden />
            </button>
          </header>

          <div
            id={id}
            tabIndex={0}
            onKeyDown={handleKeydown}
            className={`mx-3 mb-3 flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 ${wellSurface}`}
          >
            <div
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin scrollbar-track-transparent scrollbar-thumb-icon-dark-gray [&>div]:!mt-0 [&>div]:!max-w-full"
              onClick={handleFocus}
            >
              <TiptapEditor />
            </div>
            {aiOpen && closeInlineDraftAi && editor && (
              <InlineDraftAiFloat
                editor={editor}
                onClose={closeInlineDraftAi}
                projectId={aiProjectId}
                taskId={aiTaskId}
                toggleRecording={toggleRecording}
                isRecording={isRecording}
                presentation="edit-inline"
                suppressEditorSelectionHighlight
              />
            )}
            <AttachmentsUpload
              filesFromParent={newCommentAttachments}
              trigger={trigger}
              callback={getAttachments}
              droppedFiles={[]}
              mode={mode}
              sendOnClick={() => handleCallback()}
              editor={editor}
              discardDraft={discardDraft}
              audioTiptapCallback={audioTiptapCallback}
              audioDefaultContent={editor?.getText()}
              toggleRecording={toggleRecording}
              isRecording={isRecording}
              toggleAiTaskWriter={toggleAiTaskWriter}
              hideComposerDictation={aiOpen}
              mobileExistingEdit
              mobileEditSaving={mobileEditSaving}
              onCancelMobileEdit={onCancelMobileEdit}
            />
          </div>
        </div>
      );
    }

    // FOR: New comment on mobile
    if (mode === "create-comment") {
      const aiRefineOpen =
        shouldShowInlineDraftAi && !!editor && !editor.isEmpty;
      const aiComposeOpen =
        shouldShowInlineDraftAi && !!editor && editor.isEmpty;
      const isComposerExpanded =
        editor?.isFocused ||
        newCommentAttachments.length > 0 ||
        isRecording ||
        aiComposeOpen ||
        aiRefineOpen;

      return (
        <>
          <div
            className={`
              ${isComposerExpanded ? "flex-col" : "flex-row items-center"}
              flex w-full gap-[8px]
              scrollbar-none
              bg-transparent
              ${id === "comment-input" ? "" : `${styles.hellow} outline-none`}
              border-0
              ${
                id === "comment-input"
                  ? ""
                  : "items-center bg-transparent px-0"
              }
            `}
          // onFocus={handleFocus}

          id={id}
          tabIndex={-1}
          onKeyDown={handleKeydown}
          onClick={() => {
            handleFocus();
            handleTaskOptions && handleTaskOptions(false);
          }}
        >
          <CreatedInfoTiptap />
          <div
            className={
              isComposerExpanded ? "w-full min-w-0" : "min-w-0 flex-1"
            }
          >
            {!aiRefineOpen && !aiComposeOpen && <TiptapEditor />}
          </div>
          {/* ================== attachment button ============= */}
          <div
            className={isComposerExpanded ? "w-full shrink-0" : "shrink-0"}
          >
            <AttachmentsUpload
              filesFromParent={[]}
              trigger={trigger}
              droppedFiles={[]}
              callback={getAttachments}
              mode={mode}
              sendOnClick={sendComment}
              editor={editor}
              discardDraft={discardDraft}
              audioTiptapCallback={audioTiptapCallback}
              audioDefaultContent={editor?.getHTML()}
              toggleRecording={toggleRecording}
              isRecording={isRecording}
              showDeleteComment={showDeleteComment}
              toggleAiTaskWriter={toggleAiTaskWriter}
              hideComposerDictation={shouldShowInlineDraftAi}
            />
          </div>
        </div>
        {aiRefineOpen && closeInlineDraftAi && (
          <InlineDraftAiFloat
            editor={editor}
            onClose={closeInlineDraftAi}
            projectId={aiProjectId}
            taskId={aiTaskId}
            allowSuggestReply
            toggleRecording={toggleRecording}
            isRecording={isRecording}
            presentation="refine-fullscreen"
            suppressEditorSelectionHighlight
          />
        )}
        {aiComposeOpen && closeInlineDraftAi && (
          <InlineDraftAiFloat
            editor={editor}
            onClose={closeInlineDraftAi}
            projectId={aiProjectId}
            taskId={aiTaskId}
            allowSuggestReply
            toggleRecording={toggleRecording}
            isRecording={isRecording}
            presentation="composer"
            suppressEditorSelectionHighlight
          />
        )}
        </>
      );
    }

    // FOR: Description and old comment.
    else {
      return (
        <div
          style={{
            borderLeftWidth: mode === "read-edit-description" ? 0 : 0 }}
          className={`
            w-full min-h-[64px]
            scrollbar-none
            bg-comment-description
            ${mode === "read-edit-comments" ? "comment-edit-container" : ""}
            ${mode === "read-edit-description" ? "description-edit-container" : ""}
            ${
              id === "comment-input"
                ? " rounded-full py-1 px-2  "
                : `${styles.hellow}  outline-none`
            }
            flex-wrap border-transparent   py-1  border-0 w-full 
            ${
              id === "comment-input"
                ? "  flex "
                : "items-center   bg-transparent px-0  "
            }
          `}
          onFocus={handleFocus}
          id={id}
          tabIndex={mode === "read-edit-comments" && !isEditModeActive ? -1 : 0}
          onKeyDown={handleKeydown}
          onClick={toggleExpansion}
        >
          <CreatedInfoTiptap />
          <TiptapEditor />
          {/* ================== attachment button ============= */}

          {isEditModeActive && (
            <AttachmentsUpload
              filesFromParent={newCommentAttachments}
              trigger={trigger}
              callback={getAttachments}
              droppedFiles={[]}
              mode={mode}
              sendOnClick={() => handleCallback()}
              editor={editor}
              discardDraft={discardDraft}
              audioTiptapCallback={audioTiptapCallback}
              audioDefaultContent={editor?.getText()}
              toggleRecording={toggleRecording}
              isRecording={isRecording}
            />
          )}
        </div>
      );
    }
  }

  // =============================================== DESKTOP
  else {
    return (
      <div
        style={{
          borderLeftWidth: mode === "read-edit-description" ? 0 : 0 }}
        className={`
            w-full
            
            flex flex-col
            scrollbar-none items-center
            ${mode === "create-comment" ? " " : ""}
            ${stack ? "py-1 gap-3 grid-cols-1" : ""} 
            ${
              stack && !isSelected ? "bg-transparent" : "bg-comment-description"
            }
            ${mode === "read-edit-comments" ? "comment-edit-container" : ""}
            ${mode === "read-edit-description" ? "description-edit-container" : ""}
            ${styles.hellow}  outline-none
            ${
              id === "comment-input"
                ? "   "
                : "items-center   bg-transparent px-0 "
            }  
          `}
        onFocus={handleFocus}
        id={id}
        tabIndex={mode === "read-edit-comments" && !isEditModeActive ? -1 : 0}
        onKeyDown={handleKeydown}
        onClick={toggleExpansion}
      >
        <FileDragOverlay
          // ponytail: drop is gated on the callback, not on allowDrop — flipping
          // allowDrop swaps FileDragAndDrop's wrapper element, which unmounts the
          // editor and cold-reloads every embedded iframe (HTPR-4933).
          dropCallbackHandler={isEditable ? handleFileDrop : () => {}}
          allowDrop={
            mode === "create-comment" || mode === "read-edit-description"
          }
          customClassName={`${
            mode === "create-comment"
              ? "ml-[-20px] mr-[-16px] mb-[-4px] mt-[-20px]"
              : mode === "read-edit-description"
              ? "ml-[-20px] mr-[-16px] mb-[-20px] mt-[-42px] !rounded-[0.275rem]"
              : ""
          }`}
        >
          <CreatedInfoTiptap />
          <TiptapEditor />
          {shouldShowInlineDraftAi && editor && closeInlineDraftAi && (
            <InlineDraftAiFloat
              editor={editor}
              onClose={closeInlineDraftAi}
              projectId={aiProjectId}
              taskId={aiTaskId}
              allowSuggestReply={mode === "create-comment"}
              toggleRecording={toggleRecording}
              isRecording={isRecording}
            />
          )}
          {/* ================== attachment button ============= */}
          {allowedAttachmentModes.includes(mode) &&
            !isReadOnlyExistingContent && (
            <AttachmentsUpload
              filesFromParent={newCommentAttachments}
              droppedFiles={droppedFiles}
              trigger={trigger}
              callback={getAttachments}
              mode={mode}
              sendOnClick={() => handleCallback()}
              editor={editor}
              inInbox={inbox}
              handleCallback={handleCallback}
              status={status}
              resetDropFiles={resetDropFiles}
              discardDraft={discardDraft}
              showDeleteComment={showDeleteComment}
              onCancelEditComment={handleCommentEscape}
              toggleAiTaskWriter={toggleAiTaskWriter}
              audioTiptapCallback={audioTiptapCallback}
              audioDefaultContent={editor?.getText()}
              toggleRecording={toggleRecording}
              isRecording={isRecording}
              hideComposerDictation={shouldShowInlineDraftAi}
            />
          )}
        </FileDragOverlay>
      </div>
    );
  }
};

export default TiptapMainContainer;
