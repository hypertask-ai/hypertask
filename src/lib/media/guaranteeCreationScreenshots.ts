import { inlineAgentImages, type AgentImageAttachment } from "@/lib/media/inlineAgentImages";

const URL_RE = /https?:\/\/[^\s<>"']+/gi;

export function creationScreenshotCandidates(
  files: { url?: string | null; fileName?: string | null; mimeType?: string | null }[] | undefined,
  text?: string,
): AgentImageAttachment[] {
  const candidates: AgentImageAttachment[] = [];
  const seen = new Set<string>();
  const push = (file: { url?: string | null; fileName?: string | null; mimeType?: string | null }) => {
    const url = file.url?.trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    candidates.push({ url, fileName: file.fileName, mimeType: file.mimeType });
  };
  for (const file of files ?? []) push(file);
  for (const match of (text ?? "").matchAll(URL_RE)) {
    push({ url: match[0].replace(/[.,;!?)\]}]+$/, "") });
  }
  return candidates;
}

export function guaranteeCreationScreenshots(
  html: string,
  options: { instructions?: string; attachments?: AgentImageAttachment[] },
): string {
  return inlineAgentImages(html, {
    enabled: true,
    instructions: options.instructions,
    attachments: options.attachments,
  });
}
