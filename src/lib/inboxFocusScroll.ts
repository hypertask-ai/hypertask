export type InboxFocusScroll = {
  scroll: boolean;
  block: ScrollLogicalPosition;
};

export const resolveInboxFocusScroll = ({
  keepsScroll,
  focusedRowStillListed,
}: {
  keepsScroll: boolean;
  focusedRowStillListed: boolean;
}): InboxFocusScroll => {
  if (!keepsScroll) return { scroll: true, block: "center" };
  if (focusedRowStillListed) return { scroll: false, block: "nearest" };
  return { scroll: true, block: "nearest" };
};
