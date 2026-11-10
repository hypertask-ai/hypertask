export const EMBEDDING_USD_PER_MILLION_TOKENS = 0.02;
export const APPROVED_PROVIDER_CAPS_USD = {
  trials: 40, hypertask: 68, demo: 15, embeddings: 1, unusedCustomerKey: 10, valentinBoards: 4, vetsak: 1,
} as const;
export const PROVIDER_CAP_TEST_USD = 0.01;
export function monthEndHoldUntilMs(now: Date): number { return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1); }
export function upperBoundTokens(text: string): number { return Math.max(1, text.length); }
export function batchHoldMicroUsd(parts: Array<{ inputTokens: number; outputTokens: number; inputUsdPerToken: number; outputUsdPerToken: number }>): number {
  const usd = parts.reduce((sum, part) => sum + (Math.max(0, part.inputTokens) * part.inputUsdPerToken + Math.max(0, part.outputTokens) * part.outputUsdPerToken) * 0.5, 0);
  return Math.max(1, Math.ceil(usd * 1_000_000));
}
export function halfPriceMicroUsd(normalUsd: number): number {
  if (!Number.isFinite(normalUsd) || normalUsd <= 0) return 0;
  return Math.ceil(normalUsd * 0.5 * 1_000_000);
}
export function embeddingCostUsd(tokens: number): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return Math.floor(tokens) * EMBEDDING_USD_PER_MILLION_TOKENS / 1_000_000;
}
export function batchEligibleWhenCapped(source: "customer" | "managed" | "shared", planMode: boolean, holdsOn: boolean): boolean {
  if (source === "customer") return false;
  if (!planMode) return source === "managed";
  return holdsOn && (source === "managed" || source === "shared");
}
export type EmbeddingDecision = "current" | "vector" | "keyword" | "customer-key";
export function embeddingDecision(args: { spendPathOn: boolean; plan: string | null; hasOwnKey: boolean; overCap: boolean; canCharge: boolean }): EmbeddingDecision {
  if (!args.spendPathOn) return "current";
  if (args.plan === "BYOK" && args.hasOwnKey) return "customer-key";
  if (args.plan === "BYOK" || args.overCap || !args.canCharge) return "keyword";
  return "vector";
}
export function nativeWebSearchAllowed(provider: string, customerPays: boolean, spendPathOn: boolean): boolean {
  if (provider !== "claude" && provider !== "openai") return false;
  return !(spendPathOn && !customerPays);
}
export function providerCapBlocks(spentUsd: number, capUsd: number): boolean {
  if (!Number.isFinite(spentUsd) || !Number.isFinite(capUsd) || capUsd < 0 || spentUsd < 0) return true;
  return spentUsd >= capUsd;
}
export function shouldRevokeManagedKey(args: { spendUsd30d: number | null; teamGone: boolean }): boolean {
  return args.teamGone && args.spendUsd30d === 0;
}
