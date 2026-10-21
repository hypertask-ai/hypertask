
export function mobileEditorTriggerText(
  trigger: "@" | "/",
  textBeforeCaret: string,
) {
  if (trigger === "@" && textBeforeCaret && !/\s$/.test(textBeforeCaret)) {
    return " @";
  }
  return trigger;
}

export function mobileCommentMicWrapperClass({
  hasText,
  isRecording,
  isProcessing,
}: {
  hasText?: boolean;
  isRecording?: boolean;
  isProcessing?: boolean;
}) {
  if (isRecording) return "order-7 flex-1 w-full";
  if (isProcessing) return "order-6 ml-auto";
  return hasText ? "order-5 ml-auto" : "order-6 ml-auto";
}

