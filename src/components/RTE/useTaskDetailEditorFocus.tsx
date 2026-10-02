// Tiptap.tsx
import { useEffect, useLayoutEffect, useRef } from "react";
import { isGuestUser } from "@/lib/demo/guest";
import { subscribeGuestDescriptionEditRequests, syncGuestDescriptionEditorState } from "@/lib/demo/guestDescriptionEdit";
import { armBackDismiss } from "@/lib/mobile/backDismiss";

type AIGeneratedAttachment = {
  id?: string;
  file: Pick<File, "name" | "size" | "type">;
  preview: string;
};
import type { TaskDetailEditorPresentation } from "./taskDetailEditorPresentation";
export function useTaskDetailEditorFocus(context: TaskDetailEditorPresentation) {
  const { mobileExistingEditOpen, editor, mobileEditSnapshotRef, mobileEditSessionActiveRef, newCommentAttachments, cancelMobileExistingEditRef, mobileEditSavingRef, pendingGuestDescriptionFocusTaskRef, mode, currentTask, id, isReadOnlyContent, debouncedRequest, inViewObject, allowEdit, isRecording, currentUser, isMbl, uploadingDescription, descriptionFocusRequest, handledDescriptionFocusNonceRef, isSelected, setLoading, scrolledOnMobile, setScrolledOnMobile, stack, defaultContent } = context;


  // Effects
  useLayoutEffect(() => {
    if (!mobileExistingEditOpen || !editor || mobileEditSnapshotRef.current) {
      if (!mobileExistingEditOpen) {
        mobileEditSessionActiveRef.current = false;
        mobileEditSnapshotRef.current = null;
      }
      return;
    }

    mobileEditSnapshotRef.current = {
      html: editor.getHTML(),
      attachments: [...newCommentAttachments],
    };
    mobileEditSessionActiveRef.current = true;
  }, [editor, mobileExistingEditOpen, newCommentAttachments]);

  useLayoutEffect(() => {
    if (!mobileExistingEditOpen || !editor) return;
    const focusFrame = requestAnimationFrame(() => {
      if (mobileEditSessionActiveRef.current && !editor.isDestroyed) {
        editor.commands.focus("end");
      }
    });
    return () => cancelAnimationFrame(focusFrame);
  }, [editor, mobileExistingEditOpen]);

  useEffect(() => {
    if (!mobileExistingEditOpen) return;

    const previousOverflow = document.body.style.overflow;
    const previousBackHandler = window.__htHandleBack;
    document.body.style.overflow = "hidden";
    window.__htHandleBack = () => {
      cancelMobileExistingEditRef.current();
      return true;
    };
    const disarmBack = armBackDismiss(window, {
      key: "__htMobileExistingContentEdit",
      onBack: () => cancelMobileExistingEditRef.current(),
      shouldRearm: () => mobileEditSavingRef.current,
    });

    return () => {
      document.body.style.overflow = previousOverflow;
      window.__htHandleBack = previousBackHandler;
      disarmBack();
    };
  }, [mobileExistingEditOpen]);

  useLayoutEffect(() => {
    pendingGuestDescriptionFocusTaskRef.current = null;
    if (mode !== "read-edit-description" || !currentTask?.id) return;

    return subscribeGuestDescriptionEditRequests({
      root: window,
      taskId: currentTask.id,
      editorId: id,
      onRequest: (taskId) => {
        pendingGuestDescriptionFocusTaskRef.current = taskId;
      },
      onClear: () => {
        pendingGuestDescriptionFocusTaskRef.current = null;
      },
    });
  }, [currentTask?.id, id, mode]);

  useEffect(() => {
    if (!editor || isReadOnlyContent || mobileExistingEditOpen) return;
    const handleEditorUpdate = () => {
      // Serialize while Tiptap is alive. If navigation happens before the
      // debounce expires, useDebounceWithCancel flushes this captured value on
      // unmount instead of calling getHTML() on a destroyed editor.
      if (editor.isDestroyed) return;
      debouncedRequest({
        content: editor.getHTML(),
        projectId: inViewObject.taskProjectId,
        taskId: inViewObject.taskId,
      });
    };
    // Remove only our own handler on cleanup. The blanket editor.off("update")
    // this replaces also tore off listeners other hooks had registered on the
    // same editor (useTiptap's draft-seeding guard among them).
    editor.on("update", handleEditorUpdate);
    return () => {
      editor.off("update", handleEditorUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    editor,
    inViewObject.taskId,
    inViewObject.taskProjectId,
    isReadOnlyContent,
    mobileExistingEditOpen,
  ]);

  useLayoutEffect(() => {
    if (
      !editor ||
      pendingGuestDescriptionFocusTaskRef.current !== currentTask.id
    ) return;

    // The guest's discrete click commits edit mode synchronously. Complete the
    // matching editor handoff before paint, leaving no keyboard-event window
    // between React's commit and ProseMirror becoming editable/focused.
    syncGuestDescriptionEditorState({
      editor,
      editable: allowEdit && !isRecording,
      isGuest: isGuestUser(currentUser),
      isMobile: Boolean(isMbl),
      mode,
      taskId: currentTask.id,
      pendingTaskId: pendingGuestDescriptionFocusTaskRef.current,
      clearPending: () => {
        pendingGuestDescriptionFocusTaskRef.current = null;
      },
    });
  }, [allowEdit, currentTask.id, currentUser, editor, isMbl, isRecording, mode]);

  useEffect(() => {
    if (editor) {
      // emitUpdate:false — setEditable fires a fake "update" otherwise, which the
      // draft autosave reads as a real edit and writes an empty draft over a
      // stored one (and which hides a draft that is still loading).
      editor.setEditable(
        allowEdit &&
          !isRecording &&
          !(mode === "read-edit-description" && uploadingDescription),
        false,
      );
    }
  }, [allowEdit, editor, isRecording, mode, uploadingDescription]);

  useEffect(() => {
    if (
      !descriptionFocusRequest ||
      descriptionFocusRequest.taskId !== currentTask.id ||
      handledDescriptionFocusNonceRef.current === descriptionFocusRequest.nonce ||
      !allowEdit ||
      mode !== "read-edit-description" ||
      !isSelected ||
      !editor ||
      isRecording ||
      editor.isFocused
    ) return;

    // Ctrl/Cmd+D selects the description wrapper before React commits edit
    // mode. Focus ProseMirror once both that commit and the dynamic editor
    // initialization have completed.
    editor.commands.focus("end");
    handledDescriptionFocusNonceRef.current = descriptionFocusRequest.nonce;
  }, [allowEdit, currentTask.id, descriptionFocusRequest, editor, isRecording, isSelected, mode]);

  useEffect(() => {
    if (editor) {
      setLoading?.(false);
      editor.view.dispatch(editor.view.state.tr);

      if (allowEdit && isMbl && !scrolledOnMobile) {
        document.getElementById("bottom")?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
        setScrolledOnMobile(true);
      }
    } else {
      setLoading?.(true);
    }
  }, [isMbl, editor, allowEdit, id, stack]);

  const lastDefaultContentRef = useRef(defaultContent);
  const wasEditableRef = useRef(allowEdit);
  useEffect(() => {
    const didFinishEditing = wasEditableRef.current && !allowEdit;
    const contentChanged = defaultContent !== lastDefaultContentRef.current;

    wasEditableRef.current = allowEdit;
    lastDefaultContentRef.current = defaultContent;
    if (!editor || allowEdit || (!didFinishEditing && !contentChanged)) return;

    const normalizedContent = new DOMParser().parseFromString(
      defaultContent ?? "",
      "text/html"
    ).body.innerHTML;
    if (editor.getHTML() !== normalizedContent) {
      editor.commands.setContent(defaultContent ?? "", { emitUpdate: false });
    }
  }, [allowEdit, defaultContent, editor]);
}
