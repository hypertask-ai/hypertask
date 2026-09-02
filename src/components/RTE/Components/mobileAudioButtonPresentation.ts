export type MobileMicPresentation = "compact" | "prominent";
export type MobileMicPrimaryTone = "default" | "ai";

type MobileMicPresentationState = {
  isMobileCreateComment: boolean;
  isMobileTaskWriter: boolean;
  isMobileNewTask: boolean;
  isMobileAiChat: boolean;
  globalRecording?: boolean;
  hasText?: boolean;
  isProcessing: boolean;
  mobilePresentation?: MobileMicPresentation;
  primaryTone?: MobileMicPrimaryTone;
};

export function mobileMicPresentation({
  isMobileCreateComment,
  isMobileTaskWriter,
  isMobileNewTask,
  isMobileAiChat,
  globalRecording,
  hasText,
  isProcessing,
  mobilePresentation,
  primaryTone = "default",
}: MobileMicPresentationState) {
  if (mobilePresentation === "compact") {
    return { prominent: false, className: "h-[32px]" };
  }

  const prominent =
    (mobilePresentation === "prominent" ||
      isMobileCreateComment ||
      isMobileTaskWriter ||
      isMobileNewTask ||
      isMobileAiChat) &&
    !globalRecording;

  let className = "h-11 w-11 justify-center rounded-[4px]";
  if (isProcessing) {
    className = "h-11 w-12 justify-center rounded-[4px]";
  } else if (hasText) {
    className += " text-icon-dark-gray";
  } else {
    className =
      primaryTone === "ai"
        ? "h-11 w-12 justify-center rounded-[4px] bg-hypertasks-ai-purple text-white"
        : "h-11 w-12 justify-center rounded-[4px] bg-white-black text-white-black-inverted";
  }

  return { prominent, className };
}
