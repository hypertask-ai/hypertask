export type InboxFocusScroll = {
  scroll: boolean;
  block: ScrollLogicalPosition;
};

export const resolveInboxFocusScroll = ({
  keepsScroll,
  focusedNotificationId,
  previousFocusedNotificationId,
  hasFocusedRow,
}: {
  keepsScroll: boolean;
  focusedNotificationId: string | null;
  previousFocusedNotificationId: string | null;
  hasFocusedRow: boolean;
}): InboxFocusScroll => {
  if (!keepsScroll) return { scroll: true, block: "center" };
  const focusStayed =
    hasFocusedRow &&
    focusedNotificationId === previousFocusedNotificationId;
  return { scroll: !focusStayed, block: "nearest" };
};
