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
  const model = createGateway({ apiKey: gatewayApiKey })(modelSlug);
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
  const model = createGateway({ apiKey: gatewayApiKey }).imageModel(modelSlug);
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
    throw new Error(
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

  throw new Error(
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

  throw new Error(
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

  return { gateway: { tags: gatewayTags } };
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
