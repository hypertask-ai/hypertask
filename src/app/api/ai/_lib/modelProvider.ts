import { randomUUID } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { logAiUsage, type AiUsageRecord } from "./aiUsage";
import { identifyPrompt } from "@/lib/ai/prompts/registry";
import { recordAiChatTurn } from "@/lib/telemetry/aiChatObservability";
import { reportError } from "@/lib/errors/reportError";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  createGateway,
  wrapImageModel,
  wrapLanguageModel,
  type ImageModel,
  type LanguageModel,
  type LanguageModelMiddleware,
} from "ai";
import {
  createImageAllowanceMiddleware,
  createSharedAllowanceMiddleware,
  gatewayCatalogModelSlug,
  modelPricing,
  sharedAiAllowanceErrorMessage,
} from "@/app/api/ai/_lib/sharedAllowance";
import {
  getAiModelDefinition,
  type TAiModelOption,
  type TAiProviderOptions,
} from "@/lib/aiModelOptions";
import { getAiProviderInfo, type TAiProviderKey } from "@/lib/aiProviders";
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

export class AiGatewayKeyRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiGatewayKeyRequiredError";
  }
}

export { isCustomEndpointConfig };

export type ModelProviderId =
  "claude" | "openai" | "openrouter" | "gateway" | "custom";
export type AiModelCredential = string | CustomEndpointConfig;
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
  | "onboarding-board"
  | "status-update";

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

export type GatewayFundingSource = "customer" | "managed" | "shared";

const managedGatewayKeys = new Set<string>();

/**
 * Marks a decrypted key as platform-funded for this server process. Key
 * resolution always happens before model construction, so no secret or source
 * marker needs to travel through client input or provider metadata.
 */
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

function gatewayLanguageModel(modelSlug: string, gatewayApiKey: string) {
  const model = createGateway({ apiKey: gatewayApiKey })(
    gatewayCatalogModelSlug(modelSlug),
  );
  const fundingSource = gatewayFundingSourceForApiKey(gatewayApiKey);
  return fundingSource !== "customer"
    ? wrapLanguageModel({
        model,
        providerId: "gateway",
        middleware: createSharedAllowanceMiddleware({
          allowanceUsd:
            fundingSource === "shared"
              ? FREE_TEAM_AI_ALLOWANCE_USD
              : PAID_TEAM_AI_ALLOWANCE_USD,
          gatewayApiKey,
          modelSlug,
        }),
      })
    : model;
}

function gatewayImageModel(modelSlug: string, gatewayApiKey: string) {
  const model = createGateway({ apiKey: gatewayApiKey }).imageModel(
    gatewayCatalogModelSlug(modelSlug),
  );
  const fundingSource = gatewayFundingSourceForApiKey(gatewayApiKey);
  return fundingSource !== "customer"
    ? wrapImageModel({
        model,
        providerId: "gateway",
        middleware: createImageAllowanceMiddleware({
          allowanceUsd:
            fundingSource === "shared"
              ? FREE_TEAM_AI_ALLOWANCE_USD
              : PAID_TEAM_AI_ALLOWANCE_USD,
          gatewayApiKey,
          modelSlug,
        }),
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

export function isVercelAiGatewayKey(apiKey: unknown): apiKey is string {
  return typeof apiKey === "string" && apiKey.trim().startsWith("vck_");
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

  const byokApiKey =
    typeof byokCredential === "string" ? byokCredential : undefined;

  if (provider === "gateway") {
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
      return createOpenAI({
        apiKey: directApiKey,
        baseURL: providerInfo.openAiCompatibleBaseUrl,
      }).chat(directModel);
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
      return createAnthropic({ apiKey: directApiKey })(model);
    case "openai":
      return createOpenAI({ apiKey: directApiKey })(model);
    case "openrouter":
      return createOpenRouter({ apiKey: directApiKey })(model);
    case "custom": {
      if (!isCustomEndpointConfig(byokCredential)) {
        throw new Error("A complete custom endpoint is required");
      }
      const customEndpoint = normalizeCustomEndpointConfig(byokCredential);
      return createOpenAI({
        apiKey: customEndpoint.apiKey,
        baseURL: customEndpoint.baseUrl,
      }).chat(customEndpoint.modelId);
    }
  }
}

type ModelUsageContext = Partial<Pick<AiUsageRecord,
  "userId" | "teamId" | "projectId" | "taskId" | "agentId" | "feature" | "provider" | "promptId" | "promptVersion"
>>;

const modelUsageContexts = new WeakMap<object, ModelUsageContext>();

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

async function generationCostUsd(modelId: string, provider: string, inputTokens: number, outputTokens: number) {
  if (!inputTokens && !outputTokens) return 0;
  if (provider === "byok:custom") return null;
  const slug = modelId.includes("/") ? modelId : `${modelId.startsWith("claude-") ? "anthropic" : "openai"}/${modelId}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pricing = await Promise.race([
      modelPricing(slug),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 1500); }),
    ]);
    return pricing ? inputTokens * pricing.inputUsdPerToken + outputTokens * pricing.outputUsdPerToken : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createUsageTracingMiddleware(context: ModelUsageContext, modelId: string): LanguageModelMiddleware {
  const start = (prompt: unknown) => {
    const startedAt = performance.now();
    const attribution = { ...context };
    const identity = identifyPrompt(prompt);
    const traceId = randomUUID();
    let recorded = false;
    return (outcome: "ok" | "failed" | "cancelled", usage?: { inputTokens: { total?: number }; outputTokens: { total?: number } }, error?: unknown) => {
      if (recorded) return;
      recorded = true;
      const inputTokens = usage?.inputTokens.total ?? 0;
      const outputTokens = usage?.outputTokens.total ?? 0;
      const row: AiUsageRecord = {
        userId: attribution.userId ?? null,
        teamId: attribution.teamId,
        projectId: attribution.projectId,
        taskId: attribution.taskId,
        agentId: attribution.agentId,
        feature: attribution.feature ?? "unattributed",
        provider: attribution.provider ?? "unknown",
        model: modelId,
        promptId: attribution.promptId ?? identity.promptId,
        promptVersion: attribution.promptVersion ?? identity.promptVersion,
        traceId,
        outcome,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        latencyMs: Math.min(2147483647, Math.max(0, Math.round(performance.now() - startedAt))),
      };
      const failure = error && typeof error === "object"
        ? error as { name?: unknown; statusCode?: unknown }
        : undefined;
      const errorName = typeof failure?.name === "string" && /^[A-Za-z][A-Za-z0-9_]{0,80}$/.test(failure.name)
        ? failure.name : "ModelError";
      const statusCode = typeof failure?.statusCode === "number" && Number.isInteger(failure.statusCode) && failure.statusCode >= 100 && failure.statusCode <= 599
        ? failure.statusCode : null;
      const observation = (async () => {
        row.costUsd = await generationCostUsd(modelId, row.provider, inputTokens, outputTokens);
        await Promise.allSettled([
          logAiUsage(row),
          recordAiChatTurn({ ...row, traceId, latencyMs: row.latencyMs!, outcome, error: outcome === "failed" ? "AI model generation failed" : undefined }),
          ...(outcome === "failed" && !sharedAiAllowanceErrorMessage(error) ? [reportError({
            message: "AI model generation failed",
            source: "server",
            fingerprintKey: `ai-generation:${row.provider}:${modelId}:${errorName}:${statusCode}`,
            extra: { route: "modelProvider", stage: "inference", model: modelId, promptId: row.promptId!, errorName, statusCode },
          })] : []),
        ]);
      })().catch(() => undefined);
      try { waitUntil(observation); } catch { /* Non-Vercel runtimes keep the same best-effort telemetry. */ }
    };
  };
  return {
    specificationVersion: "v4",
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

function traceLanguageModel(model: LanguageModel, provider: string): LanguageModel {
  if (typeof model === "string") throw new Error("A resolved AI model is required");
  const context: ModelUsageContext = { provider };
  const traced = wrapLanguageModel({
    model,
    middleware: createUsageTracingMiddleware(context, model.modelId),
  });
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
  return traceLanguageModel(
    resolveUntracedAiModel(provider, modelId, byokCredential, modelOption, directProvider),
    aiUsageProviderForCredential(provider, byokCredential, modelOption, directProvider),
  );
}

export function resolveGatewayModel(modelSlug: string, gatewayApiKey?: string): LanguageModel {
  return traceLanguageModel(resolveUntracedGatewayModel(modelSlug, gatewayApiKey), "gateway");
}

export function aiUsageProviderForCredential(
  provider: ModelProviderId,
  credential?: AiModelCredential,
  modelOption?: TAiModelOption,
  directProvider?: TAiProviderKey,
) {
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

// The caller must supply the plan-aware credential resolved for the owning
// team. Free/BYOK teams deliberately supply the capped shared key; paid teams
// supply a capped managed key; customer BYOK remains outside either pool.
function resolveUntracedGatewayModel(
  modelSlug: string,
  gatewayApiKey?: string,
): LanguageModel {
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
  if (
    typeof model !== "string" &&
    (model as { provider?: unknown }).provider !== "gateway"
  ) {
    return undefined;
  }

  const gatewayTags: string[] = [feature];
  const systemFeature = isSystemAiFeature(feature);
  if (systemFeature) gatewayTags.push(INCLUDED_WITH_HYPERTASK_GATEWAY_TAG);
  if (tags?.teamId) gatewayTags.push(`team:${tags.teamId}`);
  if (tags?.projectId != null) gatewayTags.push(`board:${tags.projectId}`);
  // Automatic features belong to the team, not the member whose action
  // happened to trigger them. Keeping user tags off these calls prevents
  // included system spend from appearing in personal allowance bars.
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
