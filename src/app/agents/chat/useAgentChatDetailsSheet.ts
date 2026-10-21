"use client";

import { useEffect } from "react";
import type { useAgentChatNavigation } from "./useAgentChatNavigation";
import type { useAgentChatState } from "./useAgentChatState";

type Props = Pick<
  ReturnType<typeof useAgentChatState>,
  | "isNarrow"
  | "detailsSheetOpen"
  | "detailsDialogRef"
> &
  Pick<
  ReturnType<typeof useAgentChatNavigation>,
  | "selectedAgent"
>;

export function useAgentChatDetailsSheet({
  isNarrow, detailsSheetOpen, selectedAgent, detailsDialogRef,
}: Props) {
  const detailsSheetShown = Boolean(
    isNarrow && detailsSheetOpen && selectedAgent,
  );
  useEffect(() => {
    const el = detailsDialogRef.current;
    if (detailsSheetShown && el && !el.open) el.showModal();
  }, [detailsSheetShown]);

  return {
    detailsSheetShown,
  };
}
