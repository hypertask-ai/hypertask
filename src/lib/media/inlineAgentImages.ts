import { parse } from "node-html-parser";
import { isImageUrl } from "@/lib/media/isImageUrl";
import { isBrowserRenderableImage } from "@/lib/media/browserRenderableImage";
import { sanitizeRichHtml } from "@/utils/helperFunctions/sanitizeRichHtml";
import { escapeHtml } from "@/utils/helperFunctions/escapeHtml";

export interface AgentImageAttachment {
  url: string;
  fileName?: string | null;
  mimeType?: string | null;
}

export interface InlineAgentImageOptions {
  enabled: boolean;
  inlineImages?: boolean;
  instructions?: string;
  attachments?: AgentImageAttachment[];
}

export function imageEmbeddingOptOut(text: string): boolean {
  return /\b(?:attachments?|links?)[\s-]+only\b|\bonly\s+(?:attach|link)\b|\b(?:do\s+not|don['’]t|never)\s+(?:embed|inline)\b/i.test(parse(text).textContent);
}

export function inlineAgentImages(html: string, options: InlineAgentImageOptions): string {
  if (!options.enabled || options.inlineImages === false || imageEmbeddingOptOut(options.instructions ?? "") || imageEmbeddingOptOut(html)) return html;

  const root = parse(html);
  const source = parse(html + (options.instructions ?? ""));
  const seen = new Set(root.querySelectorAll("img").map((node) => node.getAttribute("src")));
  const candidates: AgentImageAttachment[] = [...(options.attachments ?? [])];
  for (const anchor of source.querySelectorAll("a")) {
    const url = anchor.getAttribute("href");
    if (url && isImageUrl(url)) candidates.push({ url });
  }
  const text = parse((html + " " + (options.instructions ?? "")).replace(/<[^>]*>/g, " ")).textContent;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const url = match[0].replace(/[.,;!?)\]}]+$/, "");
    if (isImageUrl(url)) candidates.push({ url });
  }

  const nonImages = new Set((options.attachments ?? [])
    .filter((file) => !isBrowserRenderableImage(file.mimeType, file.fileName ?? file.url))
    .map((file) => file.url));
  let images = "";
  for (const candidate of candidates) {
    if (seen.has(candidate.url) || nonImages.has(candidate.url) || !isBrowserRenderableImage(candidate.mimeType, candidate.fileName ?? candidate.url)) continue;
    let url: URL;
    try {
      url = new URL(candidate.url);
    } catch {
      continue;
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) continue;
    const image = sanitizeRichHtml(`<img src="${escapeHtml(candidate.url)}" alt="${escapeHtml(candidate.fileName ?? "")}">`);
    if (!image) continue;
    seen.add(candidate.url);
    images += `<p>${image}</p>`;
  }
  return html + images;
}
