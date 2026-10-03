

import prisma from "@/lib/prisma";

import { releaseAiChatStreamLease, createTurnDeadline, AI_CHAT_TURN_DEADLINE_RESERVE_SECONDS, isAiChatCancellationRequested, AI_CHAT_TURN_DEADLINE_USER_MESSAGE, AI_CHAT_TURN_DEADLINE_REASON, watchAiChatCancellation } from "@/app/api/ai/chat/stream/streamLease";
import { failHeartbeatExecution } from "@/app/api/ai/_lib/heartbeatExecution";
import { persistAssistantMessage } from "@/app/api/ai/chat/stream/persistAssistantMessage";
import { linkifyTicketRefs } from "@/utils/controllers/comments/linkifyTicketRefs";
import { type AiChatTurnOutcome, recordAiChatTurn } from "@/lib/telemetry/aiChatObservability";
import { waitUntil } from "@vercel/functions";
import { resolveSkillsForAiRequest } from "@/app/api/ai/_lib/chatSkillResolution";

import { reportHandledChatError, errorMessage, sseFrame, userFacingErrorMessage, userFacingErrorDetails } from "@/lib/ai/chatStream/errors";

import type { StreamState } from "./streamState";

import { routeAgentMention } from "./fleetTurn";
import { runModelTurn } from "./modelTurn";

export async function runChatStream(controller: ReadableStreamDefaultController<Uint8Array>, state: StreamState) {
  const { body, dbUser, requestMessage, heartbeatExecutionId, turnDeadlineEnabled, contextTaskId, gatewayTags, usageProjectId, actingAgent, streamId, streamLease, turnStartedAtMs, maxDuration, encoder } = state;

  state.doneSent = false;
  state.errorSent = false;
  state.cancelled = false;
  state.providerAbort = new AbortController();
  // Single winner: if user Stop already aborted the signal, the deadline
  // must not claim the termination.
  state.turnDeadlineHit = false;
  state.turnDeadline = turnDeadlineEnabled
    ? createTurnDeadline(
      (reason) => {
        if (state.providerAbort.signal.aborted) return;
        state.turnDeadlineHit = true;
        state.providerAbort.abort(reason);
      },
      // Remaining budget is computed here, at timer creation, so the
      // setup work between route entry and stream start is counted.
      maxDuration -
      AI_CHAT_TURN_DEADLINE_RESERVE_SECONDS -
      (Date.now() - turnStartedAtMs) / 1000,
    )
    : null;
  // Ends the turn when the graceful deadline fired: a real in-band error,
  // a heartbeat failure record, diagnostics, and a durable failure message
  // so reopening the chat shows why the turn ended instead of nothing.
  // Cleanup steps run concurrently — the 15-second reserve before the
  // platform kill cannot fit them sequentially.
  state.endDeadlineTurn = async () => {
    // A Stop recorded in Redis just before the deadline fired outranks it:
    // the turn was user-cancelled, not timed out (AI review finding).
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
        // Unreadable cancellation state: fall through to the deadline path.
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
    if (!state.clientConnected) return;
    try {
      controller.enqueue(encoder.encode(sseFrame(event, data)));
    } catch (error) {
      state.clientConnected = false;
      console.info(
        "[ai/chat/stream] client disconnected; completing in background",
        error,
      );
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

  // HTPR-6320: one turn = one PostHog AI observability generation. Declared
  // outside the try below so every exit path, including the catch and
  // finally, can name its outcome.
  // All of it is best effort and never changes what the user receives.
  state.generationStartedAt = Date.now();
  state.observedAgentId = actingAgent?.id ?? null;
  state.observedModel = state.selected.resolvedModelId;
  state.observedProvider = state.selected.usageProvider;

  state.generationFinishedWithError = false;
  state.turnOutcomeRecorded = false;
  state.recordTurnOutcome = (
    outcome: AiChatTurnOutcome,
    error?: unknown,
  ) => {
    if (state.turnOutcomeRecorded) return;
    state.turnOutcomeRecorded = true;
    const observation = recordAiChatTurn({
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
      error,
    }).catch((observationError) => {
      console.warn(
        "[ai/chat/stream] turn observation failed",
        observationError,
      );
    });
    try {
      waitUntil(observation);
    } catch (observationError) {
      console.warn(
        "[ai/chat/stream] turn observation could not outlive the request",
        observationError,
      );
    }
  };
  try {

    const skillResolution = await resolveSkillsForAiRequest(
      requestMessage,
      {
        userId: dbUser.id,
        projectId: body.default_context?.project_id,
      },
    );
    const resolvedBody = {
      ...body,
      // A message of only "/standup" strips to empty; fall back to the raw
      // message so retrieval and the model query are never blank. The skill
      // body in the system prompt still carries the intent.
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
    // The deadline abort lands here as an iterator error. Its own message,
    // persistence, heartbeat, and diagnostics already ran (or run here
    // once); the generic handler must not report the abort again.
    if (state.turnDeadlineHit) {
      if (!state.errorSent) {
        state.errorSent = true;
        await state.endDeadlineTurn();
      }
      return;
    }
    console.error("[ai/chat/stream] stream error", error);
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
    // Every model exit above names its outcome before reaching here. This
    // only covers a turn that ended before the model ever ran, and records
    // it only when cancellation gives it a real terminal outcome.
    if (state.cancelled) state.recordTurnOutcome("cancelled");
    state.turnDeadline?.clear();
    stopCancellationWatch();
    await releaseAiChatStreamLease(streamLease);
  }
}
