import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  createGateway,
  wrapImageModel,
  wrapLanguageModel,
  type ImageModel,
  type LanguageModel,
} from "ai";
import {
  createImageAllowanceMiddleware,
  createSharedAllowanceMiddleware,
  gatewayCatalogModelSlug,
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
};

export type GatewayTaggedProviderOptions = AiProviderOptions & {
  gateway: {
    tags: string[];
    models?: string[];
  };
};

// ponytail: grok-4.1-fast is Vertex-only on the live Gateway. Team keys
// that cannot use Vertex then have no provider and chat dies. grok-4.20
// still has native xAI. Drop this when 4.1 has an xAI endpoint again.
const GROK_FAST_GATEWAY_FALLBACKS: Record<string, string> = {
  "grok-4.1-fast-non-reasoning": "grok-4.20-non-reasoning",
  "grok-4.1-fast-reasoning": "grok-4.20-reasoning",
};

export function grokFastGatewayFallbackModels(
  modelSlug: string | undefined,
): string[] | undefined {
  if (!modelSlug) return undefined;
  const catalogSlug = gatewayCatalogModelSlug(modelSlug);
  const separator = catalogSlug.lastIndexOf("/");
  const name = separator >= 0 ? catalogSlug.slice(separator + 1) : catalogSlug;
  const fallbackName = GROK_FAST_GATEWAY_FALLBACKS[name];
  if (!fallbackName) return undefined;
  const prefix = separator >= 0 ? catalogSlug.slice(0, separator + 1) : "";
  return [catalogSlug, `${prefix}${fallbackName}`];
}

function languageModelId(model: LanguageModel | ImageModel | string): string | undefined {
  if (typeof model === "string") return model;
  const modelId = (model as { modelId?: unknown }).modelId;
  return typeof modelId === "string" ? modelId : undefined;
}

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

export function resolveAiModel(
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
    return resolveGatewayModel(model, byokApiKey);
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
export function resolveGatewayModel(
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

  const models = grokFastGatewayFallbackModels(languageModelId(model));
  return {
    gateway: {
      tags: gatewayTags,
      ...(models ? { models } : {}),
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
  const optionFallbacks = grokFastGatewayFallbackModels(modelOption?.model);
  return mergeAiProviderOptions(
    gatewayProviderOptionsForModel(model, feature, tags),
    optionFallbacks ? { gateway: { models: optionFallbacks } } : undefined,
    modelOption?.providerOptions,
  );
}
