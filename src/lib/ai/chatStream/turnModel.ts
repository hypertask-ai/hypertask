import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";

import { type LanguageModel } from "ai";
import { type AiProviderOptions, type AiModelCredential, type AiGatewayTags, isCustomEndpointConfig, isVercelAiGatewayKey } from "@/app/api/ai/_lib/modelProvider";
import { type TAiModelOption, preferredAiModelOption, getDefaultAiModelOptionForPlan, isLunaBlockedForPlan } from "@/lib/aiModelOptions";
import { resolveChatTeamContext, buildChatProviderContext } from "@/app/api/ai/_lib/chatTeamContext";
import { isAiFeatureEnabled } from "@/lib/systemModelLadder";
import { resolveTeamProviderEnabled } from "@/lib/aiProviders";
import { getAiModelPreferenceIds, type TAiModelPreferences, type TAiModelPreferenceSurface } from "@/lib/aiModelPreferences";
import { storePlanIdForProject, haiku55ModelEnabled, lunaFreePlanEnabled, assertModelAllowedForPlan } from "@/app/api/ai/_lib/planGate";
import { getAiDefaultModelContext, getByokOrTeamGatewayApiKeyForModelOption, getTeamGatewayApiKey, getByokOrTeamGatewayApiKeyForProvider } from "@/app/api/ai/_lib/byokKeys";
import { resolveAgentModelPin } from "@/lib/nativeAgent/modelPin";
import { filterModelOptionForTeam } from "@/app/api/ai/_lib/providerGate";

import { createSseErrorResponse, reportHandledChatError, errorMessage } from "@/lib/ai/chatStream/errors";
import { ChatRequest } from "@/lib/ai/chatStream/request";
import { AuthedUser, ProviderId } from "@/lib/ai/chatStream/types";

import { loadActingAgent } from "@/lib/ai/tools/helpers";
import { resolveModelSelection, selectionFromModelOption, ModelSelection, defaultModelSelection, selectModel } from "@/lib/ai/chatStream/models";

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
  // External agents are chatted with from Agent Chat, not this native stream.
  // Checked before any provider or model work so the turn never starts.
  if (body.session_id) {
    const chatAgent = await prisma.chatSession.findFirst({
      where: { id: body.session_id, userId: dbUser.id },
      select: { agent: { select: { runtimeType: true } } },
    });
    if (chatAgent?.agent?.runtimeType === "EXTERNAL") {
      return NextResponse.json(
        { error: "External agents are chatted with from Agent Chat" },
        { status: 400 }
      );
    }
  }
  try {
    const requestedProjectId = body.default_context?.project_id;
    // Global chat pages intentionally omit a board. Reuse the session's board
    // when possible, then fund an ordinary account chat from the strongest
    // team the user can access. This keeps every provider key lookup attributed.
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
    // Loaded here rather than alongside the skills below, because the model
    // this turn runs on depends on it and that is decided before the stream
    // opens. A failure surfaces through this block's catch as a stream error,
    // which is what we want: never silently fall back to the human's identity.
    actingAgent = await loadActingAgent(body.session_id, dbUser.id);
    // An agent with its own provider credential runs on that account, so the
    // key lookup has to know which agent is acting before it resolves a key
    // (HTPR-5389). Server-derived from the session, never request input.
    keyLookupContext = { ...keyLookupContext, agentId: actingAgent?.id ?? null };
    let hasEligibleByokCredential = false;
    if (storePlanId === "BYOK") {
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
    }
    const lunaFree = await lunaFreePlanEnabled(dbUser.id);
    const haiku55Enabled = await haiku55ModelEnabled?.(dbUser.id) ?? false;
    const defaultContext = haiku55Enabled
      ? await getAiDefaultModelContext(keyLookupContext, true, storePlanId)
      : { hasByok: false, byok: undefined };
    const requestDefaultModelOption = getDefaultAiModelOptionForPlan(
      storePlanId,
      haiku55Enabled ? defaultContext.hasByok : hasEligibleByokCredential,
      lunaFree,
      haiku55Enabled,
    );
    // An agent pinned to a model runs its own turns on it, which is the point
    // of pinning: a sweeper on a cheap model, a coordinator on an expensive
    // one. An explicit choice in the request still wins, so switching model
    // inside the agent's chat keeps working.
    const modelOptionIdForTurn = resolveAgentModelPin({
      requestedModelOptionId: body.modelOptionId,
      requestedModel: body.model,
      agentModelOptionId: actingAgent?.modelOptionId,
    });
    let selection = resolveModelSelection(
      body.provider,
      body.model,
      modelOptionIdForTurn,
      teamProviderSettings,
      body.aiFeature,
      personalModelOptionId,
      requestDefaultModelOption,
      haiku55Enabled,
    );
    if (selection.modelOption) {
      selection = selectionFromModelOption(
        filterModelOptionForTeam(selection.modelOption, teamProviderSettings, haiku55Enabled)
      );
    }
    if (
      isLunaBlockedForPlan(
        selection.modelOption,
        storePlanId,
        lunaFree,
        hasEligibleByokCredential,
      )
    ) {
      selection = selectionFromModelOption(
        filterModelOptionForTeam(requestDefaultModelOption, teamProviderSettings, haiku55Enabled),
      );
    }
    const haikuByok = defaultContext.byok?.provider === "openrouter" &&
      !resolveTeamProviderEnabled(teamProviderSettings, "openrouter")
      ? undefined : defaultContext.byok;
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
      );
      byokApiKey = await getSelectionApiKey(selection);
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
        );
      } else if (!byokApiKey) {
        selection = defaultModelSelection(
          teamProviderSettings,
          body.aiFeature,
          personalModelOptionId,
          true,
          requestDefaultModelOption,
      haiku55Enabled,
        );
        byokApiKey = await getSelectionApiKey(selection);
      }
    }

    if (selection.modelOption?.modelKey === "claude-haiku-5-5" && haikuByok?.provider === "openrouter") {
      selection = { ...selection, provider: "openrouter", model: "anthropic/claude-haiku-5.5" };
    }

    await assertModelAllowedForPlan(
      planGateProjectId,
      selection.modelOption,
      gatewayTags.teamId,
      byokApiKey,
      lunaFree,
    );

    titleByokApiKey =
      selection.provider === "openai" && typeof byokApiKey === "string"
        ? byokApiKey
        : await getByokOrTeamGatewayApiKeyForProvider(
          "openai",
          body.byokProviderFlags,
          keyLookupContext,
          { resolveOpenRouterWithoutFlag: false }
        );
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
  return { selected, titleByokApiKey, streamCredential, streamModelOption, gatewayTags, usageProjectId, actingAgent, teamProviderSettings };
}
