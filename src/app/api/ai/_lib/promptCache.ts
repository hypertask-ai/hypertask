import type { SystemModelMessage } from "ai";

export const PROMPT_CACHE_MIN_TOKENS = 512;

export type CachedInstructions = string | SystemModelMessage[];

export function estimatePromptTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function isClaudeModelId(modelId: string | null | undefined): boolean {
  return /claude/i.test(modelId ?? "");
}

type CachedInstructionsArgs = {
  modelId: string | null | undefined;
  fixed: string;
  suffix?: string;
};

export function cachedInstructions(args: CachedInstructionsArgs & { enabled: boolean }): CachedInstructions {
  const suffix = args.suffix ?? "";
  if (!args.enabled || !isClaudeModelId(args.modelId) || estimatePromptTokens(args.fixed) < PROMPT_CACHE_MIN_TOKENS) {
    return `${args.fixed}${suffix}`;
  }
  const messages: SystemModelMessage[] = [
    {
      role: "system",
      content: args.fixed,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    },
  ];
  if (suffix.trim()) messages.push({ role: "system", content: suffix.trim() });
  return messages;
}

export async function cachedInstructionsForUser(
  userId: number | null | undefined,
  args: CachedInstructionsArgs,
): Promise<CachedInstructions> {
  let enabled = false;
  try {
    const { promptCacheEnabled } = await import("@/app/api/ai/_lib/planGate");
    enabled = await promptCacheEnabled(userId);
  } catch {
  }
  return cachedInstructions({ ...args, enabled });
}
