import { useLayoutEffect, type KeyboardEvent, type RefObject } from "react";

export function usePromptFieldGrowth(
  desktopField: RefObject<HTMLTextAreaElement | null>,
  mobileField: RefObject<HTMLTextAreaElement | null>,
  prompt: string,
  layoutKey: string,
) {
  useLayoutEffect(() => {
    for (const field of [desktopField.current, mobileField.current]) {
      if (!field) continue;
      field.style.height = "auto";
      field.style.height = `${field.scrollHeight}px`;
    }
  }, [desktopField, mobileField, prompt, layoutKey]);
}

export function keepTypingInsidePrompt(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.stopPropagation();
  }
}
