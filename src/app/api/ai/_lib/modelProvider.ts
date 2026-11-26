import { fetchWithoutBrotli } from "@/lib/net/fetchWithoutBrotli";
import { createHmac, randomUUID } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { logAiUsage, type AiUsageRecord } from "./aiUsage";
import { identifyPrompt } from "@/lib/ai/prompts/registry";
import { recordAiChatTurn } from "@/lib/telemetry/aiChatObservability";
import { reportError } from "@/lib/errors/reportError";
import {
  wrapImageModel,
  wrapLanguageModel,
  type ImageModel,
  type LanguageModel,
  type LanguageModelMiddleware,
} from "ai";
import {
  classifyGatewayFailureCause,
  classifySafeProviderError,
  createFundingAnthropicLanguageModel,
  createFundingGatewayImageModel,
  createFundingGatewayLanguageModel,
  createFundingOpenAiLanguageModel,
  createFundingOpenRouterLanguageModel,
  isAnthropicModelId,
  isBasetenCredential,
  isPlatformAnthropicCredential,
  isVercelAiGatewayKey,
  PLATFORM_ANTHROPIC_USAGE_PROVIDER,
  recordAnthropicMonthlySpend,
  reportAiFundingIncident,
  resolveHypertaskAnthropicCredential,
  toDirectAnthropicModelId,
  toGatewayAnthropicModelSlug,
  type AiModelCredential,
  type BasetenCredential,
  type GatewayFundingSource,
  type PlatformAnthropicCredential,
} from "@/app/api/ai/_lib/aiFunding";
import {
  createImageAllowanceMiddleware,
  createSharedAllowanceMiddleware,
  gatewayCatalogModelSlug,
  modelPricing,
  modelCostUsd,
  sharedAiAllowanceErrorMessage,
  teamAllowanceSnapshot,
} from "@/app/api/ai/_lib/sharedAllowance";
import {
  getAiModelDefinition,
  isHaiku55Model,
  isHaiku45Model,
  resolveHaikuModelId,
  type TAiModelOption,
  type TAiProviderOptions,
} from "@/lib/aiModelOptions";
import { BASETEN_BYOK_PROVIDER, BASETEN_MODEL_SLUGS, getAiProviderInfo, type TAiProviderKey } from "@/lib/aiProviders";
import {
  FREE_TEAM_AI_ALLOWANCE_USD,
  PAID_TEAM_AI_ALLOWANCE_USD,
} from "@/lib/aiAllowancePolicy";
import {
  INCLUDED_WITH_HYPERTASK_GATEWAY_TAG,
  isSystemAiFeature,
} from "@/lib/aiUsageClassification";
import {
  isCustomEndpointConfig,
  normalizeCustomEndpointConfig,
  type CustomEndpointConfig,
} from "@/lib/ai/customEndpoint";
import type { ReasoningEffort } from "@/app/api/ai/_lib/reasoningEffort";

export class AiGatewayKeyRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiGatewayKeyRequiredError";
  }
}

export {
  isCustomEndpointConfig,
  isPlatformAnthropicCredential,
  isVercelAiGatewayKey,
  type AiModelCredential,
  type BasetenCredential,
  type GatewayFundingSource,
  type PlatformAnthropicCredential,
};

export type ModelProviderId =
  "claude" | "openai" | "openrouter" | "gateway" | "custom";
export type AiGatewayFeature =
  | "chat"
  | "summary"
  | "task-questions"
  | "editor"
  | "task-writer"
  | "hyper-mentioned"
  | "generate-image"
  | "custom-instructions"
  | "smart-label"
  | "jev-duplicate"
  | "jev-inbox"
  | "jev-auto-model"
  | "onboarding-board"
  | "status-update"
  | "suggest-reply";

export type AiProviderOptions = TAiProviderOptions;

export type AiGatewayTags = {
  teamId?: string | null;
  projectId?: number | null;
  userId?: number | null;
  taskId?: number | null;
  agentId?: string | null;
};

export type GatewayTaggedProviderOptions = AiProviderOptions & {
  gateway: {
    tags: string[];
    models?: string[];
  };
};

function aiGatewayEnabledValue() {
  return process.env.AI_GATEWAY_ENABLED?.trim().toLowerCase();
}

function defaultGatewayApiKey() {
  return process.env.AI_GATEWAY_API_KEY?.trim() || undefined;
}

const managedGatewayKeys = new Set<string>();

export function registerManagedGatewayKey(apiKey: string) {
  const normalized = apiKey.trim();
  if (isVercelAiGatewayKey(normalized)) managedGatewayKeys.add(normalized);
}

export function gatewayFundingSourceForApiKey(
  apiKey: string,
): GatewayFundingSource {
  const normalized = apiKey.trim();
  if (normalized === defaultGatewayApiKey()) return "shared";
  if (managedGatewayKeys.has(normalized)) return "managed";
  return "customer";
}

const allowanceFundedModels = new WeakMap<object, number>();
const runtimeProviderOverrides = new WeakMap<object, { provider?: string }>();
const platformAnthropicFundedModels = new WeakSet<object>();

const USER_VISIBLE_STREAM_CHUNK_TYPES = new Set([
  "text-delta",
  "reasoning-delta",
  "tool-input-delta",
  "tool-call",
  "file",
  "source",
  "finish",
]);

function isFailedFinishChunk(chunk: { type?: string; finishReason?: { unified?: string } }): boolean {
  return chunk.type === "finish" && chunk.finishReason?.unified === "error";
}

function recordReplacedDirectUsage(modelId: string, usage: { inputTokens?: { total?: number; cacheRead?: number; cacheWrite?: number }; outputTokens?: { total?: number } } | undefined) {
  void generationCostUsd(
    modelId,
    PLATFORM_ANTHROPIC_USAGE_PROVIDER,
    usage?.inputTokens?.total ?? 0,
    usage?.outputTokens?.total ?? 0,
    usage?.inputTokens?.cacheRead ?? 0,
    usage?.inputTokens?.cacheWrite ?? 0,
  )
    .then((costUsd) => recordAnthropicMonthlySpend(costUsd))
    .catch(() => undefined);
}

function failedFinishReason(result: { finishReason?: { unified?: string } }): Error | undefined {
  return result.finishReason?.unified === "error"
    ? new Error("AI generation finished with an error")
    : undefined;
}

function streamFailureReason(chunk: { type?: string; error?: unknown; finishReason?: { unified?: string } }): unknown {
  if (chunk.type === "error") return chunk.error;
  if (isFailedFinishChunk(chunk)) return new Error("AI stream finished with an error");
  return undefined;
}

function isUserVisibleStreamChunk(chunk: { type?: string; delta?: string; finishReason?: { unified?: string } }): boolean {
  if (isFailedFinishChunk(chunk)) return false;
  return typeof chunk.type === "string" && USER_VISIBLE_STREAM_CHUNK_TYPES.has(chunk.type) &&
    (!("delta" in chunk) || Boolean(chunk.delta));
}

function createGatewayFailureReportingMiddleware(
  modelSlug: string,
  fundingSource: "managed" | "shared",
): LanguageModelMiddleware {
  const notify = (error: unknown, aborted?: boolean) => {
    if (aborted || sharedAiAllowanceErrorMessage(error)) return;
    const cause = classifyGatewayFailureCause(error);
    void reportAiFundingIncident({
      cause,
      reason: `Hypertask-paid Vercel Gateway (${fundingSource}) failed for ${modelSlug}`,
      provider: "gateway",
      fundingSource,
      errorClass: classifySafeProviderError(error),
      modelId: modelSlug,
    });
  };
  return {
    specificationVersion: "v4",
    wrapGenerate: async ({ doGenerate, params }) => {
      try {
        const result = await doGenerate();
        const failure = failedFinishReason(result);
        if (failure) notify(failure, params.abortSignal?.aborted);
        return result;
      } catch (error) {
        notify(error, params.abortSignal?.aborted);
        throw error;
      }
    },
    wrapStream: async ({ doStream, params }) => {
      try {
        const result = await doStream();
        const reader = result.stream.getReader();
        return {
          ...result,
          stream: new ReadableStream({
            async pull(controller) {
              try {
                const item = await reader.read();
                if (item.done) {
                  controller.close();
                  return;
                }
                const failure = streamFailureReason(item.value);
                if (failure !== undefined) {
                  notify(failure, params.abortSignal?.aborted);
                }
                controller.enqueue(item.value);
              } catch (error) {
                notify(error, params.abortSignal?.aborted);
                controller.error(error);
              }
            },
            async cancel(reason) {
              await reader.cancel(reason);
            },
          }),
        };
      } catch (error) {
        notify(error, params.abortSignal?.aborted);
        throw error;
      }
    },
  };
}

async function wrapAnthropicStreamWithFallback<
  TChunk extends { type: string; error?: unknown },
  TResult extends { stream: ReadableStream<TChunk> },
>(
  startDirectStream: () => PromiseLike<TResult>,
  startFallbackStream: (error: unknown) => PromiseLike<TResult>,
  reportDirectError: (error: unknown) => void,
  canFallback: () => boolean,
  isAborted: () => boolean,
): Promise<TResult> {
  let result: TResult;
  try {
    result = await startDirectStream();
  } catch (error) {
    reportDirectError(error);
    if (isAborted() || !canFallback()) throw error;
    return startFallbackStream(error);
  }
  const reader = result.stream.getReader();
  const buffered: TChunk[] = [];
  while (true) {
    let item: Awaited<ReturnType<typeof reader.read>>;
    try {
      item = await reader.read();
    } catch (error) {
      reportDirectError(error);
      await reader.cancel().catch(() => undefined);
      if (isAborted() || !canFallback()) throw error;
      return startFallbackStream(error);
    }
    if (item.done) {
      return {
        ...result,
        stream: new ReadableStream<TChunk>({
          start(controller) {
            for (const chunk of buffered) controller.enqueue(chunk);
            controller.close();
          },
        }),
      };
    }
    const failure = streamFailureReason(item.value);
    if (failure !== undefined) {
      reportDirectError(failure);
      await reader.cancel().catch(() => undefined);
      if (!isAborted() && canFallback()) return startFallbackStream(failure);
      return {
        ...result,
        stream: new ReadableStream<TChunk>({
          start(controller) {
            for (const chunk of buffered) controller.enqueue(chunk);
            controller.enqueue(item.value);
            controller.close();
          },
        }),
      };
    }
    buffered.push(item.value);
    if (isUserVisibleStreamChunk(item.value)) break;
  }
  let bufferedIndex = 0;
  return {
    ...result,
    stream: new ReadableStream<TChunk>({
      async pull(controller) {
        if (bufferedIndex < buffered.length) {
          controller.enqueue(buffered[bufferedIndex]);
          bufferedIndex += 1;
          return;
        }
        try {
          const item = await reader.read();
          if (item.done) {
            controller.close();
            return;
          }
          const failure = streamFailureReason(item.value);
          if (failure !== undefined) reportDirectError(failure);
          controller.enqueue(item.value);
        } catch (error) {
          reportDirectError(error);
          controller.error(error);
        }
      },
      async cancel(reason) {
        await reader.cancel(reason);
      },
    }),
  };
}

function createDirectAnthropicWithGatewayFallbackMiddleware(
  modelId: string,
  credential: PlatformAnthropicCredential,
  runtimeProvider: { provider?: string },
  modelOption?: TAiModelOption,
): LanguageModelMiddleware {
  const gatewaySlug = toGatewayAnthropicModelSlug(modelId, modelOption);
  const reportDirectError = (error: unknown) => {
    void reportAiFundingIncident({
      cause: "anthropic_error",
      reason: `Direct Anthropic call failed for ${modelId}; falling back to Vercel Gateway`,
      provider: "anthropic",
      fundingSource: credential.gatewayFundingSource ?? "platform",
      errorClass: classifySafeProviderError(error),
      modelId,
    });
  };
  const fallbackModel = () => {
    runtimeProvider.provider = "gateway";
    return gatewayLanguageModel(gatewaySlug, credential.fallbackGatewayApiKey!, false, false) as ReturnType<typeof wrapLanguageModel>;
  };
  return {
    specificationVersion: "v4",
    wrapGenerate: async ({ doGenerate, params }) => {
      runtimeProvider.provider = PLATFORM_ANTHROPIC_USAGE_PROVIDER;
      try {
        const result = await doGenerate();
        const failure = failedFinishReason(result);
        if (!failure) return result;
        reportDirectError(failure);
        if (params.abortSignal?.aborted || !credential.fallbackGatewayApiKey) return result;
        recordReplacedDirectUsage(modelId, result.usage);
        return fallbackModel().doGenerate(params);
      } catch (error) {
        if (params.abortSignal?.aborted || !credential.fallbackGatewayApiKey) throw error;
        reportDirectError(error);
        return fallbackModel().doGenerate(params);
      }
    },
    wrapStream: async ({ doStream, params }) => {
      runtimeProvider.provider = PLATFORM_ANTHROPIC_USAGE_PROVIDER;
      return wrapAnthropicStreamWithFallback(
        doStream,
        () => fallbackModel().doStream(params),
        reportDirectError,
        () => Boolean(credential.fallbackGatewayApiKey),
        () => Boolean(params.abortSignal?.aborted),
      );
    },
  };
}

function createHypertaskGatewayAnthropicFirstMiddleware(
  modelSlug: string,
  gatewayApiKey: string,
  fundingSource: "managed" | "shared",
  runtimeProvider: { provider?: string },
): LanguageModelMiddleware {
  const directModelId = toDirectAnthropicModelId(modelSlug);
  const reportDirectError = (error: unknown) => {
    void reportAiFundingIncident({
      cause: "anthropic_error",
      reason: `Direct Anthropic call failed for ${modelSlug}; falling back to Vercel Gateway`,
      provider: "anthropic",
      fundingSource,
      errorClass: classifySafeProviderError(error),
      modelId: modelSlug,
    });
  };
  const tryDirect = async () => {
    const resolved = await resolveHypertaskAnthropicCredential({
      fallbackGatewayApiKey: gatewayApiKey,
      gatewayFundingSource: fundingSource,
      modelId: modelSlug,
    });
    if (resolved.route !== "hypertask-anthropic" || !isPlatformAnthropicCredential(resolved.credential)) {
      return null;
    }
    const directModel = createFundingAnthropicLanguageModel(
      directModelId,
      resolved.credential.apiKey,
    );
    return directModel as ReturnType<typeof wrapLanguageModel>;
  };
  return {
    specificationVersion: "v4",
    wrapGenerate: async ({ doGenerate, params }) => {
      const direct = await tryDirect();
      if (!direct) {
        runtimeProvider.provider = "gateway";
        return doGenerate();
      }
      runtimeProvider.provider = PLATFORM_ANTHROPIC_USAGE_PROVIDER;
      try {
        const result = await direct.doGenerate(params);
        const failure = failedFinishReason(result);
        if (!failure) return result;
        reportDirectError(failure);
        if (params.abortSignal?.aborted) return result;
        recordReplacedDirectUsage(directModelId, result.usage);
        runtimeProvider.provider = "gateway";
        return doGenerate();
      } catch (error) {
        if (params.abortSignal?.aborted) throw error;
        runtimeProvider.provider = "gateway";
        reportDirectError(error);
        return doGenerate();
      }
    },
    wrapStream: async ({ doStream, params }) => {
      const direct = await tryDirect();
      if (!direct) {
        runtimeProvider.provider = "gateway";
        return doStream();
      }
      runtimeProvider.provider = PLATFORM_ANTHROPIC_USAGE_PROVIDER;
      return wrapAnthropicStreamWithFallback(
        () => direct.doStream(params),
        () => {
          runtimeProvider.provider = "gateway";
          return doStream();
        },
        reportDirectError,
        () => true,
        () => Boolean(params.abortSignal?.aborted),
      );
    },
  };
}

function fundedAllowanceUsd(fundingSource: "managed" | "shared") {
  return fundingSource === "shared"
    ? FREE_TEAM_AI_ALLOWANCE_USD
    : PAID_TEAM_AI_ALLOWANCE_USD;
}

function fundedAllowanceMiddleware(
  fundingSource: "managed" | "shared",
  gatewayApiKey: string,
  modelSlug: string,
): LanguageModelMiddleware {
  return createSharedAllowanceMiddleware({
    allowanceUsd: fundedAllowanceUsd(fundingSource),
    fundingSource,
    resolvePolicy: async (teamId) => {
      const { resolveTeamAllowancePolicy } = await import("./planAllowancePolicy");
      return resolveTeamAllowancePolicy(teamId, fundingSource);
    },
    gatewayApiKey,
    modelSlug,
  });
}

function gatewayLanguageModel(
  modelSlug: string,
  gatewayApiKey: string,
  preferDirectAnthropic = true,
  enforceAllowance = true,
) {
  const catalogSlug = gatewayCatalogModelSlug(modelSlug);
  const model = createFundingGatewayLanguageModel(catalogSlug, gatewayApiKey);
  const fundingSource = gatewayFundingSourceForApiKey(gatewayApiKey);
  if (fundingSource === "customer") return model;
  const runtimeProvider: { provider?: string } = {};
  const middlewares: LanguageModelMiddleware[] = [];
  if (enforceAllowance) {
    middlewares.push(
      fundedAllowanceMiddleware(fundingSource, gatewayApiKey, modelSlug),
    );
  }
  if (preferDirectAnthropic && isAnthropicModelId(catalogSlug)) {
    middlewares.push(
      createHypertaskGatewayAnthropicFirstMiddleware(
        catalogSlug,
        gatewayApiKey,
        fundingSource,
        runtimeProvider,
      ),
    );
  }
  middlewares.push(
    createGatewayFailureReportingMiddleware(catalogSlug, fundingSource),
  );
  const funded = wrapLanguageModel({
    model: model as Parameters<typeof wrapLanguageModel>[0]["model"],
    providerId: "gateway",
    middleware: middlewares,
  });
  allowanceFundedModels.set(funded, fundedAllowanceUsd(fundingSource));
  runtimeProviderOverrides.set(funded, runtimeProvider);
  return funded;
}

function gatewayImageModel(modelSlug: string, gatewayApiKey: string) {
  const catalogSlug = gatewayCatalogModelSlug(modelSlug);
  const model = createFundingGatewayImageModel(catalogSlug, gatewayApiKey);
  const fundingSource = gatewayFundingSourceForApiKey(gatewayApiKey);
  return fundingSource !== "customer"
    ? wrapImageModel({
        model: model as Parameters<typeof wrapImageModel>[0]["model"],
        providerId: "gateway",
        middleware: [
          createImageAllowanceMiddleware({
            fundingSource,
            resolvePolicy: async (teamId) => {
              const { resolveTeamAllowancePolicy } = await import("./planAllowancePolicy");
              return resolveTeamAllowancePolicy(teamId, fundingSource);
            },
            allowanceUsd:
              fundingSource === "shared"
                ? FREE_TEAM_AI_ALLOWANCE_USD
                : PAID_TEAM_AI_ALLOWANCE_USD,
            gatewayApiKey,
            modelSlug,
          }),
          {
            specificationVersion: "v4",
            wrapGenerate: async ({ doGenerate, params }) => {
              try {
                return await doGenerate();
              } catch (error) {
                if (!params.abortSignal?.aborted && !sharedAiAllowanceErrorMessage(error)) {
                  void reportAiFundingIncident({
                    cause: classifyGatewayFailureCause(error),
                    reason: `Hypertask-paid Vercel Gateway (${fundingSource}) image generation failed for ${catalogSlug}`,
                    provider: "gateway",
                    fundingSource,
                    errorClass: classifySafeProviderError(error),
                    modelId: catalogSlug,
                  });
                }
                throw error;
              }
            },
          },
        ],
      })
    : model;
}

export function isAiGatewayEnabled() {
  const value = aiGatewayEnabledValue();
  if (value === "false") return false;
  if (value === "true" || value === "1" || value === "yes" || value === "on") {
    return true;
  }
  return Boolean(defaultGatewayApiKey());
}

function gatewayProviderSlug(provider: ModelProviderId) {
  switch (provider) {
    case "claude":
      return "anthropic";
    case "openai":
      return "openai";
    case "openrouter":
      return null;
    case "gateway":
      return null;
    case "custom":
      return null;
  }
}

function resolveUntracedAiModel(
  provider: ModelProviderId,
  modelId: string,
  byokCredential?: AiModelCredential,
  modelOption?: TAiModelOption,
  directProvider?: TAiProviderKey,
): LanguageModel {
  const model = modelId.trim();
  if (!model) {
    throw new Error("AI model id is required");
  }

  if (process.env.HT_PREMERGE_AI_STUB === "1" || process.env.HT_PREMERGE_QUEUE_STUB === "1") {
    const { createPremergeLanguageModel } = require("./premergeModel") as typeof import("./premergeModel");
    const stub = createPremergeLanguageModel(model);
    if (stub) return stub;
  }

  if (isPlatformAnthropicCredential(byokCredential)) {
    const directModelId = toDirectAnthropicModelId(model, modelOption);
    const directModel = createFundingAnthropicLanguageModel(
      directModelId,
      byokCredential.apiKey,
    );
    const runtimeProvider: { provider?: string } = {
      provider: PLATFORM_ANTHROPIC_USAGE_PROVIDER,
    };
    const fallbackGatewayKey = byokCredential.fallbackGatewayApiKey;
    const fundingSource = byokCredential.gatewayFundingSource;
    const middlewares: LanguageModelMiddleware[] = [];
    if (fallbackGatewayKey && fundingSource) {
      middlewares.push(
        fundedAllowanceMiddleware(
          fundingSource,
          fallbackGatewayKey,
          toGatewayAnthropicModelSlug(directModelId, modelOption),
        ),
      );
    }
    middlewares.push(
      createDirectAnthropicWithGatewayFallbackMiddleware(
        directModelId,
        byokCredential,
        runtimeProvider,
        modelOption,
      ),
    );
    const wrapped = wrapLanguageModel({
      model: directModel as Parameters<typeof wrapLanguageModel>[0]["model"],
      middleware: middlewares,
    });
    runtimeProviderOverrides.set(wrapped, runtimeProvider);
    if (fallbackGatewayKey && fundingSource) {
      allowanceFundedModels.set(wrapped, fundedAllowanceUsd(fundingSource));
    }
    return wrapped;
  }

  if (isBasetenCredential(byokCredential)) {
    const slug = BASETEN_MODEL_SLUGS[byokCredential.modelKey];
    if (!slug || modelOption?.modelKey !== byokCredential.modelKey || modelOption.model !== model) {
      throw new Error("Baseten credential does not match the selected model");
    }
    return createFundingOpenAiLanguageModel(slug, {
      apiKey: byokCredential.apiKey,
      baseURL: BASETEN_BYOK_PROVIDER.openAiCompatibleBaseUrl,
      useChat: true,
    });
  }

  const byokApiKey =
    typeof byokCredential === "string" ? byokCredential : undefined;

  if (provider === "gateway") {
    if (model === "deepseek/deepseek-v4.1-flash-1017-fast") {
      return resolveUntracedGatewayModel(model, byokApiKey);
    }
    const directApiKey = byokApiKey?.trim();
    if (directApiKey && !isVercelAiGatewayKey(directApiKey)) {
      const definition = modelOption
        ? getAiModelDefinition(modelOption.modelKey)
        : undefined;
      const definitionProvider =
        definition?.provider === "custom" ? undefined : definition?.provider;
      const providerInfo = getAiProviderInfo(
        definitionProvider ?? directProvider ?? "openai",
      );
      if (!providerInfo?.openAiCompatibleBaseUrl) {
        throw new Error(
          `Direct BYOK routing is not configured for "${modelOption?.modelKey ?? model}".`,
        );
      }

      const providerSeparator = model.indexOf("/");
      const directModel =
        modelOption?.directModel ??
        (providerSeparator >= 0 ? model.slice(providerSeparator + 1) : model);
      return createFundingOpenAiLanguageModel(directModel, {
        apiKey: directApiKey,
        baseURL: providerInfo.openAiCompatibleBaseUrl,
        useChat: true,
      });
    }
    return resolveUntracedGatewayModel(model, byokApiKey);
  }

  const directApiKey = byokApiKey?.trim() || undefined;
  const gatewaySlug = gatewayProviderSlug(provider);
  const gatewayModel = gatewaySlug ? `${gatewaySlug}/${model}` : model;

  if (isVercelAiGatewayKey(directApiKey)) {
    return gatewayLanguageModel(gatewayModel, directApiKey);
  }

  if (!directApiKey && gatewaySlug) {
    throw new AiGatewayKeyRequiredError(
      `A dedicated team AI Gateway key or direct BYOK key is required for ${provider} text inference.`,
    );
  }

  switch (provider) {
    case "claude":
      return createFundingAnthropicLanguageModel(model, directApiKey ?? "");
    case "openai":
      return createFundingOpenAiLanguageModel(model, {
        apiKey: directApiKey ?? "",
      });
    case "openrouter":
      return createFundingOpenRouterLanguageModel(model, directApiKey ?? "");
    case "custom": {
      if (!isCustomEndpointConfig(byokCredential)) {
        throw new Error("A complete custom endpoint is required");
      }
      const customEndpoint = normalizeCustomEndpointConfig(byokCredential);
      return createFundingOpenAiLanguageModel(customEndpoint.modelId, {
        apiKey: customEndpoint.apiKey,
        baseURL: customEndpoint.baseUrl,
        fetch: fetchWithoutBrotli,
        useChat: true,
      });
    }
  }
}

type ModelUsageContext = Partial<Pick<AiUsageRecord,
  "userId" | "teamId" | "projectId" | "taskId" | "agentId" | "feature" | "provider" | "promptId" | "promptVersion"
>> & {
  initiatingUserId?: number | null;
  trustedChatSessionId?: string | null;
  promptCachingEnabled?: Promise<boolean>;
  directPromptCachingEnabled?: Promise<boolean>;
  reasoningFeature?: string | null;
  reasoningEffort?: ReasoningEffort | null;
  userReasoning?: boolean;
};

const modelUsageContexts = new WeakMap<object, ModelUsageContext>();

function reasoningApi(): typeof import("@/app/api/ai/_lib/reasoningEffort") | null {
  try {
    const loaded = require("@/app/api/ai/_lib/reasoningEffort") as Partial<typeof import("@/app/api/ai/_lib/reasoningEffort")> | null;
    if (!loaded || typeof loaded.aiThinkingOptInEnabled !== "function" || typeof loaded.applyReasoningToParams !== "function") return null;
    return loaded as typeof import("@/app/api/ai/_lib/reasoningEffort");
  } catch {
    return null;
  }
}

export function configureAiModelUsage(model: LanguageModel, context: ModelUsageContext): void {
  if (typeof model === "string") return;
  const current = modelUsageContexts.get(model);
  if (current) Object.assign(current, Object.fromEntries(Object.entries(context).filter(([, value]) => value != null)));
}

export function inheritAiModelUsage(model: LanguageModel, source: LanguageModel): void {
  if (typeof model === "string" || typeof source === "string") return;
  const context = modelUsageContexts.get(source);
  if (!context) return;
  const current = modelUsageContexts.get(model);
  if (current) Object.assign(current, context);
  else modelUsageContexts.set(model, context);
}

export async function aiPromptCachingEnabled(model: LanguageModel): Promise<boolean> {
  if (typeof model === "string") return false;
  const context = modelUsageContexts.get(model);
  if (!context?.initiatingUserId) return false;
  if (model.provider === "anthropic.messages" && context.feature === "chat") {
    return context.directPromptCachingEnabled ??= import("@/lib/flags/definitions/htpr-7855-direct-prompt-cache")
      .then(({ HTPR_7855_DIRECT_PROMPT_CACHE_FLAG }) => import("@/lib/flags")
        .then(({ isFeatureEnabled }) => isFeatureEnabled(HTPR_7855_DIRECT_PROMPT_CACHE_FLAG, context.initiatingUserId!)))
      .catch(() => false);
  }
  if (model.provider !== "gateway") return false;
  return context.promptCachingEnabled ??= import("@/lib/flags/definitions/htpr-7689-prompt-caching")
    .then(({ HTPR_7689_PROMPT_CACHING_FLAG }) => import("@/lib/flags")
      .then(({ isFeatureEnabled }) => isFeatureEnabled(HTPR_7689_PROMPT_CACHING_FLAG, context.initiatingUserId!)))
    .catch(() => false);
}

function createPromptCachingMiddleware(model: LanguageModel, context: ModelUsageContext, enabled: () => Promise<boolean>): LanguageModelMiddleware {
  return {
    specificationVersion: "v4",
    transformParams: async ({ params }) => {
      if (typeof model !== "string" && model.provider === "anthropic.messages" && context.feature === "chat" && await enabled()) {
        const lastSystemIndex = params.prompt.findLastIndex((message) => message.role === "system");
        return {
          ...params,
          prompt: params.prompt.map((message, index) => index === lastSystemIndex
            ? {
              ...message,
              providerOptions: {
                ...message.providerOptions,
                anthropic: { ...message.providerOptions?.anthropic, cacheControl: { type: "ephemeral" } },
              },
            }
            : message),
        };
      }
      if (typeof model === "string" || model.provider !== "gateway" ||
        (!model.modelId.startsWith("anthropic/") && !model.modelId.startsWith("openai/")) ||
        !await enabled()) return params;
      if (model.modelId.startsWith("anthropic/")) {
        return {
          ...params,
          prompt: params.prompt.map((message) => {
            if (message.role !== "system" || !message.providerOptions?.anthropic?.cacheControl) return message;
            const { cacheControl: _cacheControl, ...anthropic } = message.providerOptions.anthropic;
            return { ...message, providerOptions: { ...message.providerOptions, anthropic } };
          }),
          providerOptions: {
            ...params.providerOptions,
            gateway: { ...params.providerOptions?.gateway, caching: "auto" },
          },
        };
      }
      const secret = process.env.BETTER_AUTH_SECRET;
      if (!context.trustedChatSessionId || !secret) return params;
      const namespace = context.teamId ? `team:${context.teamId}` : `user:${context.initiatingUserId}`;
      const promptCacheKey = createHmac("sha256", secret)
        .update(`htpr-7689:v1:${namespace}:${context.trustedChatSessionId}`)
        .digest("base64url").slice(0, 32);
      return {
        ...params,
        providerOptions: {
          ...params.providerOptions,
          openai: { ...params.providerOptions?.openai, promptCacheKey },
        },
      };
    },
  };
}

const FALLBACK_ANTHROPIC_RATES: Record<string, { inputUsdPerToken: number; outputUsdPerToken: number }> = {
  "claude-haiku": { inputUsdPerToken: 0.10 / 1_000_000, outputUsdPerToken: 0.50 / 1_000_000 },
  "claude-sonnet": { inputUsdPerToken: 3 / 1_000_000, outputUsdPerToken: 15 / 1_000_000 },
  "claude-opus": { inputUsdPerToken: 15 / 1_000_000, outputUsdPerToken: 75 / 1_000_000 },
};

function fallbackAnthropicPricing(modelId: string) {
  const normalized = modelId.toLowerCase();
  for (const [prefix, rates] of Object.entries(FALLBACK_ANTHROPIC_RATES)) {
    if (normalized.includes(prefix)) return rates;
  }
  return null;
}

async function generationCostUsd(modelId: string, provider: string, inputTokens: number, outputTokens: number, cacheReadTokens = 0, cacheWriteTokens = 0) {
  if (!inputTokens && !outputTokens) return 0;
  if (provider === "byok:custom" || provider === "byok:baseten") return null;
  const slug = modelId.includes("/") ? modelId : `${modelId.startsWith("claude-") ? "anthropic" : "openai"}/${modelId}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pricing = await Promise.race([
      modelPricing(slug),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 1500); }),
    ]);
    if (pricing) {
      return modelCostUsd(pricing, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens);
    }
  } catch {
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (provider === PLATFORM_ANTHROPIC_USAGE_PROVIDER) {
    const fallback = fallbackAnthropicPricing(modelId);
    if (fallback) {
      return modelCostUsd(fallback, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens);
    }
  }
  return null;
}

export function createUsageTracingMiddleware(
  context: ModelUsageContext,
  modelId: string,
  allowanceUsd?: number,
  runtimeProvider?: { provider?: string },
): LanguageModelMiddleware {
  const start = (prompt: unknown) => {
    const startedAt = performance.now();
    const attribution = { ...context };
    const identity = identifyPrompt(prompt);
    const traceId = randomUUID();
    let recorded = false;
    return (outcome: "ok" | "failed" | "cancelled", usage?: { inputTokens: { total?: number; cacheRead?: number; cacheWrite?: number }; outputTokens: { total?: number } }, error?: unknown) => {
      if (recorded) return;
      recorded = true;
      const inputTokens = usage?.inputTokens.total ?? 0;
      const outputTokens = usage?.outputTokens.total ?? 0;
      const cachedInputTokens = usage?.inputTokens.cacheRead ?? null;
      const cacheWriteInputTokens = usage?.inputTokens.cacheWrite ?? null;
      const effectiveProvider = runtimeProvider?.provider ?? attribution.provider ?? "unknown";
      const row: AiUsageRecord = {
        userId: attribution.userId ?? null,
        teamId: attribution.teamId,
        projectId: attribution.projectId,
        taskId: attribution.taskId,
        agentId: attribution.agentId,
        feature: attribution.feature ?? "unattributed",
        provider: effectiveProvider,
        model: modelId,
        promptId: attribution.promptId ?? identity.promptId,
        promptVersion: attribution.promptVersion ?? identity.promptVersion,
        traceId,
        outcome,
        inputTokens,
        outputTokens,
        cachedInputTokens,
        cacheWriteInputTokens,
        totalTokens: inputTokens + outputTokens,
        latencyMs: Math.min(2147483647, Math.max(0, Math.round(performance.now() - startedAt))),
      };
      const errorClass = outcome === "failed" && error ? classifySafeProviderError(error) : "none";
      const observation = (async () => {
        row.costUsd = await generationCostUsd(modelId, row.provider, inputTokens, outputTokens, cachedInputTokens ?? undefined, cacheWriteInputTokens ?? undefined);
        let allowanceSnapshot: Awaited<ReturnType<typeof teamAllowanceSnapshot>> = null;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          if (row.teamId && allowanceUsd !== undefined) {
            allowanceSnapshot = await Promise.race([
              teamAllowanceSnapshot(row.teamId, allowanceUsd),
              new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 1500); }),
            ]);
          }
        } finally {
          if (timer) clearTimeout(timer);
        }
        const authError = outcome === "failed" && attribution.feature === "chat" && row.provider === "byok:deepseek" && typeof attribution.userId === "number"
          ? await import("@/lib/ai/chatStream/errors").then(({ normalizeProviderAuthError }) => normalizeProviderAuthError(error, attribution.userId!)).catch(() => error)
          : error;
        await Promise.allSettled([
          logAiUsage(row),
          ...(row.provider === PLATFORM_ANTHROPIC_USAGE_PROVIDER && outcome === "ok"
            ? [recordAnthropicMonthlySpend(row.costUsd)]
            : []),
          recordAiChatTurn({
            ...row, traceId, latencyMs: row.latencyMs!, outcome,
            teamId: row.teamId,
            teamAllowanceUsd: allowanceSnapshot?.allowanceUsd ?? null,
            teamAllowanceUsedUsd: allowanceSnapshot?.usedUsd ?? null,
            error: outcome === "failed" ? "AI model generation failed" : undefined,
          }),
          ...(outcome === "failed" && !sharedAiAllowanceErrorMessage(error) && !(authError instanceof Error && authError.name === "AiProviderAuthenticationError") ? [reportError({
            message: "AI model generation failed",
            source: "server",
            fingerprintKey: `ai-generation:${errorClass}`,
            extra: { route: "modelProvider", stage: "inference", errorClass },
          })] : []),
        ]);
      })().catch(() => undefined);
      try { waitUntil(observation); } catch {}
    };
  };
  return {
    specificationVersion: "v4",
    transformParams: async ({ params }) => {
      const reasoning = reasoningApi();
      const optIn = reasoning
        ? context.userReasoning === true || await reasoning.aiThinkingOptInEnabled(context.userId)
        : false;
      if (!isHaiku55Model(modelId)) {
        return optIn && reasoning ? reasoning.applyReasoningToParams(params, context, modelId) : params;
      }
      const enabled = await import("@/app/api/ai/_lib/planGate")
        .then(({ haiku55ModelEnabled }) => haiku55ModelEnabled(context.userId))
        .catch(() => false);
      if (!enabled) throw new Error("This AI model is unavailable.");
      const { temperature: _temperature, topP: _topP, topK: _topK, ...supportedParams } = params;
      if (optIn && reasoning) return reasoning.applyReasoningToParams(supportedParams, context, modelId);
      const directOutput = params.responseFormat?.type === "json" ||
        (params.maxOutputTokens != null && params.maxOutputTokens <= 1200);
      return {
        ...supportedParams,
        providerOptions: {
          ...params.providerOptions,
          anthropic: {
            ...params.providerOptions?.anthropic,
            thinking: { type: directOutput ? "disabled" : "adaptive" },
            effort: directOutput ? "low" : "medium",
          },
          ...(directOutput && (context.provider === "byok:openrouter" || context.provider === "openrouter") ? {
            openrouter: {
              ...params.providerOptions?.openrouter,
              reasoning: { enabled: false },
            },
          } : {}),
        },
      };
    },
    wrapGenerate: async ({ doGenerate, params }) => {
      const record = start(params.prompt);
      try {
        const result = await doGenerate();
        record(result.finishReason.unified === "error" ? "failed" : "ok", result.usage);
        return result;
      } catch (error) {
        record(params.abortSignal?.aborted ? "cancelled" : "failed", undefined, error);
        throw error;
      }
    },
    wrapStream: async ({ doStream, params }) => {
      const record = start(params.prompt);
      try {
        const result = await doStream();
        const reader = result.stream.getReader();
        let failed = false;
        let streamError: unknown;
        return {
          ...result,
          stream: new ReadableStream({
            async pull(controller) {
              try {
                const item = await reader.read();
                if (item.done) {
                  record(params.abortSignal?.aborted ? "cancelled" : "failed", undefined, streamError);
                  controller.close();
                  return;
                }
                const chunk = item.value;
                if (chunk.type === "finish") record(failed || chunk.finishReason.unified === "error" ? "failed" : "ok", chunk.usage, streamError);
                if (chunk.type === "error") {
                  failed = true;
                  streamError = chunk.error;
                }
                controller.enqueue(chunk);
              } catch (error) {
                record(params.abortSignal?.aborted ? "cancelled" : "failed", undefined, error);
                controller.error(error);
              }
            },
            async cancel(reason) {
              record(failed ? "failed" : "cancelled", undefined, streamError);
              await reader.cancel(reason);
            },
          }),
        };
      } catch (error) {
        record(params.abortSignal?.aborted ? "cancelled" : "failed", undefined, error);
        throw error;
      }
    },
  };
}

function traceLanguageModel(
  model: LanguageModel,
  provider: string,
  replacement?: () => LanguageModel,
): LanguageModel {
  if (typeof model === "string") throw new Error("A resolved AI model is required");
  const context: ModelUsageContext = { provider };
  let traced = wrapLanguageModel({
    model,
    middleware: [
      createUsageTracingMiddleware(
        context,
        model.modelId,
        allowanceFundedModels.get(model),
        runtimeProviderOverrides.get(model),
      ),
      createPromptCachingMiddleware(model, context, () => aiPromptCachingEnabled(traced)),
    ],
  });
  if (replacement && isHaiku45Model(model.modelId)) {
    const upgradedModel = async () => {
      const enabled = await import("@/app/api/ai/_lib/planGate")
        .then(({ haiku55ModelEnabled }) => haiku55ModelEnabled(context.userId))
        .catch(() => false);
      if (!enabled) return null;
      const upgraded = replacement();
      configureAiModelUsage(upgraded, context);
      return upgraded as ReturnType<typeof wrapLanguageModel>;
    };
    traced = wrapLanguageModel({
      model: traced,
      middleware: {
        specificationVersion: "v4",
        wrapGenerate: async ({ doGenerate, params }) => {
          const upgraded = await upgradedModel();
          return upgraded ? upgraded.doGenerate(params) : doGenerate();
        },
        wrapStream: async ({ doStream, params }) => {
          const upgraded = await upgradedModel();
          return upgraded ? upgraded.doStream(params) : doStream();
        },
      },
    });
  }
  if (provider === PLATFORM_ANTHROPIC_USAGE_PROVIDER) {
    platformAnthropicFundedModels.add(traced);
  }
  modelUsageContexts.set(traced, context);
  return traced;
}

export function resolveAiModel(
  provider: ModelProviderId,
  modelId: string,
  byokCredential?: AiModelCredential,
  modelOption?: TAiModelOption,
  directProvider?: TAiProviderKey,
): LanguageModel {
  const persistedModelId = isCustomEndpointConfig(byokCredential) ? byokCredential.modelId : modelId;
  return traceLanguageModel(
    resolveUntracedAiModel(provider, modelId, byokCredential, modelOption, directProvider),
    aiUsageProviderForCredential(provider, byokCredential, modelOption, directProvider),
    isHaiku45Model(persistedModelId)
      ? () => resolveAiModel(
          provider,
          provider === "claude"
            ? isVercelAiGatewayKey(byokCredential) ? "claude-haiku-5.5" : "claude-haiku-5-5"
            : resolveHaikuModelId(modelId, true),
          isCustomEndpointConfig(byokCredential)
            ? { ...byokCredential, modelId: resolveHaikuModelId(persistedModelId, true) }
            : byokCredential,
          modelOption ? { ...modelOption, directModel: "claude-haiku-5-5" } : undefined,
          directProvider,
        )
      : undefined,
  );
}

export function resolveGatewayModel(modelSlug: string, gatewayApiKey?: string): LanguageModel {
  return traceLanguageModel(
    resolveUntracedGatewayModel(modelSlug, gatewayApiKey),
    "gateway",
    isHaiku45Model(modelSlug)
      ? () => resolveGatewayModel(resolveHaikuModelId(modelSlug, true), gatewayApiKey)
      : undefined,
  );
}

export function aiUsageProviderForCredential(
  provider: ModelProviderId,
  credential?: AiModelCredential,
  modelOption?: TAiModelOption,
  directProvider?: TAiProviderKey,
) {
  if (isPlatformAnthropicCredential(credential)) return PLATFORM_ANTHROPIC_USAGE_PROVIDER;
  if (isBasetenCredential(credential)) return "byok:baseten";
  if (isCustomEndpointConfig(credential)) return "byok:custom";
  if (typeof credential !== "string" || isVercelAiGatewayKey(credential)) {
    return provider;
  }

  const definition = modelOption
    ? getAiModelDefinition(modelOption.modelKey)
    : undefined;
  const definitionProvider =
    definition?.provider === "custom"
      ? undefined
      : (definition?.provider ?? directProvider);
  const providerInfo = definitionProvider
    ? getAiProviderInfo(definitionProvider)
    : undefined;
  return `byok:${providerInfo?.byokKey ?? provider}`;
}

function resolveUntracedGatewayModel(
  modelSlug: string,
  gatewayApiKey?: string,
): LanguageModel {
  if (process.env.HT_PREMERGE_AI_STUB === "1" || process.env.HT_PREMERGE_QUEUE_STUB === "1") {
    const { createPremergeLanguageModel } = require("./premergeModel") as typeof import("./premergeModel");
    const stub = createPremergeLanguageModel(modelSlug);
    if (stub) return stub;
  }

  const teamKey = isVercelAiGatewayKey(gatewayApiKey)
    ? gatewayApiKey?.trim()
    : undefined;
  if (teamKey) {
    return gatewayLanguageModel(modelSlug, teamKey);
  }

  throw new AiGatewayKeyRequiredError(
    `A dedicated team AI Gateway key is required to run "${modelSlug}".`,
  );
}

export function resolveGatewayImageModel(
  modelSlug: string,
  gatewayApiKey?: string,
): ImageModel {
  const teamKey = isVercelAiGatewayKey(gatewayApiKey)
    ? gatewayApiKey?.trim()
    : undefined;
  if (teamKey) {
    return gatewayImageModel(modelSlug, teamKey);
  }

  throw new AiGatewayKeyRequiredError(
    `A dedicated team AI Gateway key is required to run "${modelSlug}".`,
  );
}

export function gatewayProviderOptionsForModel(
  model: LanguageModel | ImageModel,
  feature: AiGatewayFeature,
  tags?: AiGatewayTags,
): GatewayTaggedProviderOptions | undefined {
  configureAiModelUsage(model as LanguageModel, { feature, ...tags });
  const gatewayRouted =
    typeof model !== "string" &&
    ((model as { provider?: unknown }).provider === "gateway" ||
      platformAnthropicFundedModels.has(model as object));
  if (!gatewayRouted) {
    return undefined;
  }

  const gatewayTags: string[] = [feature];
  const systemFeature = isSystemAiFeature(feature);
  if (systemFeature) gatewayTags.push(INCLUDED_WITH_HYPERTASK_GATEWAY_TAG);
  if (tags?.teamId) gatewayTags.push(`team:${tags.teamId}`);
  if (tags?.projectId != null) gatewayTags.push(`board:${tags.projectId}`);
  if (!systemFeature && tags?.userId != null) {
    gatewayTags.push(`user:${tags.userId}`);
  }

  return {
    gateway: {
      tags: gatewayTags,
    },
  };
}

export function mergeAiProviderOptions(
  ...providerOptions: Array<AiProviderOptions | undefined>
): AiProviderOptions | undefined {
  const merged: AiProviderOptions = {};

  for (const options of providerOptions) {
    if (!options) continue;
    for (const [provider, providerValues] of Object.entries(options)) {
      merged[provider] = {
        ...(merged[provider] ?? {}),
        ...providerValues,
      };
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function providerOptionsForAiModel(
  model: LanguageModel,
  feature: AiGatewayFeature,
  tags?: AiGatewayTags,
  modelOption?: TAiModelOption | null,
): AiProviderOptions | undefined {
  return mergeAiProviderOptions(
    gatewayProviderOptionsForModel(model, feature, tags),
    modelOption?.providerOptions,
  );
}
