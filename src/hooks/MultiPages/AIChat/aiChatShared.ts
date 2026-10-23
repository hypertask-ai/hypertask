import { aiOptions } from "@/lib/constants/constants";



export const aiOptionsWithoutOpenRouter = aiOptions.filter(
  (option) => option.source !== "openrouter"
);


export const MOBILE_VIEWPORT_MAX_PX = 768;


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


export type AiChatProcessedAttachment = {
  fileName: string;
  url: string;
  mimeType: string | null;
};
