/**
 * HTPR-6721: a similar older ticket must never replace the task the person
 * asked for. The board-research prompt used to tell the model to answer with a
 * "Possible duplicate" note instead of a draft, and Accept ALL (and the CLI)
 * turned that note into a real ticket titled "Possible duplicate".
 *
 * The prompt no longer asks for that, but model output is not a contract, so
 * every place that turns writer output into a title runs it through here.
 * Pure string code with no DOM, so the server extractor, the CLI route and the
 * browser container share one rule.
 */

const TITLE_H1_RE =
  /<h1\b[^>]*\bid\s*=\s*["']ai-generated-task-title["'][^>]*>([\s\S]*?)<\/h1>/i;
const PARAGRAPH_RE = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
const ANCHOR_RE = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
const MATCH_NOTE_RE =
  /\b(appears to match|may match|might match|matches|possible match|possibly matches|duplicate of|duplicates|same as)\b/i;
const DIFFERENCE_FILLER_RE =
  /\b(differ|differs|difference|different)\b[\s\S]*\bnot provided\b/i;
const TITLE_MAX_LENGTH = 80;

function plainText(html: string) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // Last, so "&amp;lt;" reads as the literal "&lt;", not "<".
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// "Possible duplicate", "Duplicate", or either followed by a ticket id
// ("Possible duplicate of INNE-944, Hero model image swap test").
const DUPLICATE_NOTE_TITLE_RE =
  /^(?:(?:possible|potential|likely|probable)\s+)?duplicate(?:\s*(?:of\b|:|-)?\s*[a-z][a-z0-9]*-\d+\b.*)?[\s.!?]*$/i;

/**
 * True only for titles that are a duplicate warning rather than a task. A real
 * task about duplicates ("Potential duplicate charges when retrying checkout",
 * "Fix duplicate notifications", "Duplicate board action") is not matched.
 */
export function isDuplicateNoteTitle(title: string | null | undefined) {
  if (!title) return false;
  return DUPLICATE_NOTE_TITLE_RE.test(title.replace(/\s+/g, " ").trim());
}

/**
 * A usable title from the person's own brief: first non-empty line, tags
 * stripped, capped at 80 characters on a word boundary.
 */
export function taskTitleFromBrief(brief: string | null | undefined) {
  if (!brief) return null;
  const firstLine = brief
    .split(/\r?\n/)
    .map((line) => plainText(line))
    .find(Boolean);
  if (!firstLine) return null;
  let title = firstLine;
  if (title.length > TITLE_MAX_LENGTH) {
    const cut = title.slice(0, TITLE_MAX_LENGTH);
    const lastSpace = cut.lastIndexOf(" ");
    title = (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim();
  }
  title = title.replace(/[\s.,;:]+$/, "");
  if (!title || isDuplicateNoteTitle(title)) return null;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/**
 * If the writer answered with a duplicate note instead of a task, put the
 * requested task's title back and move the match into a "Related tickets"
 * section, the same place a normal draft lists similar earlier tickets.
 * Any other output is returned unchanged, byte for byte.
 *
 * With no fallback title the note's heading is dropped, so the caller keeps
 * whatever title the task already has instead of saving "Possible duplicate".
 */
export function repairDuplicateNote(
  html: string,
  fallbackTitle?: string | null
) {
  if (!html) return html;
  const heading = html.match(TITLE_H1_RE);
  if (!heading || !isDuplicateNoteTitle(plainText(heading[1]))) return html;

  const title = fallbackTitle?.trim();
  // Function replacers: a "$" in a title must not be read as a pattern.
  const replacement = title
    ? heading[0].replace(
        /(<h1\b[^>]*>)[\s\S]*?(<\/h1>)/i,
        (_match, open: string, close: string) =>
          `${open}${escapeHtml(title)}${close}`
      )
    : "";
  let repaired = html.replace(heading[0], () => replacement);

  repaired = repaired.replace(PARAGRAPH_RE, (paragraph, inner: string) => {
    const text = plainText(inner);
    if (DIFFERENCE_FILLER_RE.test(text)) return "";
    if (MATCH_NOTE_RE.test(text)) {
      const links = inner.match(ANCHOR_RE);
      if (!links) return paragraph;
      const items = links
        .map((link) => `<li><p>${link}: similar earlier ticket.</p></li>`)
        .join("");
      return `<h2>Related tickets</h2><ul>${items}</ul>`;
    }
    return paragraph;
  });
  return repaired.replace(/\n{3,}/g, "\n\n").trim();
}
