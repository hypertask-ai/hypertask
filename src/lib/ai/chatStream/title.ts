import { configureAiModelUsage } from "@/app/api/ai/_lib/modelProvider";
import { renderPrompt } from "@/lib/ai/prompts/registry";
import { type AiGatewayTags, isAiGatewayEnabled, resolveAiModel, providerOptionsForAiModel } from "@/app/api/ai/_lib/modelProvider";
import { generateText } from "ai";

export function fallbackTitle(message: string) {
  return message
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 8)
    .join(" ")
    .replace(/^["']|["']$/g, "")
    .replace(/[.!?;:,]+$/g, "")
    .trim();
}

export async function generateConversationTitle(
  content: string,
  message: string,
  byokApiKey?: string,
  tags?: AiGatewayTags,
  usageContext?: {
    userId: number;
    projectId?: number | null;
    taskId?: number | null;
    agentId?: string | null;
  },
  abortSignal?: AbortSignal,
) {
  const fallback = fallbackTitle(message);
  if (!byokApiKey && !isAiGatewayEnabled()) {
    return fallback;
  }
  try {
    const model = resolveAiModel("openai", "gpt-6-luna", byokApiKey);
    if (usageContext) configureAiModelUsage(model, {
      ...usageContext,
      teamId: tags?.teamId ?? null,
      provider: "openai",
      feature: "chat",
    });
    const result = await generateText({
      model,
      instructions:
        renderPrompt("title-instructions-1"),
      messages: [{ role: "user", content: content || message }],
      temperature: 1,
      maxRetries: 1,
      abortSignal,
      providerOptions: providerOptionsForAiModel(model, "chat", tags),
    });

    const cleaned = fallbackTitle(result.text);
    return cleaned || fallback;
  } catch (error) {
    if (abortSignal?.aborted) throw error;
    console.error("[ai/chat/stream] title generation failed", error);
    return fallback;
  }
}
