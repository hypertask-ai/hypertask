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
  // A native modal <dialog> rather than a hand-rolled overlay: showModal()
  // gives the focus trap, Escape-to-close, background inertness and focus
  // restore that the plain div had none of (HTPR-6005 QA). ModalContainerCustom
  // has trapFocus/keyboard too, but its reactstrap centering fights a
  // full-height sheet pinned to the right edge.
  const detailsSheetShown = Boolean(
    isNarrow && detailsSheetOpen && selectedAgent,
  );
  useEffect(() => {
    const el = detailsDialogRef.current;
    // showModal() only works once the element is in the DOM, so this runs on
    // the commit that mounts it. Closing happens through close(), which fires
    // onClose and unmounts it.
    if (detailsSheetShown && el && !el.open) el.showModal();
  }, [detailsSheetShown]);

  return {
    detailsSheetShown,
  };
}
