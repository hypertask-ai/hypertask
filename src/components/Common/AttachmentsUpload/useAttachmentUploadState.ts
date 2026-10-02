import { useContext, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { processFiles } from "@/utils/helperFunctions/helperFunctions";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useEditorState } from "@tiptap/react";
import { mobileEditorTriggerText } from "./mobileCommentComposer";
import { useFileUpload } from "./FileUploadHandler";
import { discardUnboundCreateTaskUploads } from "@/lib/createTaskAttachmentUploads";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6556_MOBILE_DESCRIPTION_FIRST_FLAG } from "@/lib/flags/keys";
import type { AttachmentUploadInput } from "./attachmentUploadTypes";

type Context = Pick<AttachmentUploadInput, "props">;

export function useAttachmentUploadState(context: Context) {
  const {
  props,
  } = context;

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
  const descriptionFirstEnabled = useFlag(HTPR_6556_MOBILE_DESCRIPTION_FIRST_FLAG);
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
  return {
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
  };
}
