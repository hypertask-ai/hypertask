import { parse } from "node-html-parser";

import { sanitizeRichHtml } from "./sanitizeRichHtml";

export function htmlToPlainText(value: string): string {
  return parse(sanitizeRichHtml(value)).structuredText;
}
