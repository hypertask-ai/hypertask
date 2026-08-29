import type { FeedbackKind } from "./sendFeedbackRequest";

export const selectFeedbackKind = (
  kind: FeedbackKind,
  setKind: (kind: FeedbackKind) => void,
  restoreEditorFocus: () => void,
) => {
  setKind(kind);
  restoreEditorFocus();
};
