import type { SystemModelMessage } from "ai";

/** Anthropic skips caching below this size (Haiku 5.5 and Sonnet 5.5); estimated as chars / 4. */
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
  /** Text that varies per call; sent after the cache breakpoint. */
  suffix?: string;
};

/**
 * HTPR-7076: fixed instruction text for `instructions`/`system`. Returns the plain
 * string unless caching applies; otherwise a system message marked for Anthropic's
 * ephemeral cache, followed by `suffix` as a second, uncached system message so the
 * cached prefix stays identical between calls. The Vercel AI Gateway client forwards
 * `providerOptions.anthropic.cacheControl` untouched in the request body.
 */
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

/** Same as `cachedInstructions`, reading the HTPR-7076 flag for this user (user 0 for jobs with no user). */
export async function cachedInstructionsForUser(
  userId: number | null | undefined,
  args: CachedInstructionsArgs,
): Promise<CachedInstructions> {
  let enabled = false;
  try {
    const { promptCacheEnabled } = await import("@/app/api/ai/_lib/planGate");
    enabled = await promptCacheEnabled(userId);
  } catch {
    // A failed flag read keeps the plain instructions.
  }
  return cachedInstructions({ ...args, enabled });
}
