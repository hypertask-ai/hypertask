// How long after an explicit open the chat composer may still claim focus —
// generous enough to cover the first-ever load of the lazily-imported chat
// chunk on a slow network. Auto-open never sets the timestamp
// (aiChatExplicitOpenAtAtom), so this window never applies to it.
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
