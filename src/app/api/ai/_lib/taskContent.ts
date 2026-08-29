// Pure machine noise never worth sending to the model: the
// "claude --resume <uuid>" session-code comments agents drop on tickets.
export function isSessionNoise(text: string) {
  return /claude\s+--resume|claude code session/i.test(text);
}

export function convertHtmlToText(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
