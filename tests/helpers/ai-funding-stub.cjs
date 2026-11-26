function isPlatformAnthropicCredential(credential) {
  return Boolean(
    credential &&
      typeof credential === "object" &&
      credential.kind === "platform-anthropic",
  );
}

function isBasetenCredential(credential) {
  return Boolean(
    credential && typeof credential === "object" && credential.kind === "baseten",
  );
}

function isVercelAiGatewayKey(apiKey) {
  return typeof apiKey === "string" && apiKey.trim().startsWith("vck_");
}

function isAnthropicModelId(modelId) {
  const normalized = String(modelId ?? "").trim().toLowerCase();
  return (
    normalized.startsWith("claude-") ||
    normalized.startsWith("anthropic/claude-")
  );
}

function toDirectAnthropicModelId(modelId, modelOption) {
  if (modelOption?.directModel) return modelOption.directModel;
  const bare = String(modelId).trim().replace(/^anthropic\//i, "");
  return bare.replace(/^(claude-(?:haiku|sonnet|opus)-\d+)\.(\d+)/i, "$1-$2");
}

function toGatewayAnthropicModelSlug(modelId, modelOption) {
  const raw = String(modelOption?.model ?? modelId).trim();
  const bare = raw.replace(/^anthropic\//i, "");
  const dotted = bare.replace(
    /^(claude-(?:haiku|sonnet|opus)-\d+)-(\d+)$/i,
    "$1.$2",
  );
  return `anthropic/${dotted}`;
}

function isCustomerPaidCredential(credential, sharedKey, isManaged) {
  if (!credential) return false;
  if (isPlatformAnthropicCredential(credential)) return false;
  if (typeof credential === "object") return true;
  if (typeof credential !== "string") return false;
  const trimmed = credential.trim();
  if (!trimmed) return false;
  if (sharedKey && trimmed === sharedKey) return false;
  if (isManaged?.(trimmed)) return false;
  return true;
}

function createAiFundingStub(stubs = {}, options = {}) {
  const anthropicMod = stubs["@ai-sdk/anthropic"] ?? {};
  const openaiMod = stubs["@ai-sdk/openai"] ?? {};
  const openrouterMod = stubs["@openrouter/ai-sdk-provider"] ?? {};
  const aiMod = stubs.ai ?? {};
  const createAnthropic =
    anthropicMod.createAnthropic ??
    (() => Object.assign(() => ({}), { tools: { webSearch_20250305: () => ({}) } }));
  const createOpenAI =
    openaiMod.createOpenAI ??
    (() => Object.assign(() => ({}), { chat: () => ({}), tools: { webSearch: () => ({}) } }));
  const createOpenRouter =
    openrouterMod.createOpenRouter ?? (() => () => ({}));
  const defaultGatewayFactory = (() => {
    try {
      const realAi = require("ai");
      if (typeof realAi.createGateway === "function") return realAi.createGateway;
    } catch {}
    return () =>
      Object.assign(
        (modelId) => ({ specificationVersion: "v4", provider: "gateway", modelId }),
        { imageModel: (modelId) => ({ specificationVersion: "v4", provider: "gateway", modelId }) },
      );
  })();
  const createGateway = aiMod.createGateway ?? defaultGatewayFactory;

  return {
    PLATFORM_ANTHROPIC_ENV_VAR: "ANTHROPIC_API_KEY",
    PLATFORM_ANTHROPIC_CREDIT_ENV_VAR: "ANTHROPIC_MONTHLY_CREDIT_USD",
    DEFAULT_ANTHROPIC_MONTHLY_CREDIT_USD: 200,
    PLATFORM_ANTHROPIC_USAGE_PROVIDER: "platform:anthropic",
    AI_FUNDING_TABLE: [],
    isPlatformAnthropicCredential,
    isBasetenCredential,
    isVercelAiGatewayKey,
    isAnthropicModelId,
    toDirectAnthropicModelId,
    toGatewayAnthropicModelSlug,
    isCustomerPaidCredential,
    isHypertaskPaidAutoContext: ({ plan, byokProviderFlags, forcedProvider, payer } = {}) => {
      if (payer === "customer") return false;
      if (payer === "hypertask") return true;
      if (forcedProvider) return false;
      if (plan === "BYOK") {
        return !byokProviderFlags?.some((flag) => flag.enabled && Boolean(flag.provider));
      }
      return true;
    },
    platformAnthropicApiKey: () => options.anthropicApiKey,
    anthropicMonthlyCreditLimitUsd: () => options.limitUsd ?? 200,
    getAnthropicMonthlySpendUsd: async () => options.spentUsd ?? 0,
    recordAnthropicMonthlySpend: async () => {},
    getAnthropicMonthlyCreditState: async () => ({
      month: "2026-11",
      limitUsd: options.limitUsd ?? 200,
      spentUsd: options.spentUsd ?? 0,
      remainingUsd: Math.max(0, (options.limitUsd ?? 200) - (options.spentUsd ?? 0)),
      configured: Boolean(options.anthropicApiKey),
      available: Boolean(options.anthropicApiKey) && (options.spentUsd ?? 0) < (options.limitUsd ?? 200),
      fallbackReason: !options.anthropicApiKey
        ? "anthropic_key_missing"
        : (options.spentUsd ?? 0) >= (options.limitUsd ?? 200)
          ? "anthropic_credit_exhausted"
          : null,
    }),
    classifySafeProviderError: (error) => require("./loadModule.cjs").loadModule(
      "src/app/api/ai/_lib/aiFunding.ts",
      {
        "@/lib/prisma": {},
        "@/lib/redis": {},
        "@/lib/errors/reportError": {},
        "@/lib/flags": {},
      },
    ).classifySafeProviderError(error),
    fundedBatchAllowed: async () => true,
    classifyGatewayFailureCause: () => "gateway_error",
    reportAiFundingIncident: async () => false,
    resolveHypertaskAnthropicCredential: async ({ fallbackGatewayApiKey } = {}) => ({
      route: "hypertask-gateway",
      credential: fallbackGatewayApiKey,
      anthropicCredit: {
        month: "2026-11",
        limitUsd: 200,
        spentUsd: 0,
        remainingUsd: 200,
        configured: false,
        available: false,
        fallbackReason: "anthropic_key_missing",
      },
    }),
    resolveAiFundingTableDecision: (args) => ({
      plan: args.plan,
      payer: args.customerKey || args.forcedKey ? "customer" : "hypertask",
      route: args.forcedKey
        ? "customer-forced"
        : args.customerKey
          ? "customer-byok"
          : "hypertask-gateway",
      credential: args.forcedKey?.apiKey ?? args.customerKey ?? args.hypertaskGatewayKey,
      anthropicCredit: args.anthropicCredit,
    }),
    createFundingGatewayClient: ({ apiKey }) => createGateway({ apiKey }),
    createFundingGatewayLanguageModel: (modelSlug, apiKey) =>
      createGateway({ apiKey })(modelSlug),
    createFundingGatewayImageModel: (modelSlug, apiKey) =>
      createGateway({ apiKey }).imageModel(modelSlug),
    createFundingAnthropicLanguageModel: (modelId, apiKey) =>
      createAnthropic({ apiKey })(modelId),
    createFundingOpenAiLanguageModel: (modelId, opts) => {
      const client = createOpenAI({
        apiKey: opts.apiKey,
        ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
      });
      return opts.useChat ? client.chat(modelId) : client(modelId);
    },
    createFundingOpenRouterLanguageModel: (modelId, apiKey) =>
      createOpenRouter({ apiKey })(modelId),
    createAnthropicWebSearchTool: (apiKey) =>
      createAnthropic({ apiKey: apiKey ?? "" }).tools?.webSearch_20250305?.({
        maxUses: 5,
      }),
    createOpenAiWebSearchTool: (apiKey) =>
      createOpenAI({ apiKey: apiKey ?? "" }).tools?.webSearch?.(),
  };
}

module.exports = { createAiFundingStub };
