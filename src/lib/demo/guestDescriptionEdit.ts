interface GuestDescriptionClick {
  isGuest: boolean;
  isMobile: boolean;
  clickCount: number;
  isEditorSurface: boolean;
  isInteractiveTarget: boolean;
}

export const GUEST_DESCRIPTION_INTERACTIVE_TARGET =
  "a, button, img, video, audio, iframe, input, textarea, [data-node-view-wrapper], [contenteditable='true']";

export const GUEST_DESCRIPTION_EDIT_REQUEST_EVENT =
  "hypertask:guest-description-edit-request";
export const GUEST_DESCRIPTION_EDITOR_ID = "description";

export interface GuestDescriptionEditRequestDetail {
  taskId: number;
  editorId: string;
}

interface GuestDescriptionEditor {
  isFocused: boolean;
  setEditable: (editable: boolean, emitUpdate?: boolean) => void;
  commands: { focus: (position?: "end") => boolean };
}

type GuestDescriptionEventWindow = Window & typeof globalThis;

/**
 * Demo guests arrive on a disposable board to try the product immediately.
 * Let their first plain desktop click enter description edit mode, while the
 * established double-click interaction remains unchanged for signed-up users.
 */
export function shouldEnterGuestDescriptionEdit({
  isGuest,
  isMobile,
  clickCount,
  isEditorSurface,
  isInteractiveTarget,
}: GuestDescriptionClick): boolean {
  return (
    isGuest &&
    !isMobile &&
    clickCount === 1 &&
    isEditorSurface &&
    !isInteractiveTarget
  );
}

export function dispatchGuestDescriptionEditRequest(
  root: GuestDescriptionEventWindow,
  detail: GuestDescriptionEditRequestDetail
): void {
  root.dispatchEvent(
    new root.CustomEvent<GuestDescriptionEditRequestDetail>(
      GUEST_DESCRIPTION_EDIT_REQUEST_EVENT,
      { detail }
    )
  );
}

/**
 * Each mounted description editor owns its pending request. The task/editor
 * match prevents another task from consuming it, and cleanup clears the
 * component-local request before navigation can reuse the editor surface.
 */
export function subscribeGuestDescriptionEditRequests({
  root,
  taskId,
  editorId,
  onRequest,
  onClear,
}: {
  root: GuestDescriptionEventWindow;
  taskId: number;
  editorId: string;
  onRequest: (taskId: number) => void;
  onClear: () => void;
}): () => void {
  const handleRequest = (event: Event) => {
    const detail = (event as CustomEvent<GuestDescriptionEditRequestDetail>)
      .detail;
    if (detail?.taskId !== taskId || detail.editorId !== editorId) return;
    onRequest(taskId);
  };

  root.addEventListener(GUEST_DESCRIPTION_EDIT_REQUEST_EVENT, handleRequest);
  return () => {
    root.removeEventListener(
      GUEST_DESCRIPTION_EDIT_REQUEST_EVENT,
      handleRequest
    );
    onClear();
  };
}

/**
 * React commits the editable Tiptap state after the click handler returns.
 * Consume only this editor's matching one-shot request, then use the editor
 * command so the caret is ready for the guest's next keystroke.
 */
export function syncGuestDescriptionEditorState({
  editor,
  editable,
  isGuest,
  isMobile,
  mode,
  taskId,
  pendingTaskId,
  clearPending,
}: {
  editor: GuestDescriptionEditor;
  editable: boolean;
  isGuest: boolean;
  isMobile: boolean;
  mode: string;
  taskId: number;
  pendingTaskId: number | null;
  clearPending: () => void;
}): boolean {
  editor.setEditable(editable, false);

  const shouldFocus =
    editable &&
    isGuest &&
    !isMobile &&
    mode === "read-edit-description" &&
    pendingTaskId === taskId;

  if (!shouldFocus) return false;
  clearPending();
  if (editor.isFocused) return true;
  return editor.commands.focus("end");
}
