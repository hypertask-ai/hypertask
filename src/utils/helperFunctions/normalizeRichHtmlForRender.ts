import { normalizeRichTextStructure } from "./normalizeRichTextStructure";

const DOCUMENT_BODY_RE = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i;
const DOCUMENT_BODY_OPEN_RE = /<body\b[^>]*>/i;
const DOCUMENT_HEAD_RE = /<head\b[^>]*>[\s\S]*?<\/head\s*>/i;
const DOCUMENT_HEAD_OPEN_RE = /<head\b[^>]*>/i;
const DOCUMENT_WRAPPER_RE = /<\/?(?:html|head|body)\b[^>]*>/gi;
const DOCTYPE_RE = /<!doctype\b[^>]*>/gi;

export function normalizeRichHtmlForRender(html: string): string {
  if (!html) return html;

  const body = html.match(DOCUMENT_BODY_RE);
  if (body) return normalizeRichTextStructure(body[1]);

  const bodyOpen = DOCUMENT_BODY_OPEN_RE.exec(html);
  if (bodyOpen) {
    return normalizeRichTextStructure(
      html
        .slice(bodyOpen.index + bodyOpen[0].length)
        .replace(DOCUMENT_WRAPPER_RE, ""),
    );
  }

  const headOpen = DOCUMENT_HEAD_OPEN_RE.exec(html);
  if (headOpen && !DOCUMENT_HEAD_RE.test(html)) {
    return normalizeRichTextStructure(
      html
        .slice(0, headOpen.index)
        .replace(DOCTYPE_RE, "")
        .replace(DOCUMENT_WRAPPER_RE, ""),
    );
  }

  return normalizeRichTextStructure(
    html
      .replace(DOCTYPE_RE, "")
      .replace(DOCUMENT_HEAD_RE, "")
      .replace(DOCUMENT_WRAPPER_RE, ""),
  );
}
