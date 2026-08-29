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
    // Block boundaries become spaces before tags are stripped, otherwise the
    // paragraphs Tiptap always emits glue together ("<p>a</p><p>b</p>" -> "ab").
    // Inline tags are dropped without a space so words stay intact.
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

  // Slicing by UTF-16 units can cut an emoji in half and leave a lone high
  // surrogate, which renders as a replacement glyph in email and push bodies.
  return `${truncated.replace(/[\uD800-\uDBFF]$/, "").trimEnd()}…`;
}
