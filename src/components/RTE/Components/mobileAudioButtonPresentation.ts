type MobileMicPresentationState = {
  isMobileCreateComment: boolean;
  isMobileTaskWriter: boolean;
  isMobileNewTask: boolean;
  isMobileAiChat: boolean;
  globalRecording?: boolean;
  hasText?: boolean;
  isProcessing: boolean;
};

export function mobileMicPresentation({
  isMobileCreateComment,
  isMobileTaskWriter,
  isMobileNewTask,
  isMobileAiChat,
  globalRecording,
  hasText,
  isProcessing,
}: MobileMicPresentationState) {
  const prominent =
    (isMobileCreateComment ||
      isMobileTaskWriter ||
      isMobileNewTask ||
      isMobileAiChat) &&
    !globalRecording;

  let shapeClassName = "rounded-sm";
  if (isMobileAiChat) shapeClassName = "rounded-full";

  let className = "h-11 w-11 justify-center " + shapeClassName;
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
