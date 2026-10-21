export const FOCUS_REQUEST_WINDOW_MS = 5000;

export function isEditableElement(element: HTMLElement | null) {
  return Boolean(
    element &&
      (element.isContentEditable ||
        element.tagName === "INPUT" ||
        element.tagName === "TEXTAREA" ||
        element.tagName === "SELECT")
  );
}

export function focusAiChatEditorForRequest(
  editor: { commands: { focus: (position: "end") => unknown } } | null | undefined,
  explicitOpenAt: number | null,
  activeElement: HTMLElement | null,
  now = Date.now()
) {
  if (
    !editor ||
    explicitOpenAt === null ||
    now - explicitOpenAt > FOCUS_REQUEST_WINDOW_MS ||
    isEditableElement(activeElement)
  ) {
    return false;
  }
  editor.commands.focus("end");
  return true;
}
