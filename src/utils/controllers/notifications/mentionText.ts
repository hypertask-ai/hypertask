import { escapeHtml } from "@/utils/htmlEscape";
import { commentPreview } from "./commentPreview";

const mentionSentinel = "\uE000";
const spanPattern = /<span\b([^>]*)>([\s\S]*?)<\/span\s*>/gi;
const attributePattern =
  /([a-zA-Z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;

/**
 * True only when `data-type="mention"` is a real attribute of the tag. Testing
 * the raw tag text with one regex instead would also match the string
 * `data-type="mention"` sitting inside some other attribute's value (a title,
 * say), letting a crafted comment render ordinary text as a highlighted mention.
 */
function isMentionTag(attributes: string): boolean {
  attributePattern.lastIndex = 0;
  let attribute: RegExpExecArray | null;
  while ((attribute = attributePattern.exec(attributes)) !== null) {
    const name = attribute[1].toLowerCase();
    const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? "";
    if (name === "data-type" && value.trim().toLowerCase() === "mention") {
      return true;
    }
  }
  return false;
}

function markMentions(html: string): string {
  return (
    String(html ?? "")
      // A comment containing the sentinel itself would otherwise open or close a
      // highlight region that no mention put there. It is a private-use
      // codepoint with nothing to render, so dropping it costs nothing.
      .replaceAll(mentionSentinel, "")
      .replace(spanPattern, (match, attributes: string, label: string) => {
        if (!isMentionTag(attributes)) return match;
        const plainLabel = label.replace(/<[^>]*>/g, "");
        return `${mentionSentinel}@${plainLabel}${mentionSentinel}`;
      })
  );
}

export function mentionPlainPreview(html: string, maxChars?: number): string {
  return commentPreview(
    markMentions(html).replaceAll(mentionSentinel, ""),
    maxChars
  );
}

export function mentionQuoteHtml(html: string, maxChars?: number): string {
  if (typeof maxChars === "number" && maxChars <= 0) return "";

  const marked = commentPreview(markMentions(html), Number.MAX_SAFE_INTEGER);
  const plain = marked.replaceAll(mentionSentinel, "");
  const preview = mentionPlainPreview(html, maxChars);
  const wasTruncated = preview !== plain;
  const visibleLength = wasTruncated ? preview.length - 1 : preview.length;

  let markedPreview = "";
  let visibleChars = 0;
  for (const char of marked) {
    if (char !== mentionSentinel && visibleChars >= visibleLength) break;
    markedPreview += char;
    // Count UTF-16 units, matching how `preview.length` was measured: iterating
    // by code point and counting 1 per emoji would let the quote run to roughly
    // twice `maxChars`.
    if (char !== mentionSentinel) visibleChars += char.length;
  }
  if (wasTruncated) markedPreview += "…";

  let result = "";
  let cursor = 0;
  while (cursor < markedPreview.length) {
    const start = markedPreview.indexOf(mentionSentinel, cursor);
    if (start === -1) {
      result += escapeHtml(markedPreview.slice(cursor));
      break;
    }

    result += escapeHtml(markedPreview.slice(cursor, start));
    const end = markedPreview.indexOf(mentionSentinel, start + 1);
    if (end === -1) {
      result += escapeHtml(markedPreview.slice(start + 1));
      break;
    }

    result += `<span style="background-color:#f9efcb;color:#1365a3;border-radius:3px;padding:0 3px;" class="mention-hl">${escapeHtml(markedPreview.slice(start + 1, end))}</span>`;
    cursor = end + 1;
  }

  return result;
}
