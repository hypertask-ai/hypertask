import DOMPurify from "isomorphic-dompurify";
import type { UponSanitizeElementHook } from "dompurify";

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

const ALLOWED_EMBEDS = [
  { hostname: "www.loom.com", pathnamePrefix: "/embed/" },
  { hostname: "www.youtube.com", pathnamePrefix: "/embed/" },
  { hostname: "www.youtube-nocookie.com", pathnamePrefix: "/embed/" },
  { hostname: "player.vimeo.com", pathnamePrefix: "/video/" },
  { hostname: "www.figma.com", pathnamePrefix: "/embed" },
] as const;

const isAllowedEmbed = (value: string) => {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && ALLOWED_EMBEDS.some(
      ({ hostname, pathnamePrefix }) =>
        url.hostname === hostname && url.pathname.startsWith(pathnamePrefix),
    );
  } catch {
    return false;
  }
};

export function sanitizeRenderedRichHtml(html: string): string {
  if (!html) return "";
  const restrictIframes: UponSanitizeElementHook = (node, data) => {
    if (data.tagName !== "iframe") return;
    const iframe = node as Element;
    if (!isAllowedEmbed(iframe.getAttribute("src") ?? "")) {
      iframe.remove();
      return;
    }
    iframe.setAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-presentation",
    );
  };

  DOMPurify.addHook("uponSanitizeElement", restrictIframes);
  try {
    return DOMPurify.sanitize(html, {
      ADD_TAGS: ["iframe"],
      ADD_ATTR: [
        ...MENTION_ATTRS,
        "allowfullscreen",
        "media-type",
        "sandbox",
      ],
    });
  } finally {
    DOMPurify.removeHook("uponSanitizeElement", restrictIframes);
  }
}
