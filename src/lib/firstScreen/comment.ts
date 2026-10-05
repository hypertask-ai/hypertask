import { parse } from "node-html-parser";

export function projectCommentPreview(html: string, userId?: string | number) {
  const root = parse(html);
  // Browser textContent does not insert a newline for a br element.
  root.querySelectorAll("br").forEach((node) => node.remove());
  const fullText = root.textContent;
  root.querySelectorAll("blockquote").forEach((node) => node.remove());
  root.querySelectorAll("p").forEach((paragraph) => {
    const mentions = paragraph.querySelectorAll('span[data-type="mention"]');
    const mention = mentions[0];
    const elements = paragraph.childNodes.filter((node) => node.nodeType === 1);
    if (!mention || mentions.length !== 1 || elements.length !== 1 || elements[0] !== mention) return;
    const text = mention.textContent.trim();
    if (text && paragraph.textContent.trim().replace(/:$/, "").trim() === `${text} said`) paragraph.remove();
  });
  const mention = userId === undefined ? null : root.querySelectorAll('span[data-type="mention"]')
    .find((node) => node.getAttribute("data-label") === `name-${userId}`);
  if (!mention) return { text: root.textContent.trim() || fullText, mention: null };
  const name = mention.textContent;
  const parent = mention.parentNode?.textContent ?? "";
  const index = parent.indexOf(name);
  return { text: parent, mention: { before: parent.slice(0, index), name, after: parent.slice(index + name.length) } };
}

export function projectPlainText(html: string) {
  const root = parse(html);
  root.querySelectorAll("br").forEach((node) => node.remove());
  return root.textContent;
}
