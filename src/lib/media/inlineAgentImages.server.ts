import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7514_INLINE_AGENT_IMAGES_FLAG } from "@/lib/flags/keys";
import { inlineAgentImages, type InlineAgentImageOptions } from "./inlineAgentImages";

export async function inlineAgentImagesForUser(html: string, userId: number, options: Omit<InlineAgentImageOptions, "enabled"> = {}): Promise<string> {
  const embedded = inlineAgentImages(html, { ...options, enabled: true });
  if (embedded === html) return html;
  return await isFeatureEnabled(HTPR_7514_INLINE_AGENT_IMAGES_FLAG, userId) ? embedded : html;
}
