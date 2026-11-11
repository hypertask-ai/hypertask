import { uploadTaskAttachmentToS3 } from "@/lib/storage/uploadTaskAttachmentToS3";
import type { AgentImageAttachment } from "./inlineAgentImages";

const DATA_IMAGE_RE = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i;
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };

export async function hostInlineScreenshots(files: AgentImageAttachment[] | undefined): Promise<AgentImageAttachment[]> {
  const hosted: AgentImageAttachment[] = [];
  for (const file of files ?? []) {
    const shot = await hostOne(file);
    if (shot) hosted.push(shot);
  }
  return hosted;
}

async function hostOne(file: AgentImageAttachment): Promise<AgentImageAttachment | null> {
  if (!file.url) return null;
  if (/^https?:\/\//i.test(file.url)) return file;
  const match = DATA_IMAGE_RE.exec(file.url);
  if (!match) return null;
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > MAX_SCREENSHOT_BYTES) return null;
  const mimeType = file.mimeType ?? match[1];
  const fileName = file.fileName ?? `screenshot.${EXTENSIONS[mimeType] ?? "png"}`;
  try {
    return { ...file, url: await uploadTaskAttachmentToS3(buffer, fileName, mimeType), fileName, mimeType };
  } catch {
    return null;
  }
}
