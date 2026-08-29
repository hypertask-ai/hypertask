"use client";

import {
  FeedbackFields,
  isFeedbackTextEmpty,
  useFeedbackDraft,
} from "@/components/Modals/Feedback/FeedbackForm";
import SettingsSectionShell from "./SettingsSectionShell";

const FeedbackSection = () => {
  const draft = useFeedbackDraft({ clearOnSuccess: true });

  return (
    <SettingsSectionShell
      title="Send feedback"
      description="Tell us what's broken, missing, or annoying. It goes straight to the team."
    >
      <div className="flex flex-col gap-4">
        <div className="overflow-hidden rounded-[5px] bg-active-modal-element">
          <FeedbackFields
            draft={draft}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void draft.submitFeedback();
              }
            }}
          />
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            className="bg-active-modal-element px-4 py-2 shadow-customshadow-1 cursor-pointer rounded text-white-black disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => void draft.submitFeedback()}
            disabled={
              isFeedbackTextEmpty(draft.text) ||
              draft.isSubmitting ||
              draft.isDictating
            }
          >
            {draft.isSubmitting ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </SettingsSectionShell>
  );
};

export default FeedbackSection;
