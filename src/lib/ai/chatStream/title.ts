import { downloadWithoutBrotli } from "@/lib/net/downloadWithoutBrotli";
import { resolveAiModel as resolveLegacyAiModel } from "@/app/api/ai/_lib/modelProvider";
import { defaultModelKeyFor } from "@/lib/aiModelOptions";
import { resolveAiFallbackCredential, getAiDefaultModelContext, resolveAutomaticAiModel } from "@/app/api/ai/_lib/byokKeys";
import { getByokOrTeamGatewayApiKeyForProvider } from "@/app/api/ai/_lib/byokKeys";
import { aiUsageProviderForCredential, configureAiModelUsage } from "@/app/api/ai/_lib/modelProvider";
import { renderPrompt } from "@/lib/ai/prompts/registry";
import { type AiGatewayTags, isAiGatewayEnabled, providerOptionsForAiModel } from "@/app/api/ai/_lib/modelProvider";
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

async function chatTitleTokenCap(userId: number | null | undefined): Promise<number | undefined> {
  try {
    const { aiThinkingOptInEnabled, CHAT_TITLE_MAX_OUTPUT_TOKENS } = require("@/app/api/ai/_lib/reasoningEffort") as typeof import("@/app/api/ai/_lib/reasoningEffort");
    return await aiThinkingOptInEnabled(userId) ? CHAT_TITLE_MAX_OUTPUT_TOKENS : undefined;
  } catch {
    return undefined;
  }
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
    const defaultContext = { ...(typeof getAiDefaultModelContext === "function" ? await getAiDefaultModelContext({ trustedTeamId: tags?.teamId, projectId: usageContext?.projectId ?? tags?.projectId, userId: usageContext?.userId ?? tags?.userId }) : { haiku55Enabled: false, byok: undefined }), openaiOnlyDefaultEnabled: false };
    if ("anthropicDisabled" in defaultContext && defaultContext.anthropicDisabled) return fallback;
    const useHaiku = defaultModelKeyFor(defaultContext, "gpt-6-luna") === "claude-haiku-5-5";
    const provider = useHaiku ? defaultContext.byok?.provider === "openrouter" ? "openrouter" : "claude" : "openai";
    const modelInput = await resolveAiFallbackCredential(async () => useHaiku
      ? defaultContext.byok?.credential ?? await getByokOrTeamGatewayApiKeyForProvider(provider, undefined, {
          trustedTeamId: tags?.teamId,
          projectId: usageContext?.projectId ?? tags?.projectId,
          userId: usageContext?.userId ?? tags?.userId,
        })
      : byokApiKey, new Error("This team needs its own AI key for titles."));
    const model = defaultContext.haiku55Enabled ? resolveAutomaticAiModel(provider, useHaiku ? provider === "openrouter" ? "anthropic/claude-haiku-5.5" : "claude-haiku-5-5" : "gpt-6-luna", modelInput, { haiku55Enabled: defaultContext.haiku55Enabled, lookup: { trustedTeamId: tags?.teamId, projectId: usageContext?.projectId ?? tags?.projectId, userId: usageContext?.userId ?? tags?.userId }, feature: "chat" }) : resolveLegacyAiModel("openai", "gpt-6-luna", byokApiKey);
    const thinkingOptIn = await chatTitleTokenCap(usageContext?.userId ?? tags?.userId);
    configureAiModelUsage(model, {
      ...(usageContext ?? {}),
      userId: usageContext?.userId ?? tags?.userId,
      teamId: tags?.teamId ?? null,
      provider: useHaiku ? aiUsageProviderForCredential(provider, modelInput) : provider,
      feature: "chat",
      reasoningFeature: "chat-title",
    });
    const result = await generateText({
      experimental_download: downloadWithoutBrotli,
      model,
      instructions:
        renderPrompt("title-instructions-1"),
      messages: [{ role: "user", content: content || message }],
      temperature: 1,
      maxRetries: 1,
      abortSignal,
      ...(thinkingOptIn ? { maxOutputTokens: thinkingOptIn } : {}),
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
