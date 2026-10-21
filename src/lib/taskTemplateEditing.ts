import { escapeHtml } from "@/utils/htmlEscape";

export function readTaskTemplateDescription(html: string) {
  const body = new DOMParser().parseFromString("", "text/html").body;
  body.innerHTML = html;
  const blocks = Array.from(body.children);
  const editable = Array.from(body.childNodes).every((node) =>
    node.nodeType === 3 ? !node.textContent?.trim() :
      node.nodeType === 1 && ["H2", "P"].includes((node as Element).tagName) &&
      !(node as Element).attributes.length &&
      Array.from(node.childNodes).every((child) => child.nodeType === 3) &&
      !node.textContent?.includes("\n"),
  );
  return {
    editable,
    text: editable
      ? blocks.map((block) => block.textContent ?? "").join("\n\n")
      : body.textContent ?? "",
    headings: Array.from(body.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((heading) => heading.textContent ?? ""),
  };
}

export function writeTaskTemplateDescription(text: string, originalHtml: string) {
  const original = readTaskTemplateDescription(originalHtml);
  if (!original.editable || original.text === text) return originalHtml;
  return text.split(/\r?\n/).filter((block) => block.trim()).map((block) => {
    const tag = original.headings.includes(block) ? "h2" : "p";
    return `<${tag}>${escapeHtml(block)}</${tag}>`;
  }).join("");
}
