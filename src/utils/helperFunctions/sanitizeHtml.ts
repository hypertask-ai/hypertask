import { isAllowedIframeUrl } from "./allowedIframeSources";

type Purifier = typeof import("isomorphic-dompurify").default;

const MENTION_ATTRS = [
  "data-type",
  "data-label",
  "data-id",
  "uniqueindex",
  "projectid",
  "target",
];

let purifier: Purifier | undefined;

function purifierLoadedOnFirstSanitize(): Purifier {
  purifier ??= require("isomorphic-dompurify") as Purifier;
  return purifier;
}

export function sanitizeAiHtml(html: string): string {
  if (!html) return "";
  return purifierLoadedOnFirstSanitize().sanitize(html, { ADD_ATTR: MENTION_ATTRS });
}

export function sanitizeDescriptionHtml(html: string): string {
  if (!html) return "";
  const purifier = purifierLoadedOnFirstSanitize();
  const removeUnsafeIframe = (node: Node) => {
    if (node.nodeName.toLowerCase() !== "iframe") return;
    const iframe = node as HTMLIFrameElement;
    if (iframe.hasAttribute("srcdoc") || !isAllowedIframeUrl(iframe.getAttribute("src") ?? "")) {
      iframe.remove();
    }
  };
  purifier.addHook("uponSanitizeElement", removeUnsafeIframe);
  try {
    return purifier.sanitize(html, {
      ADD_TAGS: ["iframe"],
      ADD_ATTR: [...MENTION_ATTRS, "allowfullscreen", "frameborder", "width", "height", "title", "allow"],
      FORBID_ATTR: ["srcdoc"],
    });
  } finally {
    purifier.removeHook("uponSanitizeElement", removeUnsafeIframe);
  }
}
