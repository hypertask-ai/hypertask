

import prisma from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7794_STOP_CLOSES_STREAM_FLAG } from "@/lib/flags/definitions/htpr-7794-stop-closes-stream";

import { releaseAiChatStreamLease, createTurnDeadline, AI_CHAT_TURN_DEADLINE_RESERVE_SECONDS, isAiChatCancellationRequested, AI_CHAT_TURN_DEADLINE_USER_MESSAGE, AI_CHAT_TURN_DEADLINE_REASON, watchAiChatCancellation } from "@/app/api/ai/chat/stream/streamLease";
import { failHeartbeatExecution } from "@/app/api/ai/_lib/heartbeatExecution";
import { persistAssistantMessage } from "@/app/api/ai/chat/stream/persistAssistantMessage";
import { linkifyTicketRefs } from "@/utils/controllers/comments/linkifyTicketRefs";
import { type AiChatTurnOutcome, recordAiChatTurn } from "@/lib/telemetry/aiChatObservability";
import { waitUntil } from "@vercel/functions";
import { recordAiChatAlertSample } from "@/lib/ai/chatAlerts/service";
import { resolveSkillsForAiRequest } from "@/app/api/ai/_lib/chatSkillResolution";

import { reportHandledChatError, errorMessage, sseFrame, userFacingErrorMessage, userFacingErrorDetails, includedAllowanceError } from "@/lib/ai/chatStream/errors";

import type { StreamState } from "./streamState";

import { routeAgentMention } from "./fleetTurn";
import { runModelTurn } from "./modelTurn";

export async function runChatStream(controller: ReadableStreamDefaultController<Uint8Array>, state: StreamState) {
  const { body, dbUser, requestMessage, heartbeatExecutionId, contextTaskId, gatewayTags, usageProjectId, actingAgent, streamId, streamLease, turnStartedAtMs, maxDuration, encoder } = state;

  state.doneSent = false;
  state.errorSent = false;
  state.cancelled = false;
  state.providerAbort = new AbortController();
  state.turnDeadlineHit = false;
  state.turnDeadline = createTurnDeadline(
    (reason) => {
      if (state.providerAbort.signal.aborted) return;
      state.turnDeadlineHit = true;
      state.providerAbort.abort(reason);
    },
    maxDuration -
    AI_CHAT_TURN_DEADLINE_RESERVE_SECONDS -
    (Date.now() - turnStartedAtMs) / 1000,
  );
  state.endDeadlineTurn = async () => {
    if (body.session_id && streamId) {
      try {
        if (
          await isAiChatCancellationRequested(
            streamLease.redis,
            dbUser.id,
            body.session_id,
            streamId,
          )
        ) {
          state.finish("error", { cancelled: true, content: "Stream cancelled." });
          if (heartbeatExecutionId && !state.heartbeatExecutionTerminal) {
            await failHeartbeatExecution(
              heartbeatExecutionId,
              "AI reply cancelled",
            ).catch(() => undefined);
            state.heartbeatExecutionTerminal = true;
          }
          return;
        }
      } catch {
      }
    }
    state.send("error", { content: AI_CHAT_TURN_DEADLINE_USER_MESSAGE });
    state.finish("error");
    const steps: Array<[string, Promise<unknown>]> = [
      [
        "report",
        reportHandledChatError(
          new Error(AI_CHAT_TURN_DEADLINE_REASON),
          "turn-deadline",
        ),
      ],
    ];
    if (body.session_id && body.assistant_message_id) {
      steps.push([
        "persist-failure-state",
        persistAssistantMessage({
          db: prisma,
          messageId: body.assistant_message_id,
          sessionId: body.session_id,
          userId: dbUser.id,
          content: AI_CHAT_TURN_DEADLINE_USER_MESSAGE,
          linkify: linkifyTicketRefs,
        }),
      ]);
    }
    if (heartbeatExecutionId && !state.heartbeatExecutionTerminal) {
      steps.push([
        "heartbeat",
        failHeartbeatExecution(
          heartbeatExecutionId,
          AI_CHAT_TURN_DEADLINE_REASON,
        ),
      ]);
      state.heartbeatExecutionTerminal = true;
    }
    const outcomes = await Promise.allSettled(
      steps.map(([, promise]) => promise),
    );
    outcomes.forEach((outcome, index) => {
      if (outcome.status === "rejected") {
        console.error(
          `[ai/chat/stream] deadline cleanup (${steps[index][0]}) failed`,
          outcome.reason,
        );
      }
    });
  };
  const stopCancellationWatch = body.session_id && streamId
    ? watchAiChatCancellation(
      streamLease.redis,
      dbUser.id,
      body.session_id,
      streamId,
      () => {
        if (state.cancelled) return;
        state.cancelled = true;
        state.providerAbort.abort("User stopped this reply");
      },
    )
    : () => undefined;
  state.send = (event, data) => {
    if (!state.clientConnected) return false;
    try {
      controller.enqueue(encoder.encode(sseFrame(event, data)));
      return true;
    } catch (error) {
      state.clientConnected = false;
      console.info(
        "[ai/chat/stream] client disconnected; completing in background",
        error,
      );
      return false;
    }
  };
  state.finish = (
    status: "complete" | "error",
    data: Record<string, unknown> = {},
  ) => {
    if (state.doneSent) return;
    state.doneSent = true;
    state.send("done", { status, ...data });
    if (!state.clientConnected) return;
    try {
      controller.close();
    } catch {
      state.clientConnected = false;
    }
  };

  state.generationStartedAt = Date.now();
  state.observedAgentId = actingAgent?.id ?? null;
  state.observedModel = state.selected.resolvedModelId;
  state.observedProvider = state.selected.usageProvider;

  state.generationFinishedWithError = false;
  state.turnOutcomeRecorded = false;
  state.recordTurnOutcome = (
    outcome: AiChatTurnOutcome,
    _error?: unknown,
  ) => {
    if (state.turnOutcomeRecorded) return;
    state.turnOutcomeRecorded = true;
    const observation = recordAiChatTurn({
      event: "ai_chat_turn",
      userId: dbUser.id,
      projectId: usageProjectId,
      taskId: contextTaskId,
      agentId: state.observedAgentId,
      model: state.observedModel,
      provider: state.observedProvider,
      traceId: streamId,
      outcome,
      latencyMs: Date.now() - state.generationStartedAt,
      inputTokens: state.turnUsage?.inputTokens,
      outputTokens: state.turnUsage?.outputTokens,
      error: outcome === "failed" ? "AI chat turn failed" : undefined,
    }).catch((observationError) => {
      console.warn(
        "[ai/chat/stream] turn observation failed",
        observationError,
      );
    });
    const alertObservation = recordAiChatAlertSample({
      userId: dbUser.id,
      outcome,
      latencyMs: Date.now() - state.generationStartedAt,
    });
    try {
      waitUntil(observation);
      waitUntil(alertObservation);
    } catch (observationError) {
      console.warn(
        "[ai/chat/stream] turn observation could not outlive the request",
        observationError,
      );
    }
  };
  let stopClosesStream = false;
  try {
    stopClosesStream = await isFeatureEnabled(HTPR_7794_STOP_CLOSES_STREAM_FLAG, dbUser.id);
    const skillResolution = await resolveSkillsForAiRequest(
      requestMessage,
      {
        userId: dbUser.id,
        projectId: body.default_context?.project_id,
        agentId: actingAgent?.id ?? null,
        teamScope: actingAgent ? actingAgent.teamScope : null,
      },
    );
    const resolvedBody = {
      ...body,
      message: skillResolution.cleanedText || requestMessage,
    };
    if (await routeAgentMention(state, resolvedBody)) return;
    await runModelTurn(state, resolvedBody, skillResolution);
  } catch (error) {
    state.recordTurnOutcome(state.cancelled ? "cancelled" : "failed", error);
    if (state.cancelled) {
      if (!state.doneSent) {
        state.finish("error", { cancelled: true, content: "Stream cancelled." });
      }
      return;
    }
    if (state.turnDeadlineHit) {
      if (!state.errorSent) {
        state.errorSent = true;
        await state.endDeadlineTurn();
      }
      return;
    }
    if (!includedAllowanceError(error)) console.error("[ai/chat/stream] stream error", error);
    await reportHandledChatError(error, "stream-handler", {
      model: state.selected.resolvedModelId,
      provider: state.selected.usageProvider,
    });
    if (!state.errorSent) {
      state.errorSent = true;
      state.send("error", {
        content: userFacingErrorMessage(error, "stream-handler"),
        ...userFacingErrorDetails(error, gatewayTags.teamId ?? null),
      });
      state.finish("error");
    }
    if (heartbeatExecutionId && !state.heartbeatExecutionTerminal) {
      await failHeartbeatExecution(
        heartbeatExecutionId,
        errorMessage(error)
      ).catch(() => undefined);
      state.heartbeatExecutionTerminal = true;
    }
  } finally {
    if (state.cancelled) {
      if (stopClosesStream) state.finish("error", { cancelled: true, content: "Stream cancelled." });
      state.recordTurnOutcome("cancelled");
    }
    state.turnDeadline?.clear();
    stopCancellationWatch();
    await releaseAiChatStreamLease(streamLease);
  }
}
