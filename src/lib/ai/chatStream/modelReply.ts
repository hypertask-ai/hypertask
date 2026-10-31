import { downloadWithoutBrotli } from "@/lib/net/downloadWithoutBrotli";
import { backgroundClaudeModelEnabled, haiku55ModelEnabled } from "@/app/api/ai/_lib/planGate";
import { resolveAiFallbackCredential, getByokOrTeamGatewayApiKeyForModelOption } from "@/app/api/ai/_lib/byokKeys";
import { resolveTeamAiFunding } from "@/lib/ai/teamAiFunding";
import { isVercelAiGatewayKey } from "@/app/api/ai/_lib/modelProvider";
import { getAiModelOptionById, isHaiku55Model, resolveHaikuModelId } from "@/lib/aiModelOptions";
import { resolveTeamProviderEnabled } from "@/lib/aiProviders";


import { type ModelMessage, type ToolSet, streamText, stepCountIs, generateText } from "ai";

import { failHeartbeatExecution } from "@/app/api/ai/_lib/heartbeatExecution";

import { configureAiModelUsage, inheritAiModelUsage } from "@/app/api/ai/_lib/modelProvider";
import { previousModelForFailedStream } from "@/app/api/ai/chat/stream/modelFallback";
import { hasVisibleCompletion, buildEmptyCompletionSummary } from "@/app/api/ai/chat/stream/bulkTools";
import { reportHandledChatError, errorMessage, userFacingErrorMessage, userFacingErrorDetails, reportEmptyCompletion, normalizeProviderAuthError } from "@/lib/ai/chatStream/errors";

import { ToolExecution } from "@/lib/ai/chatStream/types";
import { MAX_TOOL_STEPS } from "@/lib/ai/tools/constants";
import { deferredChatTools } from "@/lib/ai/tools/deferredTools";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7857_HEARTBEAT_STEP_CAP_FLAG, HTPR_7862_CHAT_DEFERRED_TOOLS_FLAG } from "@/lib/flags/keys";

import { selectModel } from "@/lib/ai/chatStream/models";

import { withHigherEffort } from "@/lib/ai/chatStream/content";
import { writeToolNames } from "@/lib/ai/tools/metadata";

import type { StreamState } from "./streamState";

export async function generateModelReply(state: StreamState, inputs: { instructions: string; messages: ModelMessage[]; tools: ToolSet; toolExecutions: ToolExecution[]; onContent?: (content: string) => void }) {
  const { dbUser, heartbeatExecutionId, contextTaskId, streamCredential, streamModelOption, gatewayTags, usageProjectId, actingAgent } = state;
  const { instructions, messages, tools, toolExecutions } = inputs;
  const heartbeatStepCapEnabled = Boolean(heartbeatExecutionId) &&
    await isFeatureEnabled(HTPR_7857_HEARTBEAT_STEP_CAP_FLAG, dbUser.id);
  const maxToolSteps = heartbeatStepCapEnabled ? 4 : MAX_TOOL_STEPS;
  let completedHeartbeatSteps = 0;
  const deferredToolsEnabled = await isFeatureEnabled(HTPR_7862_CHAT_DEFERRED_TOOLS_FLAG, dbUser.id);
  const toolDiscovery = deferredToolsEnabled ? deferredChatTools(tools) : { tools };
  const modelInstructions = deferredToolsEnabled
    ? `${instructions}\n\nOnly the listed tools are immediately available. For other actions, find the tool with hypertask_search_tools, then call hypertask_describe_tool with its exact name before calling it. Describing a tool does not execute the requested action.`
    : instructions;

  const handleModelError = async (error: unknown) => {
    error = await normalizeProviderAuthError(error, dbUser.id);
    state.recordTurnOutcome(state.cancelled ? "cancelled" : "failed", error);
    if (state.errorSent) return;
    state.errorSent = true;
    if (state.cancelled) {
      if (heartbeatExecutionId) {
        await failHeartbeatExecution(
          heartbeatExecutionId,
          "AI reply cancelled",
        );
        state.heartbeatExecutionTerminal = true;
      }
      state.finish("error", { cancelled: true, content: "Stream cancelled." });
      return;
    }
    if (state.turnDeadlineHit) {
      await state.endDeadlineTurn();
      return;
    }
    state.send("error", {
      content: userFacingErrorMessage(error, "model-stream"),
      toolsExecuted: toolExecutions.length > 0,
      ...userFacingErrorDetails(error, gatewayTags.teamId ?? null),
    });
    state.finish("error");
    if (heartbeatExecutionId) {
      await failHeartbeatExecution(
        heartbeatExecutionId,
        errorMessage(error)
      );
      state.heartbeatExecutionTerminal = true;
    }
    await reportHandledChatError(error, "model-stream", {
      model: state.selected.resolvedModelId,
      provider: state.selected.usageProvider,
    });
  };

  const haiku55Enabled = await haiku55ModelEnabled?.(dbUser.id) ?? false;
  const sameModelRetry = await backgroundClaudeModelEnabled?.(dbUser.id) ?? false;
  state.selected.resolvedModelId = resolveHaikuModelId(state.selected.resolvedModelId, haiku55Enabled);
  const chunks: string[] = [];
  let ranTools = false;
  let reachedStepLimit = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    ranTools = false;
    reachedStepLimit = false;
    let fallbackError: unknown;
    configureAiModelUsage(state.selected.model, {
      userId: dbUser.id,
      teamId: gatewayTags.teamId ?? null,
      projectId: usageProjectId,
      taskId: contextTaskId,
      agentId: actingAgent?.id ?? null,
      provider: state.selected.usageProvider,
      feature: "chat",
      reasoningFeature: heartbeatExecutionId ? "heartbeat" : "chat",
    });
    const result = streamText({
      model: state.selected.model,
      experimental_download: downloadWithoutBrotli,
      instructions: modelInstructions,
      messages,
      ...toolDiscovery,
      stopWhen: stepCountIs(maxToolSteps - completedHeartbeatSteps),
      onStepFinish: () => { if (heartbeatStepCapEnabled) completedHeartbeatSteps++; },
      maxRetries: 2,
      abortSignal: state.providerAbort.signal,
      onFinish: async ({ usage, finishReason, toolCalls, steps }) => {
        ranTools = toolCalls.length > 0;
        reachedStepLimit = steps.length >= maxToolSteps || completedHeartbeatSteps >= maxToolSteps;
        state.turnUsage = {
          inputTokens: usage.inputTokens ?? undefined,
          outputTokens: usage.outputTokens ?? undefined,
        };
        state.generationFinishedWithError = finishReason === "error";

      },
      onError: async ({ error }) => {
        if (
          attempt === 0 &&
          !state.cancelled &&
          !state.providerAbort.signal.aborted &&
          (sameModelRetry || !isHaiku55Model(state.selected.resolvedModelId) || resolveTeamProviderEnabled(state.teamProviderSettings, "openai")) &&
          previousModelForFailedStream(
            state.selected.resolvedModelId,
            error,
            chunks.length > 0,
            toolExecutions.length > 0,
            haiku55Enabled,
            sameModelRetry,
          )
        ) {
          fallbackError = error;
          return;
        }
        await handleModelError(error);
      },
      providerOptions: state.selected.providerOptions,
      ...state.selected.settings,
    });

    try {
      for await (const chunk of result.textStream) {
        if (state.errorSent || state.cancelled) break;
        if (!chunk) continue;
        chunks.push(chunk);
        inputs.onContent?.(chunk);
        state.send("content", { content: chunk });
      }
    } catch (error) {
      if (!fallbackError || attempt !== 0) throw error;
    }
    if (state.errorSent || state.cancelled) return;
    const previous = attempt === 0 && fallbackError
      ? previousModelForFailedStream(
        state.selected.resolvedModelId,
        fallbackError,
        chunks.length > 0,
        toolExecutions.length > 0,
        haiku55Enabled,
        sameModelRetry,
      )
      : null;
    if (!previous || completedHeartbeatSteps >= maxToolSteps) break;
    console.warn(
      `[ai-model-fallback] ${state.selected.resolvedModelId} -> ${previous.model}: ${previous.status}`,
    );
    if (previous.model === state.selected.resolvedModelId) continue;
    if (previous.model === "gpt-6-luna" && gatewayTags.teamId && typeof resolveTeamAiFunding === "function") {
      const keyOnlyChat = await resolveTeamAiFunding(gatewayTags.teamId, { provider: "openai", feature: "chat" });
      if (keyOnlyChat.mode !== "unrestricted") throw fallbackError;
    }
    const fallbackProvider = previous.model === "gpt-6-luna" ? "openai" : state.selected.provider;
    const fallbackLookup = { trustedTeamId: gatewayTags.teamId, projectId: usageProjectId, userId: dbUser.id, agentId: actingAgent?.id };
    const fallbackCredential = await resolveAiFallbackCredential(async () =>
      previous.model === "gpt-6-luna" && !isVercelAiGatewayKey(streamCredential)
        ? getByokOrTeamGatewayApiKeyForModelOption(
            getAiModelOptionById(previous.model)!, state.body.byokProviderFlags, fallbackLookup,
          )
        : streamCredential, fallbackError);
    const fallback = selectModel(
      fallbackProvider,
      previous.model,
      fallbackCredential,
      previous.model === "gpt-6-luna" ? getAiModelOptionById(previous.model)
        : streamModelOption ? { ...streamModelOption, directModel: undefined } : undefined,
      gatewayTags,
    );
    inheritAiModelUsage(fallback.model, state.selected.model);
    state.selected = {
      ...state.selected,
      ...fallback,
      provider: fallbackProvider,
      modelId: fallback.resolvedModelId,
    };
    state.observedModel = state.selected.resolvedModelId;
  }

  if (state.errorSent || state.cancelled) return;

  let emptyCompletionError: unknown;
  let emptyCompletionRetryFailed = false;
  if (!hasVisibleCompletion(chunks)) {
    if (!ranTools && !state.cancelled && !state.providerAbort.signal.aborted && completedHeartbeatSteps < maxToolSteps) {
      try {
        const retry = await generateText({
          model: state.selected.model,
          experimental_download: downloadWithoutBrotli,
          instructions: modelInstructions,
          messages,
          ...toolDiscovery,
          stopWhen: stepCountIs(maxToolSteps - completedHeartbeatSteps),
          onStepFinish: () => { if (heartbeatStepCapEnabled) completedHeartbeatSteps++; },
          maxRetries: 1,
          abortSignal: state.providerAbort.signal,
          providerOptions: withHigherEffort(state.selected.providerOptions),
          ...state.selected.settings,
        });
        reachedStepLimit =
          reachedStepLimit || retry.steps.length >= maxToolSteps || completedHeartbeatSteps >= maxToolSteps;
        state.turnUsage = {
          inputTokens:
            (state.turnUsage?.inputTokens ?? 0) + (retry.usage.inputTokens ?? 0),
          outputTokens:
            (state.turnUsage?.outputTokens ?? 0) + (retry.usage.outputTokens ?? 0),
        };

        const retryText = retry.text?.trim() ?? "";
        if (retryText) {
          state.generationFinishedWithError = retry.finishReason === "error";
          chunks.push(retryText);
          inputs.onContent?.(retryText);
          state.send("content", { content: retryText });
        }
      } catch (retryError) {
        const normalized = await normalizeProviderAuthError(retryError, dbUser.id);
        if (normalized instanceof Error && normalized.name === "AiProviderAuthenticationError") {
          await handleModelError(normalized);
          return;
        }
        emptyCompletionError = retryError;
        emptyCompletionRetryFailed = true;
        console.error(
          "[ai/chat/stream] empty-completion retry failed",
          retryError
        );
      }
    }
  }
  if (state.errorSent) return;
  const completedWithVisibleReply = hasVisibleCompletion(chunks);
  if (!completedWithVisibleReply) {
    await reportEmptyCompletion(
      emptyCompletionRetryFailed,
      emptyCompletionError
    );
    const fallback = buildEmptyCompletionSummary({
      toolExecutions,
      writeToolNames,
      reachedStepLimit,
      maxToolSteps,
      currentUserId: dbUser.id,
    });
    inputs.onContent?.(fallback);
    state.send("content", { content: fallback });
    chunks.push(fallback);
    state.recordTurnOutcome(
      "failed",
      emptyCompletionError ?? "AI generation returned no visible reply",
    );
  } else if (state.generationFinishedWithError) {
    state.recordTurnOutcome("failed", "AI generation finished with an error");
  } else {
    state.recordTurnOutcome("ok");
  }
  return { chunks, ticketRowsAllowed: completedWithVisibleReply && !state.generationFinishedWithError };
}
