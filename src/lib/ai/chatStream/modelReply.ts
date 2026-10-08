import { haiku55ModelEnabled } from "@/app/api/ai/_lib/planGate";
import { getByokOrTeamGatewayApiKeyForModelOption } from "@/app/api/ai/_lib/byokKeys";
import { isVercelAiGatewayKey } from "@/app/api/ai/_lib/modelProvider";
import { getAiModelOptionById, isHaiku55Model, resolveHaikuModelId } from "@/lib/aiModelOptions";
import { resolveTeamProviderEnabled } from "@/lib/aiProviders";


import { type ModelMessage, type ToolSet, streamText, stepCountIs, generateText } from "ai";

import { failHeartbeatExecution } from "@/app/api/ai/_lib/heartbeatExecution";

import { configureAiModelUsage } from "@/app/api/ai/_lib/modelProvider";
import { previousModelForFailedStream } from "@/app/api/ai/chat/stream/modelFallback";
import { hasVisibleCompletion, buildEmptyCompletionSummary } from "@/app/api/ai/chat/stream/bulkTools";
import { reportHandledChatError, errorMessage, userFacingErrorMessage, userFacingErrorDetails, reportEmptyCompletion } from "@/lib/ai/chatStream/errors";

import { ToolExecution } from "@/lib/ai/chatStream/types";
import { MAX_TOOL_STEPS } from "@/lib/ai/tools/constants";

import { selectModel } from "@/lib/ai/chatStream/models";

import { withHigherEffort } from "@/lib/ai/chatStream/content";
import { writeToolNames } from "@/lib/ai/tools/metadata";

import type { StreamState } from "./streamState";

export async function generateModelReply(state: StreamState, inputs: { instructions: string; messages: ModelMessage[]; tools: ToolSet; toolExecutions: ToolExecution[] }) {
  const { dbUser, heartbeatExecutionId, contextTaskId, streamCredential, streamModelOption, gatewayTags, usageProjectId, actingAgent } = state;
  const { instructions, messages, tools, toolExecutions } = inputs;

  const haiku55Enabled = await haiku55ModelEnabled?.(dbUser.id) ?? false;
  state.selected.resolvedModelId = resolveHaikuModelId(state.selected.resolvedModelId, haiku55Enabled);
  const chunks: string[] = [];
  let result!: ReturnType<typeof streamText>;
  for (let attempt = 0; attempt < 2; attempt++) {
    let fallbackError: unknown;
    configureAiModelUsage(state.selected.model, {
      userId: dbUser.id,
      teamId: gatewayTags.teamId ?? null,
      projectId: usageProjectId,
      taskId: contextTaskId,
      agentId: actingAgent?.id ?? null,
      provider: state.selected.usageProvider,
      feature: "chat",
    });
    result = streamText({
      model: state.selected.model,
      instructions,
      messages,
      tools,
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
      maxRetries: 2,
      abortSignal: state.providerAbort.signal,
      onFinish: async ({ usage, finishReason }) => {
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
          (!isHaiku55Model(state.selected.resolvedModelId) || resolveTeamProviderEnabled(state.teamProviderSettings, "openai")) &&
          previousModelForFailedStream(
            state.selected.resolvedModelId,
            error,
            chunks.length > 0,
            toolExecutions.length > 0,
            haiku55Enabled,
          )
        ) {
          fallbackError = error;
          return;
        }
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
        // This is the only path that can end the turn with no assistant
        // message ever persisted (every other exit reaches
        // persistAssistantMessage, even the empty-completion fallback).
        // A tool can execute before the model errors out, so callers
        // that infer "nothing happened" from an absent reply (the
        // native-agent heartbeat's retry logic) need this flag to avoid
        // re-sending the same instructions and replaying that write.
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
      },
      providerOptions: state.selected.providerOptions,
      ...state.selected.settings,
    });

    try {
      for await (const chunk of result.textStream) {
        if (state.errorSent || state.cancelled) break;
        if (!chunk) continue;
        chunks.push(chunk);
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
      )
      : null;
    if (!previous) break;
    console.warn(
      `[ai-model-fallback] ${state.selected.resolvedModelId} -> ${previous.model}: ${previous.status}`,
    );
    const fallbackProvider = previous.model === "gpt-6-luna" ? "openai" : state.selected.provider;
    const fallbackCredential = previous.model === "gpt-6-luna" && !isVercelAiGatewayKey(streamCredential)
      ? await getByokOrTeamGatewayApiKeyForModelOption(
          getAiModelOptionById(previous.model)!, state.body.byokProviderFlags,
          { trustedTeamId: gatewayTags.teamId, projectId: usageProjectId, userId: dbUser.id, agentId: actingAgent?.id },
        )
      : streamCredential;
    const fallback = selectModel(
      fallbackProvider,
      previous.model,
      fallbackCredential,
      previous.model === "gpt-6-luna" ? getAiModelOptionById(previous.model)
        : streamModelOption ? { ...streamModelOption, directModel: undefined } : undefined,
      gatewayTags,
    );
    state.selected = {
      ...state.selected,
      ...fallback,
      provider: fallbackProvider,
      modelId: fallback.resolvedModelId,
    };
    state.observedModel = state.selected.resolvedModelId;
  }

  if (state.errorSent || state.cancelled) return;

  // GPT-6.1 Sol (especially Instant / low effort) can return an empty completion
  // on a query it should answer. Retry once at higher effort, then fall back
  // to a clear message so the user never sees a blank reply. (HTPR-4007)
  //
  // SAFETY: only retry when the first attempt ran NO tools. If a tool already
  // executed (a write like create/update task may have side effects), re-running
  // the whole agentic loop could duplicate that action, so we skip straight to
  // the fallback instead.
  let emptyCompletionError: unknown;
  let emptyCompletionRetryFailed = false;
  let reachedStepLimit = false;
  if (!hasVisibleCompletion(chunks)) {
    const [toolCalls, steps] = await Promise.all([
      Promise.resolve(result.toolCalls).catch(() => []),
      Promise.resolve(result.steps).catch(() => []),
    ]);
    reachedStepLimit =
      Array.isArray(steps) && steps.length >= MAX_TOOL_STEPS;
    if (state.errorSent) return;
    const ranTools = Array.isArray(toolCalls) && toolCalls.length > 0;
    if (!ranTools && !state.cancelled && !state.providerAbort.signal.aborted) {
      try {
        const retry = await generateText({
          model: state.selected.model,
          instructions,
          messages,
          tools,
          stopWhen: stepCountIs(MAX_TOOL_STEPS),
          maxRetries: 1,
          abortSignal: state.providerAbort.signal,
          providerOptions: withHigherEffort(state.selected.providerOptions),
          ...state.selected.settings,
        });
        reachedStepLimit =
          reachedStepLimit || retry.steps.length >= MAX_TOOL_STEPS;
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
          state.send("content", { content: retryText });
        }
      } catch (retryError) {
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
  if (!hasVisibleCompletion(chunks)) {
    // Count only unrecovered empty completions. A successful retry is
    // invisible to the user and is not an incident worth ticketing.
    await reportEmptyCompletion(
      emptyCompletionRetryFailed,
      emptyCompletionError
    );
    const fallback = buildEmptyCompletionSummary({
      toolExecutions,
      writeToolNames,
      reachedStepLimit,
      maxToolSteps: MAX_TOOL_STEPS,
      currentUserId: dbUser.id,
    });
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
  return { chunks };
}
