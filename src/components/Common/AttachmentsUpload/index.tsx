
import { IProps } from "./attachmentUploadTypes";
export { type FileItem, type AttachmentUploadInput } from "./attachmentUploadTypes";

import { SaveButtonMobile, MobileBottomBar, DesktopAttachment } from "./AttachmentControls";

import { useAttachmentUploadState } from "./useAttachmentUploadState";
import { renderMobileAttachmentEdit } from "./MobileAttachmentEdit";
import React from "react";

import ImageGallery from "./ImageGalleryView";

import "@/styles/attachmentUpload.scss";
import { AtSign, Image as ImageIcon, Paperclip, PencilSparkles, Plus, Slash, Trash2 } from "lucide-react";









import { AudioButton } from "@/components/RTE/Components/AudioButton";
import { mobileCommentMicWrapperClass } from "./mobileCommentComposer";

import { cn } from "@/utils/undoActions/helperFuncs";
import { MOBILE_TARGET } from "@/lib/configs/general.config";






const AttachmentsUpload = (props: IProps) => {
  const {
  editor, callback, returnUploadedAttachments, mode, inInbox,
  handleCallback, sendOnClick, status, showDeleteComment, onCancelEditComment,
  toggleAiTaskWriter, audioTiptapCallback, toggleRecording, isRecording, isAiTaskWriterOpen,
  hideComposerDictation, dictationCoordinator, mobileExistingEdit, onCancelMobileEdit, backgroundTaskUploads,
  _mbl, descriptionFirstEnabled, hasText, hasSavableContent, audioProcessing,
  setAudioProcessing, mobileUploadPending, setMobileUploadPending, mobileAttachmentBridgePending, setMobileAttachmentBridgePending,
  mobileEditSaving, fileItems, fileInputRef, handleFileUpload, removeFile,
  removeAttachment, mobileCommentActionsRef, mobileCommentActionsTriggerRef, mobileEditPersistedSourcesRef, mobileEditBridgeAttachmentCountsRef,
  mobileEditBridgeSourceCountsRef, closeMobileCommentActions, openAttachmentPicker, handleAnyAttachmentClick, insertEditorTrigger,
  handleMobileAttachmentBridgeFailure, handleDiscardDrafts,
  } = useAttachmentUploadState({
    props,
  });
  if (_mbl && mobileExistingEdit) return renderMobileAttachmentEdit({
    _mbl, mobileExistingEdit, isRecording, audioProcessing, fileItems,
    mobileEditSaving, setMobileUploadPending, removeFile, setMobileAttachmentBridgePending, mobileEditBridgeAttachmentCountsRef,
    mobileEditBridgeSourceCountsRef, callback, handleMobileAttachmentBridgeFailure, mobileEditPersistedSourcesRef, mobileCommentActionsRef,
    mobileCommentActionsTriggerRef, closeMobileCommentActions, openAttachmentPicker, insertEditorTrigger, onCancelMobileEdit,
    toggleAiTaskWriter, audioTiptapCallback, toggleRecording, hideComposerDictation, editor,
    mode, hasText, setAudioProcessing, mobileUploadPending, mobileAttachmentBridgePending,
    sendOnClick, handleFileUpload, fileInputRef,
  });

  return (
    <div
      className={`attachment-upload-container ${
        fileItems.length > 0 || editor?.isFocused || isRecording || audioProcessing ? "" : "m-auto"
      }`}
    >
      {!_mbl && mode !== "create-comment" && (
        <hr className=" w-full text-[#212429] dark:text-icon-dark-gray my-2 h-[0.2px] opacity-20 " />
      )}

      {
        // ========================================================== MOBILE ==============================
        _mbl && mode !== "create-task-modal" ? (
          // One flex row, not two nested spans: the mic has to sit between the
          // attach glyph and Send once text exists, and moving it across span
          // boundaries would re-parent it in the React tree and tear down an
          // in-flight MediaRecorder (#2666). Flex `order` moves it visually
          // while the element stays put. HTPR-5684.
          <div className="attachment-button p-0 flex flex-row rounded-sm items-center w-full gap-2">
            {(fileItems.length > 0 || editor?.isFocused || isRecording || audioProcessing) &&
              !(mode === "create-comment" && isRecording) && (
                <>
                  {audioTiptapCallback && mode !== "create-comment" && (
                    <AudioButton
                      callbackHandler={audioTiptapCallback}
                      editor={editor}
                      id={mode + "-audio-button"}
                      toggleRecording={toggleRecording!}
                      globalRecording={isRecording}
                      // Keeps this row mounted while the transcript streams
                      // back: stopping capture clears isRecording before the
                      // request finishes, and a blur with no files attached
                      // would otherwise unmount the mic mid-transcription.
                      onProcessingChange={setAudioProcessing}
                      wrapperClassName="order-3"
                    />
                  )}
                  {mode !== "create-comment" &&
                  !isRecording &&
                  !audioProcessing &&
                  toggleAiTaskWriter ? (
                    <button
                      type="button"
                      id={mode + "-ai-writer-button"}
                      aria-label="Write with AI"
                      className={cn(
                        MOBILE_TARGET,
                        "order-4 inline-flex touch-manipulation items-center rounded-sm px-2 text-meta font-semibold text-hypertasks-ai-purple",
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleAiTaskWriter();
                      }}
                    >
                      ai
                    </button>
                  ) : null}
                </>
              )}
            {mode === "create-comment" ? (
              <>
                {!isRecording && !audioProcessing && (
                  <details
                    ref={mobileCommentActionsRef}
                    className="order-1 relative shrink-0"
                  >
                    <summary
                      ref={mobileCommentActionsTriggerRef}
                      aria-label="More comment actions"
                      className={cn(
                        MOBILE_TARGET,
                        "flex list-none cursor-pointer items-center justify-center rounded-[4px] text-icon-dark-gray hover:text-white-black [&::-webkit-details-marker]:hidden",
                      )}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Plus size={20} strokeWidth={1.75} aria-hidden />
                    </summary>
                    <div
                      role="menu"
                      aria-label="More comment actions"
                      className="absolute bottom-[calc(100%_+_0.5rem)] left-0 z-[1100] w-[240px] overflow-hidden rounded-[4px] bg-modalBackground p-1.5 text-content text-white-black shadow-[0_8px_30px_rgba(0,0,0,0.45)]"
                      onClickCapture={closeMobileCommentActions}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className="flex min-h-11 w-full items-center gap-3 rounded-[4px] px-3 text-left hover:bg-active-modal-element"
                        onClick={(event) => {
                          event.stopPropagation();
                          openAttachmentPicker("image/*");
                        }}
                      >
                        <ImageIcon size={18} strokeWidth={1.75} aria-hidden />
                        Attach image
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="flex min-h-11 w-full items-center gap-3 rounded-[4px] px-3 text-left hover:bg-active-modal-element"
                        onClick={(event) => {
                          event.stopPropagation();
                          openAttachmentPicker();
                        }}
                      >
                        <Paperclip size={18} strokeWidth={1.75} aria-hidden />
                        Attach file
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="flex min-h-11 w-full items-center gap-3 rounded-[4px] px-3 text-left hover:bg-active-modal-element"
                        onClick={(event) => {
                          event.stopPropagation();
                          insertEditorTrigger("@");
                        }}
                      >
                        <AtSign size={18} strokeWidth={1.75} aria-hidden />
                        Mention someone
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="flex min-h-11 w-full items-center gap-3 rounded-[4px] px-3 text-left hover:bg-active-modal-element"
                        onClick={(event) => {
                          event.stopPropagation();
                          insertEditorTrigger("/");
                        }}
                      >
                        <Slash size={18} strokeWidth={1.75} aria-hidden />
                        Commands
                      </button>
                      {showDeleteComment === true && (
                        <button
                          type="button"
                          role="menuitem"
                          id={mode + "-discard-draft-button"}
                          className="flex min-h-11 w-full items-center gap-3 rounded-[4px] px-3 text-left text-destructive hover:bg-active-modal-element"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDiscardDrafts();
                          }}
                        >
                          <Trash2 size={18} strokeWidth={1.75} aria-hidden />
                          Discard draft
                        </button>
                      )}
                    </div>
                  </details>
                )}
                {!isRecording && !audioProcessing && toggleAiTaskWriter && (
                  <button
                    type="button"
                    id={mode + "-ai-writer-button"}
                    aria-label="Write with AI"
                    className={cn(
                      MOBILE_TARGET,
                      "order-2 inline-flex touch-manipulation items-center justify-center rounded-[4px] text-hypertasks-ai-purple",
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleAiTaskWriter();
                    }}
                  >
                    <PencilSparkles size={20} strokeWidth={1.75} aria-hidden />
                  </button>
                )}
                {audioTiptapCallback && !hideComposerDictation && (
                  <AudioButton
                    callbackHandler={audioTiptapCallback}
                    editor={editor}
                    id={mode + "-audio-button"}
                    toggleRecording={toggleRecording!}
                    globalRecording={isRecording}
                    hasText={hasText}
                    onProcessingChange={setAudioProcessing}
                    ariaLabel="Start dictation"
                    wrapperClassName={mobileCommentMicWrapperClass({
                      hasText,
                      isRecording,
                      isProcessing: audioProcessing,
                    })}
                  />
                )}
                {!isRecording && !audioProcessing && hasText ? (
                  <span
                    className={cn(
                      "order-6 flex items-center",
                      (!audioTiptapCallback || hideComposerDictation) && "ml-auto",
                    )}
                  >
                    <SaveButtonMobile
                      sendOnClick={props.sendOnClick}
                      mode={mode}
                      audioTiptapCallback={audioTiptapCallback}
                      audioDefaultContent={editor?.getHTML()}
                      toggleRecording={toggleRecording}
                      editor={editor}
                      handleDiscardDrafts={handleDiscardDrafts}
                    />
                  </span>
                ) : null}
              </>
            ) : (
              // Description / existing-comment editing shares this row. Its
              // Save button used to be pushed right by the old flex-grow
              // spacer; in a flat ordered row an unordered child is order 0 and
              // would sort AHEAD of the mic and Improve. Same trailing slot as
              // Send.
              <span className="order-6 ml-auto flex items-center">
                <SaveButtonMobile
                  sendOnClick={props.sendOnClick}
                  mode={mode}
                  audioTiptapCallback={audioTiptapCallback}
                  audioDefaultContent={editor?.getHTML()}
                  toggleRecording={toggleRecording}
                  editor={editor}
                  handleDiscardDrafts={handleDiscardDrafts}
                />
              </span>
            )}
          </div>
        ) : _mbl && mode === "create-task-modal" ? (
          <MobileBottomBar
            hasText={hasSavableContent}
            sendOnClick={props.sendOnClick}
            handleAttachmentClick={handleAnyAttachmentClick}
            audioTiptapCallback={audioTiptapCallback}
            toggleRecording={toggleRecording}
            editor={editor}
            isRecording={isRecording}
            isProcessing={audioProcessing}
            onProcessingChange={setAudioProcessing}
            dictationCoordinator={dictationCoordinator}
            toggleAiTaskWriter={toggleAiTaskWriter}
            isAiTaskWriterOpen={isAiTaskWriterOpen}
            descriptionFirst={descriptionFirstEnabled}
          />
        ) : (
          // ========================================================== DESKTOP ==============================
          <DesktopAttachment
            mode={mode}
            sendOnClick={sendOnClick}
            handleAttachmentClick={handleAnyAttachmentClick}
            presentInInbox={inInbox}
            handleCallback={handleCallback}
            status={status}
            handleDiscardDrafts={handleDiscardDrafts}
            showDeleteComment={showDeleteComment}
            onCancelEditComment={onCancelEditComment}
            toggleAiTaskWriter={toggleAiTaskWriter}
            audioTiptapCallback={audioTiptapCallback}
            audioDefaultContent={editor?.getHTML()}
            toggleRecording={toggleRecording}
            editor={editor}
            isRecording={isRecording}
            hideComposerDictation={hideComposerDictation}
            dictationCoordinator={dictationCoordinator}
          />
        )
      }

      {/* ======================'================================= ATTACHMENTS ================================ */}

      <div
        className={`sm:block w-full ${
          _mbl &&
          fileItems.length === 0 &&
          !editor?.isFocused &&
          mode !== "create-task-modal"
            ? "hidden h-0"
            : ""
        }`}
      >
        {/* ============================= map all the files =================== */}
        <div className={`flex flex-wrap gap-2 py-2`}>
          {mode === "create-task-modal" && returnUploadedAttachments ? (
            <ImageGallery
              files={fileItems}
              images={[]}
              allowDelete={true}
              shouldUpload={true}
              handleRemove={removeAttachment}
              mode="Creating task"
              callbackAttachments={returnUploadedAttachments}
              backgroundTaskUploads={backgroundTaskUploads}
            />
          ) : (
            <ImageGallery
              files={fileItems}
              images={[]}
              allowDelete={true}
              shouldUpload={false}
              mode="others"
              handleRemove={removeFile}
            />
          )}
        </div>
      </div>
      <input
        id={mode + "-" + "attachmentUpload"}
        type="file"
        multiple
        onChange={handleFileUpload}
        style={{ display: "none", color: "white" }}
        ref={fileInputRef}
      />
    </div>
  );
};

export default React.memo(AttachmentsUpload);
