export type EmptyInboxTabGate = {
  enabled: boolean;
  isInboxZero: boolean;
  splitLengths: readonly number[];
  unsavedCommentDrafts: number;
};

export const hidesInboxZeroSplitTabs = ({
  enabled,
  isInboxZero,
  splitLengths,
  unsavedCommentDrafts,
}: EmptyInboxTabGate): boolean =>
  enabled
  && isInboxZero
  && splitLengths.length > 0
  && splitLengths.every((length) => length === 0)
  && unsavedCommentDrafts === 0;
