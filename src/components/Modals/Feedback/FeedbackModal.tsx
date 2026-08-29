"use client";

import ConfirmDialog from "@/components/Modals/Common Modals/ConfirmDialog";
import { MessageSquare } from "lucide-react";
import { FeedbackFields, isFeedbackTextEmpty, useFeedbackDraft } from "./FeedbackForm";

interface FeedbackModalProps {
  closeHandler: () => void;
}

const FeedbackModal = ({ closeHandler }: FeedbackModalProps) => {
  const draft = useFeedbackDraft({ onSuccess: closeHandler });

  return (
    <ConfirmDialog
      id="feedback-modal"
      icon={MessageSquare}
      message="Send feedback"
      confirmLabel="Send"
      loadingLabel="Sending…"
      loading={draft.isSubmitting}
      confirmDisabled={isFeedbackTextEmpty(draft.text) || draft.isDictating}
      confirmShortcut="ctrl-enter"
      footerVerb="send"
      onConfirm={() => void draft.submitFeedback()}
      onCancel={closeHandler}
      className="sm:min-w-[560px] sm:max-w-[620px]"
    >
      <FeedbackFields autoFocus draft={draft} />
    </ConfirmDialog>
  );
};

export default FeedbackModal;
