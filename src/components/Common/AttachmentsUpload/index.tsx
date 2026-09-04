import React, {
  ChangeEvent,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import toast from "react-hot-toast";
import ImageGallery from "./ImageGalleryView";
import { processFiles } from "@/utils/helperFunctions/helperFunctions";
import "@/styles/attachmentUpload.scss";
import {
  AtSign,
  Check,
  CodeXml,
  Image as ImageIcon,
  Paperclip,
  PencilSparkles,
  Plus,
  Slash,
  Trash2,
} from "lucide-react";
export interface FileItem {
  id: number;
  file: File;
}

import Tooltip from "../Tooltip";
import { useGetUserPreferences } from "@/hooks/General/useGetUserPreferences";
import { IStatus, RedirectMode } from "@/models/model";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import {
  TSendBackAttachmentButton,
  TSendBackButtonParam,
} from "@/models/CreateTaskModalModels/model";
import { AudioButton } from "@/components/RTE/Components/AudioButton";
import {
  mobileCommentMicWrapperClass,
  mobileEditorTriggerText,
} from "./mobileCommentComposer";
import { useFileUpload } from "./FileUploadHandler";
import { cn } from "@/utils/undoActions/helperFuncs";
import { MOBILE_TARGET } from "@/lib/configs/general.config";
import { SendArrow } from "@/components/Common/SendArrow";
import type { DictationCoordinator } from "@/lib/dictationCoordinator";
import { discardUnboundCreateTaskUploads } from "@/lib/createTaskAttachmentUploads";

interface IProps {
  /** create-task-modal only: the modal's title field has text. Save must
      appear for a title-only task even though the description editor is empty. */
  hasTitle?: boolean;
  callback: (files: File[]) => void | boolean | Promise<void | boolean>;
  trigger: boolean;
  filesFromParent: any[];
  mode: RedirectMode;
  sendOnClick?: TSendBackAttachmentButton;
  editor: Editor | null;
  returnUploadedAttachments?: (attachmentsReturned: any[]) => Promise<void>;
  inInbox?: boolean;
  handleCallback?: (
    mode_?: "moveToNext",
    inbox?: boolean,
    markAsDone?: boolean
  ) => Promise<boolean | undefined>;
  status?: IStatus;
  droppedFiles: File[];
  resetDropFiles?: () => void;
  discardDraft?: (discard: "Description" | "Comment") => void;
  showDeleteComment?: boolean;
  onCancelEditComment?: () => void;
  toggleAiTaskWriter?: () => void;
  audioTiptapCallback?: (text: string, setContent?: boolean) => void;
  audioDefaultContent?: string | undefined;
  toggleRecording?: (val: boolean) => void;
  isRecording: boolean;
  isAiTaskWriterOpen?: boolean;
  /** Hide the toolbar mic while the inline draft AI float owns dictation. */
  hideComposerDictation?: boolean;
  dictationCoordinator?: DictationCoordinator;
  mobileExistingEdit?: boolean;
  mobileEditSaving?: boolean;
  onCancelMobileEdit?: () => void;
  backgroundTaskUploads?: boolean;
}

const AttachmentsUpload = (props: IProps) => {
  const {
    editor,
    callback,
    returnUploadedAttachments,
    mode,
    inInbox,
    handleCallback,
    sendOnClick,
    status,
    droppedFiles,
    resetDropFiles,
    discardDraft,
    showDeleteComment,
    onCancelEditComment,
    toggleAiTaskWriter,
    audioTiptapCallback,
    audioDefaultContent,
    toggleRecording,
    isRecording,
    isAiTaskWriterOpen,
    hideComposerDictation,
    dictationCoordinator,
    mobileExistingEdit = false,
    mobileEditSaving: mobileEditSavingProp = false,
    onCancelMobileEdit,
    backgroundTaskUploads = false,
  } = props;
  const _mbl = useContext(MobileViewContext);
  // Reactive: Tiptap v3 useEditor does not re-render on typing, so subscribe
  // (same pattern as the AI-chat composer) or Send/mic state lags behind text.
  const hasText =
    (useEditorState({
      editor,
      selector: ({ editor }) => (editor?.getText().length ?? 0) > 0,
    }) ?? false) as boolean;
  // The wireframe rule is "commit controls appear with content". For a task,
  // content includes the title: a title-only task is savable (HTPR-5517).
  const hasSavableContent = hasText || Boolean(props.hasTitle);
  const [audioProcessing, setAudioProcessing] = useState(false);
  const [mobileUploadPending, setMobileUploadPending] = useState(false);
  const [mobileAttachmentBridgePending, setMobileAttachmentBridgePending] = useState(0);
  const mobileEditSaving =
    mobileEditSavingProp ||
    mobileUploadPending ||
    mobileAttachmentBridgePending > 0;
  const {
    fileItems,
    files,
    fileInputRef,
    triggerFileInput,
    handleFileUpload,
    handleDroppedFiles,
    removeFile,
    clearFiles,
    resetFiles,
    setFileItems,
  } = useFileUpload(props.filesFromParent);
  const removeAttachment = (name: string) => {
    if (backgroundTaskUploads) {
      discardUnboundCreateTaskUploads(
        fileItems.filter(({ file }) => file.name === name),
      );
    }
    removeFile(name);
  };
  const mobileCommentActionsRef = useRef<HTMLDetailsElement>(null);
  const mobileCommentActionsTriggerRef = useRef<HTMLElement>(null);
  const mobileEditWasOpenRef = useRef(false);
  const mobileEditPersistedSourcesRef = useRef<Set<string>>(new Set());
  const mobileEditBridgeAttachmentCountsRef = useRef<Map<number, number>>(new Map());
  const mobileEditBridgeSourceCountsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (mobileExistingEdit && !mobileEditWasOpenRef.current) {
      mobileEditPersistedSourcesRef.current = new Set(
        props.filesFromParent
          .map(({ file }) => (file as File & { source?: string }).source)
          .filter((source): source is string => Boolean(source)),
      );
    }
    mobileEditWasOpenRef.current = mobileExistingEdit;
  }, [mobileExistingEdit, props.filesFromParent]);

  const closeMobileCommentActions = () => {
    if (mobileCommentActionsRef.current) {
      mobileCommentActionsRef.current.open = false;
    }
  };

  const openAttachmentPicker = (accept = "") => {
    const input = fileInputRef.current;
    if (!input) return;
    input.accept = accept;
    input.value = "";
    input.click();
  };

  const handleAnyAttachmentClick = (event?: { stopPropagation?: () => void }) => {
    event?.stopPropagation?.();
    openAttachmentPicker();
  };

  const insertEditorTrigger = (trigger: "@" | "/") => {
    if (!editor) return;
    const { $from } = editor.state.selection;
    const nodeBefore = $from.nodeBefore;
    let textBeforeCaret = "";
    if (nodeBefore?.isText) {
      textBeforeCaret = nodeBefore.text?.slice(-1) ?? "";
    } else if (nodeBefore?.type.name === "hardBreak") {
      textBeforeCaret = "\n";
    } else if (nodeBefore) {
      textBeforeCaret = "\uFFFC";
    }
    editor
      .chain()
      .focus()
      .insertContent(mobileEditorTriggerText(trigger, textBeforeCaret))
      .run();
  };

  const handleMobileAttachmentBridgeFailure = (
    uploadedAttachments: Array<{
      id: number;
      file: File & { source?: string };
    }>,
    error?: unknown,
  ) => {
    if (error) console.error("Could not add attachment", error);

    const rejectedIds = new Set(
      uploadedAttachments
        .filter(({ id, file }) => {
          const source = (file as File & { source?: string }).source;
          const sourceIsPersisted =
            source && mobileEditPersistedSourcesRef.current.has(source);
          const attachmentIsShared =
            (mobileEditBridgeAttachmentCountsRef.current.get(id) ?? 0) > 1;
          const sourceIsShared =
            source !== undefined &&
            (mobileEditBridgeSourceCountsRef.current.get(source) ?? 0) > 1;
          return !sourceIsPersisted && !attachmentIsShared && !sourceIsShared;
        })
        .map(({ id }) => id),
    );
    if (rejectedIds.size > 0) {
      setFileItems((prevItems) =>
        prevItems.filter(({ id }) => !rejectedIds.has(id)),
      );
    }
    toast.error("Could not add attachment. Your changes are still here.");
  };

  useEffect(() => {
    if (!_mbl || (mode !== "create-comment" && !mobileExistingEdit)) return;

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (
        mobileCommentActionsRef.current?.open &&
        !mobileCommentActionsRef.current.contains(event.target as Node)
      ) {
        closeMobileCommentActions();
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !mobileCommentActionsRef.current?.open) return;
      closeMobileCommentActions();
      mobileCommentActionsTriggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [_mbl, mode, mobileExistingEdit]);

  useEffect(() => {
    if (isRecording || audioProcessing) closeMobileCommentActions();
  }, [isRecording, audioProcessing]);

  const handleDrop = async (files: File[]) => {
    const startingId = fileItems.length;

    // Filter out duplicates before processing
    const uniqueFiles = Array.from(files).filter(
      (newFile) =>
        !fileItems.some(
          (existingFile) =>
            existingFile.file.name === newFile.name &&
            existingFile.file.size === newFile.size
        )
    );

    if (uniqueFiles.length === 0) {
      resetDropFiles && resetDropFiles();
      return;
    }

    const newFileItems = await processFiles(
      uniqueFiles as unknown as FileList,
      startingId
    );
    setFileItems((prevItems) => [...prevItems, ...newFileItems]);
    resetDropFiles && resetDropFiles();
  };

  const handleDiscardDrafts = () => {
    discardDraft &&
      discardDraft(mode === "create-comment" ? "Comment" : "Description");
    if (mode === "create-comment") setFileItems([]);
  };

  // use effect
  useEffect(() => {
    props.callback(fileItems.map((file) => file.file));
  }, [fileItems]);
  // useEffect(()=>{
  //   if (props.filesFromParent) props.callback(props.filesFromParent.map(file=>file.file))

  // },[])

  useEffect(() => {
    if (props.filesFromParent.length === 0) {
      setFileItems([]);
    } else {
      setFileItems(props.filesFromParent);
    }
  }, [props.trigger]);

  useEffect(() => {
    if (droppedFiles.length > 0) handleDrop(droppedFiles);
  }, [droppedFiles]);

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

// ================================ MOBILE save button
interface IPropsSaveButtonMobile {
  sendOnClick: any;
  mode: RedirectMode;
  audioTiptapCallback?: (text: string, setContent?: boolean) => void;
  audioDefaultContent?: string | undefined;
  toggleRecording?: (val: boolean) => void;
  editor: Editor | null;
  handleDiscardDrafts: () => void;
}

interface IMobileBottomBar {
  hasText?: boolean;
  handleAttachmentClick: (e?: any) => void;
  sendOnClick: any;
  audioTiptapCallback?: (text: string, setContent?: boolean) => void;
  toggleRecording?: (val: boolean) => void;
  editor: Editor | null;
  isRecording?: boolean;
  isProcessing?: boolean;
  onProcessingChange?: (processing: boolean) => void;
  dictationCoordinator?: DictationCoordinator;
  toggleAiTaskWriter?: () => void;
  isAiTaskWriterOpen?: boolean;
}

const ActionButton = React.forwardRef<HTMLSpanElement, any>(({ label, onClick }, ref) => {
  return (
    <span
      ref={ref}
      role="button"
      tabIndex={0}
      className={cn(
        MOBILE_TARGET,
        "rounded-sm px-2 border-thin border-icon-dark-gray cursor-pointer whitespace-nowrap"
      )}
      onClick={(e) => {
        e.stopPropagation();
        onClick && onClick(e);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        onClick && onClick(e);
      }}
    >
      {label}
    </span>
  );
});
ActionButton.displayName = "ActionButton";

const MobileBottomBar: React.FC<IMobileBottomBar> = ({
  hasText,
  handleAttachmentClick,
  sendOnClick,
  audioTiptapCallback,
  toggleRecording,
  editor,
  isRecording,
  isProcessing,
  onProcessingChange,
  dictationCoordinator,
  toggleAiTaskWriter,
  isAiTaskWriterOpen,
}) => {
  const saveRef = useRef<HTMLSpanElement>(null);
  const wasDictating = useRef(false);
  const isDictating = Boolean(isRecording || isProcessing);
  let recorderWrapperClassName = hasText ? "order-2" : "order-4";
  if (isDictating) recorderWrapperClassName = "flex min-h-[62px] w-full items-center";
  const barRef = useRef<HTMLDivElement>(null);
  const wasAiTaskWriterOpen = useRef(false);
  // Dictation is the likeliest way a task gets written on a phone, and Save is
  // what you want next. The row scrolls, so Save can be sitting past the right
  // edge exactly when dictation finishes (HTPR-5147). Bring it back into view.
  useEffect(() => {
    if (wasDictating.current && !isDictating) {
      saveRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    wasDictating.current = isDictating;
  }, [isDictating]);

  // Returning from Task Writer focuses the editor and commonly reopens the
  // keyboard. Restore the action bar vertically; primary controls no longer
  // depend on the row's previous horizontal scroll position.
  useEffect(() => {
    if (wasAiTaskWriterOpen.current && !isAiTaskWriterOpen) {
      barRef.current?.scrollIntoView({ block: "nearest" });
    }
    wasAiTaskWriterOpen.current = Boolean(isAiTaskWriterOpen);
  }, [isAiTaskWriterOpen]);

  return (
    // HTPR-5332 supersedes only the scroll dependency: AI, dictation, the
    // full-width waveform, and Save-after-dictation behavior below stay intact.
    // w-full + min-w-0: the row already asked to scroll, but a flex child sizes to
    // its content unless it is bounded, so the actions ran off the screen edge
    // instead (HTPR-5040).
    <div ref={barRef} data-mobile-new-task-actions className="relative flex w-full min-w-0 items-center gap-1.5 overflow-visible pb-[env(safe-area-inset-bottom)] scroll-mb-[calc(env(safe-area-inset-bottom)_+_0.5rem)] text-meta font-semibold text-icon-hover-gray">
      {/* The AI writer used to be a 16px "ai" link floating in the description
          card corner. It belongs where the other actions live, and first: the row
          scrolls, so the control reached for most is the one never scrolled to
          (HTPR-5098). */}
      {!isDictating && (
        <button
          type="button"
          aria-label="Attach files"
          onClick={(e) => {
            e.stopPropagation();
            handleAttachmentClick();
          }}
          className={cn(
            MOBILE_TARGET,
            "order-1 shrink-0 rounded-sm text-icon-dark-gray hover:text-white-black",
          )}
        >
          <Paperclip size={20} strokeWidth={1.75} />
        </button>
      )}
      {/* Dictation is how tasks get created on a phone: it went missing when this
          bar stopped reusing the desktop row. Keep this instance mounted while
          recording so the first tap's MediaRecorder is not discarded (#2666). */}
      {toggleRecording && audioTiptapCallback && (
        <AudioButton
          key="new-task-dictation"
          callbackHandler={audioTiptapCallback}
          editor={editor}
          id="create-task-modal-audio-button"
          toggleRecording={toggleRecording}
          globalRecording={isRecording}
          hasText={hasText}
          onProcessingChange={onProcessingChange}
          dictationCoordinator={dictationCoordinator}
          ariaLabel="Dictate description"
          mobilePresentation="prominent"
          // Canonical exception: openwiki/style-guide.md approves the white buttons for
          // https://app.hypertask.ai/detail/project-15/5995.
          mobilePrimaryTone="default"
          className={isDictating ? undefined : MOBILE_TARGET}
          // order lives on the wrapper: only the .audio-recorder root is a
          // direct child of this flex row, so order on className is a no-op.
          wrapperClassName={recorderWrapperClassName}
          visualizerClassName="!mb-0 w-full"
        />
      )}
      {!isDictating && toggleAiTaskWriter && (
        <button
          type="button"
          id="create-task-modal-ai-writer-button"
          aria-label="Write with AI"
          onClick={(e) => {
            e.stopPropagation();
            toggleAiTaskWriter();
          }}
          className={cn(
            MOBILE_TARGET,
            "order-3 ml-auto inline-flex min-w-0 shrink-0 items-center justify-center rounded-sm text-hypertasks-ai-purple"
          )}
        >
          <PencilSparkles size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
      {/* Dictation is how tasks get created on a phone: it went missing when this
          bar stopped reusing the desktop row. Keep this instance mounted while
          recording so the first tap's MediaRecorder is not discarded. */}
      {!isDictating && hasText && (
        <div
          data-mobile-primary-save
          className="order-6 shrink-0 [&>span]:!border-transparent [&>span]:!bg-shadcn-primary [&>span]:!text-primary-foreground"
        >
          <ActionButton
            ref={saveRef}
            label="Save"
            onClick={() => sendOnClick && sendOnClick("Save")}
          />
        </div>
      )}

    </div>
  );
};
// ====================================
const SaveButtonMobile: React.FC<IPropsSaveButtonMobile> = ({
  sendOnClick,
  mode,
  audioDefaultContent,
  audioTiptapCallback,
  toggleRecording,
  handleDiscardDrafts,
  editor,
}) => {
  return (
    <span className="text-content text-icon-dark-gray font-semibold">
      {mode === "create-comment" ? (
        <button
          aria-label="Send comment"
          className="flex h-11 w-12 touch-manipulation items-center justify-center rounded-[4px] bg-white-black text-white-black-inverted hover:opacity-90"
          onClick={(e) => {
            e.stopPropagation();
            sendOnClick && sendOnClick();
          }}
          type="button"
        >
          <SendArrow size={22} />
        </button>
      ) : mode === "create-task-modal" ? (
        <div className="flex flex-col gap-2 items-end w-full">
          <span
            onClick={(e) => {
              e.stopPropagation();
              sendOnClick && sendOnClick("Save");
            }}
          >
            Save
          </span>
          <span
            onClick={(e) => {
              e.stopPropagation();
              sendOnClick && sendOnClick("SaveAndClose");
            }}
          >
            {" "}
            Save and close
          </span>
          <span
            onClick={(e) => {
              e.stopPropagation();
              sendOnClick && sendOnClick("SaveAndNew");
            }}
          >
            Save and create new task
          </span>
        </div>
      ) : (
        <div className="flex justify-between w-full gap-2 items-center">
          {mode === "read-edit-description" && (
            <Trash2
              size={20}
              className="text-icon-dark-gray hover:text-white-black ml-auto cursor-pointer"
              id={mode + "-discard-draft-button"}
              strokeWidth={1.75}
              onClick={handleDiscardDrafts}
            />
          )}
          {audioTiptapCallback && mode === "read-edit-description" && (
            <AudioButton
              callbackHandler={audioTiptapCallback}
              editor={editor}
              id={mode + "-audio-button"}
              toggleRecording={toggleRecording!}
              visualizerClassName="mb-0"
            />
          )}
          <span
            onClick={(e) => {
              e.stopPropagation;
              sendOnClick && sendOnClick();
            }}
          >
            Save
          </span>
        </div>
      )}
    </span>
  );
};

const DesktopAttachment = ({
  mode,
  sendOnClick,
  handleAttachmentClick,
  presentInInbox,
  handleCallback,
  status,
  handleDiscardDrafts,
  showDeleteComment,
  onCancelEditComment,
  toggleAiTaskWriter,
  audioTiptapCallback,
  audioDefaultContent,
  toggleRecording,
  editor,
  isRecording,
  hideComposerDictation,
  dictationCoordinator,
}: {
  sendOnClick?: TSendBackAttachmentButton;
  mode: RedirectMode;
  handleAttachmentClick: (e?: any) => void;
  presentInInbox?: boolean;
  handleCallback?: (
    mode_?: "moveToNext",
    inbox?: boolean,
    markAsDone?: boolean
  ) => Promise<boolean | undefined>;
  status?: IStatus;
  discardDrafts?: (discard: "Description" | "Comment") => void;
  showDeleteComment: boolean | undefined;
  onCancelEditComment?: () => void;
  handleDiscardDrafts: () => void;
  toggleAiTaskWriter?: () => void;
  audioTiptapCallback?: (text: string, setContent?: boolean) => void;
  audioDefaultContent?: string | undefined;
  toggleRecording?: (val: boolean) => void;
  editor: Editor | null;
  isRecording?: boolean;
  hideComposerDictation?: boolean;
  dictationCoordinator?: DictationCoordinator;
}) => {
  const isApple = useDeviceContext();
  const ctrlCmd = isApple ? "CMD" : "CTRL";
  const altOptions = isApple ? "OPT" : "ALT";

  return (
    <div
      className={`attachment-button p-0 flex flex-row   rounded-sm justify-between items-center w-full `}
    >
      {!isRecording && (
        <BottomButtons
          ctrlCmd={ctrlCmd}
          altOptions={altOptions}
          mode={mode}
          sendOnClick={sendOnClick}
          handleCallback={handleCallback}
          presentInInbox={presentInInbox}
          status={status}
        />
      )}
      {/* While recording, the waveform bar takes over the whole toolbar row:
          the send/attach/ai/improve/trash siblings collapse and the recorder
          flexes to full width (mirrors the mobile branch). */}
      <div
        className={`flex gap-2 items-center ${
          isRecording ? "flex-1 w-full" : ""
        }`}
      >
        {!isRecording && mode !== "read-edit-comments" && (
          <span className="relative group">
            <span
              className="text-hypertasks-ai-purple ml-auto text-emphasis cursor-pointer"
              id={mode + "-ai-writer-button"}
              onClick={() => {
                toggleAiTaskWriter && toggleAiTaskWriter();
              }}
            >
              ai
            </span>
            <Tooltip
              left={0}
              bottom={-45}
              keyCombination={[`${ctrlCmd}`, "J"]}
              text={"Ai Task Writer"}
            />
          </span>
        )}

        {!isRecording && mode !== "read-edit-comments" && (
          <span className="relative group">
            <Paperclip
              size={16}
              className="text-icon-dark-gray hover:text-white-black ml-auto  cursor-pointer  "
              onClick={handleAttachmentClick}
              strokeWidth={1.75}
            />
            <Tooltip
              left={0}
              bottom={-45}
              keyCombination={[`${ctrlCmd}`, `Shift`, "A"]}
              text={"Attach Files"}
            />
          </span>
        )}
        {audioTiptapCallback && !hideComposerDictation && (
          <AudioButton
            callbackHandler={audioTiptapCallback}
            editor={editor}
            id={mode + "-audio-button"}
            toggleRecording={toggleRecording!}
            dictationCoordinator={dictationCoordinator}
          />
        )}
        {!isRecording &&
          mode !== "read-edit-comments" &&
          mode !== "create-task-modal" &&
          ((mode === "create-comment" && showDeleteComment === true) ||
            mode === "read-edit-description") && (
            <span className="relative group">
              <Trash2
                size={16}
                className="text-icon-dark-gray hover:text-white-black ml-auto cursor-pointer"
                id={mode + "-discard-draft-button"}
                strokeWidth={1.75}
                onClick={handleDiscardDrafts}
              />
              <Tooltip
                left={0}
                bottom={-45}
                keyCombination={[`${ctrlCmd}`, `Shift`, ","]}
                text={"Discard draft"}
              />
            </span>
          )}
        {!isRecording && mode === "read-edit-comments" && onCancelEditComment && (
          <span className="relative group">
            <Trash2
              size={16}
              className="text-icon-dark-gray hover:text-white-black ml-auto cursor-pointer"
              id={mode + "-cancel-edit-button"}
              strokeWidth={1.75}
              onClick={onCancelEditComment}
            />
            <Tooltip
              left={0}
              bottom={-45}
              keyCombination={["ESC"]}
              text={"Cancel edit"}
            />
          </span>
        )}
      </div>
    </div>
  );
};

interface IDescriptionOption {
  title: string;
  value: TSendBackButtonParam;
  keyComb: string[];
  tooltip?: string;
}

interface IBottomButtonProps {
  ctrlCmd: "CMD" | "CTRL";
  altOptions: "ALT" | "OPT";
  mode: RedirectMode;
  sendOnClick?: TSendBackAttachmentButton;
  presentInInbox?: boolean;
  handleCallback?: (
    mode_?: "moveToNext",
    inbox?: boolean,
    markAsDone?: boolean
  ) => Promise<boolean | undefined>;
  status?: IStatus;
}

const BottomButtons = ({
  mode,
  ctrlCmd,
  sendOnClick,
  presentInInbox,
  handleCallback,
  altOptions,
  status,
}: IBottomButtonProps) => {
  const spanClassName =
    "text-content text-icon-dark-gray hover:text-white-black  cursor-pointer font-semibold relative group whitespace-nowrap";
  // Settings > Profile > Inbox. Was gated on ?inboxFlow=true before.
  const advanceOnSend = useGetUserPreferences().data.inboxAdvanceOnSend ?? true;

  const DescriptionOptions: IDescriptionOption[] = [
    {
      title: "Save",
      value: "Save",
      keyComb: [`${ctrlCmd}`, "Enter"],
    },
    {
      title: "Save & close",
      value: "SaveAndClose",
      keyComb: [`${ctrlCmd}`, `${altOptions}`, "Enter"],
      tooltip: "Save and close",
    },
    {
      title: "Save & new",
      value: "SaveAndNew",
      keyComb: [`${ctrlCmd}`, `${altOptions}`, "SHIFT", "Enter"],
      tooltip: "Save and create new task",
    },
  ];

  const SecondButtonToolTip = {
    text: presentInInbox
      ? status === "Archive"
        ? "Send + Archive + Unmark Task As Done + Next Task"
        : "Send + Archive + Mark Task As Done + Next Task"
      : "Send + Next Task",
    keyComb: presentInInbox
      ? [`${ctrlCmd}`, `${altOptions}`, "SHIFT", "Enter"]
      : [`${ctrlCmd}`, "SHIFT", "Enter"],
  };

  const toolTipText =
    mode === "create-comment"
      ? presentInInbox
        ? advanceOnSend
          ? "Send + Archive + Next Task"
          : "Send + Archive"
        : "Send"
      : mode === "read-edit-comments"
      ? "Update comment"
      : mode === "create-task-modal"
      ? "Create task"
      : "Save description";

  const getKeyCombinationForSend = () => {
    // On an inbox task, plain send is the archive button, so the bare "Send"
    // beside it is the shift variant.
    if (presentInInbox) return [`${ctrlCmd}`, "SHIFT", "Enter"];
    return [`${ctrlCmd}`, "Enter"];
  };

  if (mode === "create-task-modal" || mode === "read-edit-description") {
    return (
      <div className="flex gap-4 items-center">
        {mode === "create-task-modal" &&
          DescriptionOptions.map(
            (option: IDescriptionOption, index: number) => (
              <span
                key={`description-tiptap-buttons-${index}`}
                onClick={(e) => {
                  e.stopPropagation();
                  sendOnClick && sendOnClick(option.value);
                }}
                className={spanClassName}
              >
                {option.title}

                <Tooltip
                  left={0}
                  bottom={-45}
                  keyCombination={option.keyComb}
                  text={option.tooltip ?? option.title}
                />
              </span>
            )
          )}
        {mode === "read-edit-description" && (
          <>
            <span
              onClick={(e) => {
                e.stopPropagation();
                sendOnClick && sendOnClick("Save");
              }}
              className={spanClassName}
            >
              Save
              <Tooltip
                left={0}
                bottom={-45}
                keyCombination={[`${ctrlCmd}`, "Enter"]}
                text={"Save Changes"}
              />
            </span>
            <span
              className={
                "text-content text-[#C2CFA5] cursor-default font-semibold"
              }
            >
              Unsaved Changes
            </span>
          </>
        )}
      </div>
    );
  } else
    return (
      // Comment Send Buttons
      <div className="flex gap-6">
        {presentInInbox && mode !== "read-edit-comments" ? (
          <span
            onClick={() =>
              presentInInbox
                ? handleCallback &&
                  handleCallback(
                    advanceOnSend ? "moveToNext" : undefined,
                    presentInInbox
                  )
                : sendOnClick && sendOnClick()
            }
            className={spanClassName}
          >
            {["create-comment"].includes(mode) ? <CustomArchiveIcon /> : "Save"}

            <Tooltip
              left={0}
              bottom={-45}
              keyCombination={[`${ctrlCmd}`, "Enter"]}
              text={toolTipText}
            />
          </span>
        ) : (
          <></>
        )}
        <span
          onClick={() => sendOnClick && sendOnClick()}
          className={spanClassName}
        >
          Send
          {mode === "create-comment" && (
            <>
              <Tooltip
                left={0}
                bottom={-40}
                keyCombination={getKeyCombinationForSend()}
                text={"Send"}
              />
              <Tooltip
                left={0}
                bottom={-75}
                keyCombination={SecondButtonToolTip.keyComb}
                text={SecondButtonToolTip.text}
              />
            </>
          )}
        </span>
      </div>
    );
};

const CustomArchiveIcon = ({ markAndMove }: { markAndMove?: boolean }) => {
  return (
    <span className=" inline-flex items-center">
      Send +&nbsp;
      <svg
        className={`text-[#696b6e] group-hover:fill-white-black`}
        width={14}
        fill={"#696b6e"} // Change fill color based on hover state
        height={14}
        viewBox={`0 0 18 18`}
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M16 12H12C12 13.7 10.7 15 9 15C7.3 15 6 13.7 6 12H2V2H16M16 0H2C0.9 0 0 0.9 0 2V16C0 17.1 0.9 18 2 18H16C17.1 18 18 17.1 18 16V2C18 0.9 17.1 0 16 0ZM11.1 3.5L12.5 4.9L10.4 7L12.5 9.1L11.1 10.5L9 8.4L6.9 10.5L5.5 9.1L7.6 7L5.5 4.9L6.9 3.5L9 5.6L11.1 3.5Z" />
      </svg>
      {markAndMove && (
        <>
          &nbsp;+&nbsp;
          <Check
            color={"#696b6e"}
            className={`text-[#696b6e] group-hover:text-white-black`}
            size={14}
            strokeWidth={1.75}
          />
        </>
      )}
    </span>
  );
};

export default React.memo(AttachmentsUpload);
