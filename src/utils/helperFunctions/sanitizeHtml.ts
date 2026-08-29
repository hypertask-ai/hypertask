import DOMPurify from "isomorphic-dompurify";

// HTPR-4004: AI-streamed responses are HTML injected via dangerouslySetInnerHTML.
// The model can echo user-controlled task/comment text, so an attacker who plants
// `<img onerror=...>` in a task title gets stored XSS in every viewer's browser.
// Sanitize before rendering, but keep the attributes the AI chat relies on:
// task-mention <span>s (projectid/uniqueindex/data-* read by MessageItem's click
// handler) and <a href> links. DOMPurify strips on* handlers and javascript: URIs.
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
