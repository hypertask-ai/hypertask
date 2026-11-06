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

export function cachedInstructions(args: CachedInstructionsArgs): CachedInstructions {
  const suffix = args.suffix ?? "";
  if (!isClaudeModelId(args.modelId) || estimatePromptTokens(args.fixed) < PROMPT_CACHE_MIN_TOKENS) {
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
  _userId: number | null | undefined,
  args: CachedInstructionsArgs,
): Promise<CachedInstructions> {
  return cachedInstructions(args);
}
