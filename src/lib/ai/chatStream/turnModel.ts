import { HTPR_7730_DEEPSEEK_FLASH_FAST_FLAG, HTPR_7796_DISABLED_PROVIDER_PICK_FLAG, HTPR_7939_GROK_GEMINI4_MODELS_FLAG } from "@/lib/flags/keys";
import { ensureHtpr7038ModelReset } from "@/lib/ai/htpr7038ModelReset";
import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";

import { type LanguageModel } from "ai";
import { type AiProviderOptions, type AiModelCredential, type AiGatewayTags, isCustomEndpointConfig, isVercelAiGatewayKey } from "@/app/api/ai/_lib/modelProvider";
import { type TAiModelOption, type AiDefaultModelContext, preferredAiModelOption, getDefaultAiModelOptionForPlan, isLunaBlockedForPlan, getAiModelOptionById, getAiModelDefinition, isOpenAiOnlyPaidTeam, isGrokGemini4ModelKey } from "@/lib/aiModelOptions";
import type { StorePlanKind } from "@/lib/planFromStripePriceId";
import { resolveChatTeamContext, buildChatProviderContext } from "@/app/api/ai/_lib/chatTeamContext";
import { isAiFeatureEnabled } from "@/lib/systemModelLadder";
import { getAiProviderInfo, resolveTeamProviderEnabled } from "@/lib/aiProviders";
import { getAiModelPreferenceIds, type TAiModelPreferences, type TAiModelPreferenceSurface } from "@/lib/aiModelPreferences";
import { storePlanIdForProject, haiku55ModelEnabled, assertModelAllowedForPlan } from "@/app/api/ai/_lib/planGate";
import { resolveAiFallbackCredential, getAiDefaultModelContext, getByokOrTeamGatewayApiKeyForModelOption, getTeamGatewayApiKey, getByokOrTeamGatewayApiKeyForProvider } from "@/app/api/ai/_lib/byokKeys";
import { keyOnlyReplacementModelKey, resolveTeamAiFunding, TeamKeyOnlyRefusal } from "@/lib/ai/teamAiFunding";
import { resolveAgentModelPin } from "@/lib/nativeAgent/modelPin";
import { filterModelOptionForTeam } from "@/app/api/ai/_lib/providerGate";

import { createSseErrorResponse, reportHandledChatError, errorMessage } from "@/lib/ai/chatStream/errors";
import { ChatRequest } from "@/lib/ai/chatStream/request";
import { AuthedUser, ProviderId } from "@/lib/ai/chatStream/types";

import { loadActingAgent } from "@/lib/ai/tools/helpers";
import { resolveModelSelection, selectionFromModelOption, ModelSelection, defaultModelSelection, selectModel } from "@/lib/ai/chatStream/models";

function isBrowserLunaDefaultUnqualifiedHere(body: ChatRequest, serverContext: AiDefaultModelContext, plan: StorePlanKind | null | undefined) {
  if (body.modelFromDefault !== true) return false;
  if (getAiModelOptionById(body.modelOptionId ?? body.model, true)?.modelKey !== "gpt-6-luna") return false;
  return !isOpenAiOnlyPaidTeam({ ...serverContext, plan });
}

function isServerChosenDefaultTurn(body: ChatRequest, requested: { modelOptionId?: string | null; model?: string | null }) {
  return body.modelFromDefault === true && !requested.modelOptionId && !requested.model;
}

export async function loadTurnModel(body: ChatRequest, dbUser: AuthedUser) {

  let selected: {
    provider: ProviderId;
    usageProvider: string;
    modelId: string;
    resolvedModelId: string;
    model: LanguageModel;
    settings: { temperature?: number; maxOutputTokens?: number };
    providerOptions?: AiProviderOptions;
  };
  let titleByokApiKey: string | undefined;
  let streamCredential: AiModelCredential | undefined;
  let streamModelOption: TAiModelOption | undefined;
  const gatewayTags: AiGatewayTags = {
    teamId: null,
    projectId: null,
    userId: dbUser.id,
  };
  let usageProjectId: number | null = null;
  let actingAgent: Awaited<ReturnType<typeof loadActingAgent>> = null;
  let teamProviderSettings: unknown;
  let trustedChatSessionId: string | null = null;
  if (body.session_id) {
    const chatAgent = await prisma.chatSession.findFirst({
      where: { id: body.session_id, userId: dbUser.id },
      select: { agent: { select: { runtimeType: true } } },
    });
    if (chatAgent) trustedChatSessionId = body.session_id;
    if (chatAgent?.agent?.runtimeType === "EXTERNAL") {
      return NextResponse.json(
        { error: "External agents are chatted with from Agent Chat" },
        { status: 400 }
      );
    }
  }
  try {
    const requestedProjectId = body.default_context?.project_id;
    const chatTeamContext = await resolveChatTeamContext({
      userId: dbUser.id,
      requestedProjectId,
      requestedTeamId: body.teamId ?? undefined,
      sessionId: body.session_id,
    });
    const providerContext = buildChatProviderContext(
      dbUser.id,
      chatTeamContext,
      requestedProjectId,
      body.teamId ?? undefined,
    );
    if (!providerContext) {
      return createSseErrorResponse(
        "The requested board or team is unavailable.",
        403,
      );
    }
    const planGateProjectId = providerContext.planGateProjectId;
    teamProviderSettings = chatTeamContext?.aiProviderSettings;
    usageProjectId = chatTeamContext?.projectId ?? null;
    gatewayTags.projectId = usageProjectId;
    gatewayTags.teamId = chatTeamContext?.teamId ?? null;
    let keyLookupContext = providerContext.keyLookupContext;
    if (!isAiFeatureEnabled(body.aiFeature, teamProviderSettings)) {
      return createSseErrorResponse(
        "This AI feature is turned off for your team",
        403,
      );
    }
    await ensureHtpr7038ModelReset(dbUser.id);
    const userSetting = await prisma.userSetting.findUnique({
      where: { userId: dbUser.id },
      select: { aiModelPreferences: true },
    });
    const personalIds = getAiModelPreferenceIds(
      userSetting?.aiModelPreferences as
      | TAiModelPreferences
      | null
      | undefined,
      body.aiFeature as TAiModelPreferenceSurface,
      gatewayTags.teamId,
    );
    const personalModelOptionId =
      personalIds.teamScoped ?? personalIds.global ?? null;
    const storePlanId = await storePlanIdForProject(
      gatewayTags.teamId ? undefined : planGateProjectId,
      gatewayTags.teamId,
    );
    actingAgent = await loadActingAgent(body.session_id, dbUser.id);
    keyLookupContext = { ...keyLookupContext, agentId: actingAgent?.id ?? null };
    let hasEligibleByokCredential = false;
    if (storePlanId === "BYOK") {
      try {
        const credential = await getByokOrTeamGatewayApiKeyForModelOption(
          preferredAiModelOption,
          body.byokProviderFlags,
          keyLookupContext,
        );
        const sharedKey = process.env.AI_GATEWAY_API_KEY?.trim();
        hasEligibleByokCredential =
          (typeof credential === "string" &&
            credential.trim().length > 0 &&
            credential.trim() !== sharedKey) ||
          (credential !== null && typeof credential === "object");
      } catch (error) {
        if (!(typeof TeamKeyOnlyRefusal === "function" && error instanceof TeamKeyOnlyRefusal)) throw error;
      }
    }
    const deepseekFlashFastEnabled = await import("@/lib/flags")
      .then(({ isFeatureEnabled }) => isFeatureEnabled(HTPR_7730_DEEPSEEK_FLASH_FAST_FLAG, dbUser.id))
      .catch(() => false);
    const grokGemini4Enabled = await import("@/lib/flags")
      .then(({ isFeatureEnabled }) => isFeatureEnabled(HTPR_7939_GROK_GEMINI4_MODELS_FLAG, dbUser.id))
      .catch(() => false);
    const haiku55Enabled = await haiku55ModelEnabled?.(dbUser.id) ?? false;
    const defaultContext = haiku55Enabled
      ? await getAiDefaultModelContext(keyLookupContext, true, storePlanId, body.byokProviderFlags)
      : { hasByok: false, byok: undefined, haikuDefaultEnabled: false, backgroundClaudeEnabled: false };
    const requestDefaultModelOption = getDefaultAiModelOptionForPlan(
      storePlanId,
      haiku55Enabled ? defaultContext.hasByok : hasEligibleByokCredential,
      haiku55Enabled,
      defaultContext.haikuDefaultEnabled,
      defaultContext,
    );
    const requestedModel = isBrowserLunaDefaultUnqualifiedHere(body, defaultContext, storePlanId)
      ? { modelOptionId: null, model: null, provider: null }
      : body;
    const modelOptionIdForTurn = resolveAgentModelPin({
      requestedModelOptionId: requestedModel.modelOptionId,
      requestedModel: requestedModel.model,
      agentModelOptionId: isServerChosenDefaultTurn(body, requestedModel) ? null : actingAgent?.modelOptionId,
    });
    let selection = resolveModelSelection(
      requestedModel.provider,
      requestedModel.model,
      modelOptionIdForTurn,
      teamProviderSettings,
      body.aiFeature,
      personalModelOptionId,
      requestDefaultModelOption,
      haiku55Enabled,
      deepseekFlashFastEnabled,
    );
    if (body.modelFromDefault !== true && (requestedModel.modelOptionId || requestedModel.model)) {
      let provider = selection.modelOption
        ? getAiModelDefinition(selection.modelOption.modelKey)?.provider
        : undefined;
      if (!provider && selection.provider === "openrouter") provider = "openrouter";
      if (provider && provider !== "custom" && !resolveTeamProviderEnabled(teamProviderSettings, provider)) {
        const refuseDisabledPick = await import("@/lib/flags")
          .then(({ isFeatureEnabled }) => isFeatureEnabled(HTPR_7796_DISABLED_PROVIDER_PICK_FLAG, dbUser.id));
        if (refuseDisabledPick) {
          return createSseErrorResponse(
            `${getAiProviderInfo(provider)?.label ?? provider} is off for this team. Enable it in Settings > AI models > Providers.`,
            403,
          );
        }
      }
    }
    if (selection.modelOption) {
      selection = selectionFromModelOption(
        filterModelOptionForTeam(selection.modelOption, teamProviderSettings, haiku55Enabled, grokGemini4Enabled)
      );
    }
    if (!grokGemini4Enabled && isGrokGemini4ModelKey(selection.modelOption?.modelKey)) {
      selection = selectionFromModelOption(
        filterModelOptionForTeam(requestDefaultModelOption, teamProviderSettings, haiku55Enabled, grokGemini4Enabled),
      );
    }
    if (
      isLunaBlockedForPlan(
        selection.modelOption,
        storePlanId,
        hasEligibleByokCredential,
      )
    ) {
      selection = selectionFromModelOption(
        filterModelOptionForTeam(requestDefaultModelOption, teamProviderSettings, haiku55Enabled, grokGemini4Enabled),
      );
    }
    const keyOnlyDecision = gatewayTags.teamId && typeof resolveTeamAiFunding === "function"
      ? await resolveTeamAiFunding(gatewayTags.teamId, { provider: "claude", feature: "chat" })
      : { mode: "unrestricted" as const };
    const replacementModelKey = typeof keyOnlyReplacementModelKey === "function"
      ? keyOnlyReplacementModelKey(keyOnlyDecision, selection.provider, haiku55Enabled)
      : null;
    if (replacementModelKey) {
      const replacement = getAiModelOptionById(replacementModelKey, haiku55Enabled);
      if (replacement) selection = selectionFromModelOption(replacement);
    }
    let haikuByok = defaultContext.byok?.provider === "openrouter" &&
      !resolveTeamProviderEnabled(teamProviderSettings, "openrouter")
      ? undefined : defaultContext.byok;
    if (keyOnlyDecision.mode === "byok" && haikuByok?.provider !== "claude") haikuByok = undefined;
    const getSelectionApiKey = (
      selected: ModelSelection
    ) =>
      selected.modelOption?.modelKey === "claude-haiku-5-5" && haikuByok
        ? Promise.resolve(haikuByok.credential)
        : selected.modelOption
        ? getByokOrTeamGatewayApiKeyForModelOption(
          selected.modelOption,
          body.byokProviderFlags,
          keyLookupContext
        )
        : selected.provider === "gateway"
          ? getTeamGatewayApiKey(keyLookupContext)
          : getByokOrTeamGatewayApiKeyForProvider(
            selected.provider,
            body.byokProviderFlags,
            keyLookupContext,
            { resolveOpenRouterWithoutFlag: false }
          );
    let byokApiKey = await getSelectionApiKey(selection);

    if (
      selection.provider === "custom" &&
      !isCustomEndpointConfig(byokApiKey)
    ) {
      selection = defaultModelSelection(
        teamProviderSettings,
        body.aiFeature,
        personalModelOptionId,
        false,
        requestDefaultModelOption,
        haiku55Enabled,
        deepseekFlashFastEnabled,
      );
      byokApiKey = await resolveAiFallbackCredential(
        () => getSelectionApiKey(selection), new Error("This team's custom AI key is unavailable."),
      );
    }

    if (selection.provider === "openrouter") {
      if (isVercelAiGatewayKey(byokApiKey)) {
        selection = defaultModelSelection(
          teamProviderSettings,
          body.aiFeature,
          personalModelOptionId,
          true,
          requestDefaultModelOption,
          haiku55Enabled,
          deepseekFlashFastEnabled,
        );
      } else if (!byokApiKey) {
        selection = defaultModelSelection(
          teamProviderSettings,
          body.aiFeature,
          personalModelOptionId,
          true,
          requestDefaultModelOption,
          haiku55Enabled,
          deepseekFlashFastEnabled,
        );
        byokApiKey = await resolveAiFallbackCredential(
          () => getSelectionApiKey(selection), new Error("This team's OpenRouter key is unavailable."),
        );
      }
    }

    if (!grokGemini4Enabled && isGrokGemini4ModelKey(selection.modelOption?.modelKey)) {
      selection = selectionFromModelOption(
        filterModelOptionForTeam(requestDefaultModelOption, teamProviderSettings, haiku55Enabled, false),
      );
      byokApiKey = await getSelectionApiKey(selection);
    }

    if (selection.modelOption?.modelKey === "claude-haiku-5-5" && haikuByok?.provider === "openrouter") {
      selection = { ...selection, provider: "openrouter", model: "anthropic/claude-haiku-5.5" };
    }

    await assertModelAllowedForPlan(
      planGateProjectId,
      selection.modelOption,
      gatewayTags.teamId,
      byokApiKey,
    );

    if (selection.provider === "openai" && typeof byokApiKey === "string") {
      titleByokApiKey = byokApiKey;
    } else {
      try {
        titleByokApiKey = await getByokOrTeamGatewayApiKeyForProvider(
          "openai",
          body.byokProviderFlags,
          keyLookupContext,
          { resolveOpenRouterWithoutFlag: false }
        );
      } catch (error) {
        if (!(typeof TeamKeyOnlyRefusal === "function" && error instanceof TeamKeyOnlyRefusal)) throw error;
      }
    }
    streamCredential = byokApiKey;
    streamModelOption = selection.modelOption;
    const resolvedModel = selectModel(
      selection.provider,
      selection.model,
      byokApiKey,
      selection.modelOption,
      gatewayTags
    );
    selected = {
      ...resolvedModel,
      provider: selection.provider,
      modelId: resolvedModel.resolvedModelId,
    };
  } catch (error) {
    await reportHandledChatError(error, "select-model");
    return createSseErrorResponse(errorMessage(error));
  }
  return { selected, titleByokApiKey, streamCredential, streamModelOption, gatewayTags, usageProjectId, actingAgent, teamProviderSettings, trustedChatSessionId };
}
