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
