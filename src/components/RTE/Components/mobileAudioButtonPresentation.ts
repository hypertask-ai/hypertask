export type MobileMicPresentation = "compact" | "prominent";

type MobileMicPresentationState = {
  isMobileCreateComment: boolean;
  isMobileTaskWriter: boolean;
  isMobileNewTask: boolean;
  isMobileAiChat: boolean;
  globalRecording?: boolean;
  hasText?: boolean;
  isProcessing: boolean;
  mobilePresentation?: MobileMicPresentation;
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

  let className = "h-11 w-11 justify-center rounded-sm";
  if (isProcessing) {
    className = "h-[34px] gap-2";
  } else if (hasText) {
    className += " text-icon-dark-gray";
  } else if (isMobileCreateComment) {
    className =
      "h-11 w-11 justify-center rounded-sm bg-hypertasks-ai-purple text-white shadow-[0_3px_12px_rgba(198,104,255,0.38)]";
  } else {
    className += " bg-shadcn-primary text-primary-foreground";
  }

  return { prominent, className };
}
