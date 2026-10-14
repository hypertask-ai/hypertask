import DOMPurify from "isomorphic-dompurify";

const MENTION_ATTRS = [
  "data-type",
  "data-label",
  "data-id",
  "uniqueindex",
  "projectid",
  "target",
];

export function sanitizeAiHtml(html: string): string {
  if (!html) return "";
  return DOMPurify.sanitize(html, { ADD_ATTR: MENTION_ATTRS });
}
