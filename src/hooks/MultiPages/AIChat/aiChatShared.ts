import { aiOptions } from "@/lib/constants/constants";



export const aiOptionsWithoutOpenRouter = aiOptions.filter(
  (option) => option.source !== "openrouter"
);


// Mirrors MobileViewProvider's own <768px threshold (src/lib/contexts/mobileContext.tsx).
export const MOBILE_VIEWPORT_MAX_PX = 768;


/** User-facing text from streaming error payloads (may embed JSON or quoted API error bodies). */
export function parseAiStreamErrorContent(raw: string): string {
  if (!raw?.trim()) {
    return "Sorry, an error occurred while processing your request.";
  }
  const messageDouble = raw.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (messageDouble?.[1]) {
    return messageDouble[1].replace(/\\"/g, '"');
  }
  const messageSingle = raw.match(/'message':\s*'((?:[^'\\]|\\.)*)'/);
  if (messageSingle?.[1]) {
    return messageSingle[1];
  }
  if (
    raw.includes("context_length_exceeded") ||
    /exceed.*limit.*token/i.test(raw)
  ) {
    return "The conversation or attachments are too large for the model token limit. Try shortening your message or removing some context.";
  }
  if (raw.length > 800) {
    return `${raw.slice(0, 797)}…`;
  }
  return raw;
}


/** Inline images from the AI chat editor plus user-picked files from `fileItems`, ready for the chat API. */
export type AiChatProcessedAttachment = {
  fileName: string;
  url: string;
  mimeType: string | null;
};
