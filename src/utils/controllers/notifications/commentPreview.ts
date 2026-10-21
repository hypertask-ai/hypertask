const decodedEntities: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

export function commentPreview(input: string, maxChars = 280): string {
  const text = String(input ?? "")
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|blockquote|tr|td|th)\s*>/gi, " ")
    .replace(/<(br|hr)\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/gi, (entity) =>
      decodedEntities[entity.toLowerCase()] ?? entity
    )
    .replace(/\s+/g, " ")
    .trim();

  if (!text || text.length <= maxChars) return text;
  if (maxChars <= 0) return "";
  if (maxChars === 1) return "…";

  const availableText = text.slice(0, maxChars - 1);
  const wordBoundary = availableText.lastIndexOf(" ");
  const truncated =
    wordBoundary > 0 ? availableText.slice(0, wordBoundary) : availableText;

  return `${truncated.replace(/[\uD800-\uDBFF]$/, "").trimEnd()}…`;
}
