import { HTMLElement, Node, parse } from "node-html-parser";

import { escapeHtml } from "./escapeHtml";
import { buildRichTextMentionHref } from "./richTextMention";

const INLINE_TAGS = new Set([
  "a",
  "b",
  "br",
  "code",
  "em",
  "i",
  "img",
  "input",
  "s",
  "span",
  "strong",
  "u",
]);
const MENTION_ATTRIBUTES = new Set([
  "class",
  "contenteditable",
  "data-id",
  "data-label",
  "data-mention-suggestion-char",
  "data-type",
  "projectid",
  "text",
  "uniqueindex",
]);

function isInlineNode(node: Node) {
  if (node.nodeType === 3) return true;
  return node.nodeType === 1 && INLINE_TAGS.has(String(node.rawTagName).toLowerCase());
}

function normalizeListItems(root: HTMLElement) {
  const items = root.querySelectorAll("li");
  for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
    const item = items[itemIndex];
    const children = item.childNodes ?? [];
    const firstContentIndex = children.findIndex(
      (node) => node.nodeType !== 3 || String(node.text ?? "").trim().length > 0,
    );
    if (firstContentIndex < 0 || !isInlineNode(children[firstContentIndex])) continue;

    let inlineEnd = firstContentIndex;
    while (inlineEnd < children.length && isInlineNode(children[inlineEnd])) {
      inlineEnd += 1;
    }

    const inlineContent = children
      .slice(0, inlineEnd)
      .map((node) => node.toString())
      .join("");
    const remainingContent = children
      .slice(inlineEnd)
      .map((node) => node.toString())
      .join("");
    item.set_content(`<p>${inlineContent}</p>${remainingContent}`);
  }
}

function normalizeMentionLinks(root: HTMLElement) {
  for (const mention of root.querySelectorAll('[data-type="mention"]')) {
    const tag = String(mention.rawTagName ?? "").toLowerCase();
    if (tag !== "span" && tag !== "a") continue;

    const href = buildRichTextMentionHref({
      label: mention.getAttribute("data-label"),
      dataId: mention.getAttribute("data-id"),
      projectId: mention.getAttribute("projectid"),
      uniqueIndex: mention.getAttribute("uniqueindex"),
    });
    if (!href) continue;

    const attributes = Object.entries(mention.attributes ?? {})
      .filter(([name]) => MENTION_ATTRIBUTES.has(name.toLowerCase()))
      .map(([name, value]) => `${name.toLowerCase()}="${escapeHtml(String(value))}"`)
      .join(" ");
    const anchor = parse(
      `<a href="${escapeHtml(href)}"${attributes ? ` ${attributes}` : ""}>${mention.innerHTML}</a>`,
      { lowerCaseTagName: true },
    ).firstChild;
    if (anchor) mention.replaceWith(anchor);
  }
}

export function normalizeRichTextStructure(html: string): string {
  const hasMention = /<(?:a|span)\b[^>]*\bdata-type\s*=\s*["']mention["']/i.test(html);
  if (!html || (!/<li\b/i.test(html) && !hasMention)) return html;

  const root = parse(html, { comment: false, lowerCaseTagName: true });
  normalizeListItems(root);
  normalizeMentionLinks(root);
  return root.toString();
}
