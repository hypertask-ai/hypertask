import toast from "react-hot-toast";
import ImageGallery from "./ImageGalleryView";
import { AtSign, Check, Image as ImageIcon, Paperclip, PencilSparkles, Plus, Slash, Trash2 } from "lucide-react";
import { AudioButton } from "@/components/RTE/Components/AudioButton";
import { cn } from "@/utils/undoActions/helperFuncs";
import { MOBILE_TARGET } from "@/lib/configs/general.config";
import type { useAttachmentUploadState } from "./useAttachmentUploadState";

type Context = Pick<ReturnType<typeof useAttachmentUploadState>, "_mbl" | "mobileExistingEdit" | "isRecording" | "audioProcessing" | "fileItems" | "mobileEditSaving" | "setMobileUploadPending" | "removeFile" | "setMobileAttachmentBridgePending" | "mobileEditBridgeAttachmentCountsRef" | "mobileEditBridgeSourceCountsRef" | "callback" | "handleMobileAttachmentBridgeFailure" | "mobileEditPersistedSourcesRef" | "mobileCommentActionsRef" | "mobileCommentActionsTriggerRef" | "closeMobileCommentActions" | "openAttachmentPicker" | "insertEditorTrigger" | "onCancelMobileEdit" | "toggleAiTaskWriter" | "audioTiptapCallback" | "toggleRecording" | "hideComposerDictation" | "editor" | "mode" | "hasText" | "setAudioProcessing" | "mobileUploadPending" | "mobileAttachmentBridgePending" | "sendOnClick" | "handleFileUpload" | "fileInputRef">;

export function renderMobileAttachmentEdit(context: Context) {
  const {
  _mbl, mobileExistingEdit, isRecording, audioProcessing, fileItems,
  mobileEditSaving, setMobileUploadPending, removeFile, setMobileAttachmentBridgePending, mobileEditBridgeAttachmentCountsRef,
  mobileEditBridgeSourceCountsRef, callback, handleMobileAttachmentBridgeFailure, mobileEditPersistedSourcesRef, mobileCommentActionsRef,
  mobileCommentActionsTriggerRef, closeMobileCommentActions, openAttachmentPicker, insertEditorTrigger, onCancelMobileEdit,
  toggleAiTaskWriter, audioTiptapCallback, toggleRecording, hideComposerDictation, editor,
  mode, hasText, setAudioProcessing, mobileUploadPending, mobileAttachmentBridgePending,
  sendOnClick, handleFileUpload, fileInputRef,
  } = context;


  if (_mbl && mobileExistingEdit) {
    const dictating = isRecording || audioProcessing;

    return (
      <div className="attachment-upload-container shrink-0">
        {fileItems.length > 0 && (
          <div className="w-full">
            <div className="flex flex-wrap gap-2 py-2">
              <ImageGallery
                files={fileItems}
                images={[]}
                allowDelete={!mobileEditSaving}
                shouldUpload={true}
                mode="others"
                onUploadPendingChange={setMobileUploadPending}
                onUploadFailed={removeFile}
                callbackAttachments={async (
                  uploadedAttachments: Array<{ id: number; file: File }>,
                ) => {
                  setMobileAttachmentBridgePending((pending) => pending + 1);
                  const attachmentIds = new Set(uploadedAttachments.map(({ id }) => id));
                  const sources = new Set(
                    uploadedAttachments
                      .map(({ file }) => (file as File & { source?: string }).source)
                      .filter((source): source is string => Boolean(source)),
                  );
                  attachmentIds.forEach((id) => {
                    const count = mobileEditBridgeAttachmentCountsRef.current.get(id) ?? 0;
                    mobileEditBridgeAttachmentCountsRef.current.set(id, count + 1);
                  });
                  sources.forEach((source) => {
                    const count = mobileEditBridgeSourceCountsRef.current.get(source) ?? 0;
                    mobileEditBridgeSourceCountsRef.current.set(source, count + 1);
                  });
                  try {
                    const result = await callback(
                      uploadedAttachments.map((attachment) => attachment.file),
                    );
                    if (result === false) {
                      handleMobileAttachmentBridgeFailure(uploadedAttachments);
                    } else {
                      uploadedAttachments.forEach(({ file }) => {
                        const source = (file as File & { source?: string }).source;
                        if (source) mobileEditPersistedSourcesRef.current.add(source);
                      });
                    }
                  } catch (error) {
                    handleMobileAttachmentBridgeFailure(uploadedAttachments, error);
                  } finally {
                    attachmentIds.forEach((id) => {
                      const count = mobileEditBridgeAttachmentCountsRef.current.get(id) ?? 0;
                      if (count <= 1) mobileEditBridgeAttachmentCountsRef.current.delete(id);
                      else mobileEditBridgeAttachmentCountsRef.current.set(id, count - 1);
                    });
                    sources.forEach((source) => {
                      const count = mobileEditBridgeSourceCountsRef.current.get(source) ?? 0;
                      if (count <= 1) mobileEditBridgeSourceCountsRef.current.delete(source);
                      else mobileEditBridgeSourceCountsRef.current.set(source, count - 1);
                    });
                    setMobileAttachmentBridgePending((pending) => Math.max(0, pending - 1));
                  }
                }}
                handleRemove={mobileEditSaving ? undefined : removeFile}
              />
            </div>
          </div>
        )}

        <div className="attachment-button flex min-h-11 w-full items-center gap-2 p-0">
          {!dictating && (
            <details
              ref={mobileCommentActionsRef}
              className="relative shrink-0"
            >
              <summary
                ref={mobileCommentActionsTriggerRef}
                aria-label="More edit actions"
                aria-disabled={mobileEditSaving}
                className={cn(
                  MOBILE_TARGET,
                  "flex list-none items-center justify-center rounded-[4px] text-icon-dark-gray [&::-webkit-details-marker]:hidden",
                  mobileEditSaving ? "pointer-events-none opacity-40" : "cursor-pointer hover:text-white-black",
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  if (mobileEditSaving) event.preventDefault();
                }}
              >
                <Plus size={20} strokeWidth={1.75} aria-hidden />
              </summary>
              <div
                role="menu"
                aria-label="More edit actions"
                className="absolute bottom-[calc(100%_+_0.5rem)] left-0 z-[1100] w-[240px] overflow-hidden rounded-[4px] bg-modalBackground p-1.5 text-content text-white-black shadow-md"
                onClickCapture={closeMobileCommentActions}
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={mobileEditSaving}
                  className="flex min-h-11 w-full items-center gap-3 rounded-[4px] px-3 text-left hover:bg-active-modal-element disabled:opacity-40"
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
                  disabled={mobileEditSaving}
                  className="flex min-h-11 w-full items-center gap-3 rounded-[4px] px-3 text-left hover:bg-active-modal-element disabled:opacity-40"
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
                  disabled={mobileEditSaving}
                  className="flex min-h-11 w-full items-center gap-3 rounded-[4px] px-3 text-left hover:bg-active-modal-element disabled:opacity-40"
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
                  disabled={mobileEditSaving}
                  className="flex min-h-11 w-full items-center gap-3 rounded-[4px] px-3 text-left hover:bg-active-modal-element disabled:opacity-40"
                  onClick={(event) => {
                    event.stopPropagation();
                    insertEditorTrigger("/");
                  }}
                >
                  <Slash size={18} strokeWidth={1.75} aria-hidden />
                  Commands
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={mobileEditSaving || !onCancelMobileEdit}
                  className="flex min-h-11 w-full items-center gap-3 rounded-[4px] px-3 text-left text-destructive hover:bg-active-modal-element disabled:opacity-40"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCancelMobileEdit?.();
                  }}
                >
                  <Trash2 size={18} strokeWidth={1.75} aria-hidden />
                  Discard changes
                </button>
              </div>
            </details>
          )}

          {!dictating && toggleAiTaskWriter && (
            <button
              type="button"
              aria-label="Write with AI"
              disabled={mobileEditSaving}
              onClick={(event) => {
                event.stopPropagation();
                toggleAiTaskWriter();
              }}
              className={cn(
                MOBILE_TARGET,
                "flex items-center justify-center rounded-[4px] text-hypertasks-ai-purple disabled:opacity-40",
              )}
            >
              <PencilSparkles size={20} strokeWidth={1.75} aria-hidden />
            </button>
          )}

          {audioTiptapCallback && toggleRecording && !hideComposerDictation && (
            <AudioButton
              callbackHandler={audioTiptapCallback}
              editor={editor}
              id={mode + "-audio-button"}
              toggleRecording={toggleRecording}
              globalRecording={isRecording}
              hasText={hasText}
              onProcessingChange={setAudioProcessing}
              ariaLabel="Start dictation"
              mobilePresentation="compact"
              disabled={mobileEditSaving}
              wrapperClassName={dictating ? "min-w-0 flex-1" : undefined}
              visualizerClassName="!mb-0"
            />
          )}

          {!dictating && (
            <button
              type="button"
              aria-label="Done editing"
              disabled={
                mobileEditSaving ||
                mobileUploadPending ||
                mobileAttachmentBridgePending > 0 ||
                !sendOnClick
              }
              onClick={async (event) => {
                event.stopPropagation();
                try {
                  const result = await sendOnClick?.();
                  if (result === false) {
                    toast.error("Could not save. Your changes are still here.");
                  }
                } catch (error) {
                  console.error("Could not save editor content", error);
                  toast.error("Could not save. Your changes are still here.");
                }
              }}
              className="ml-auto flex min-h-11 shrink-0 items-center gap-1.5 rounded-[4px] bg-white-black px-3 text-meta font-bold text-white-black-inverted hover:opacity-90 disabled:opacity-40"
            >
              DONE
              <Check size={18} strokeWidth={2} aria-hidden />
            </button>
          )}
        </div>

        <input
          id={mode + "-attachmentUpload"}
          type="file"
          multiple
          disabled={mobileEditSaving}
          onChange={handleFileUpload}
          className="hidden"
          ref={fileInputRef}
        />
      </div>
    );
  }
}
