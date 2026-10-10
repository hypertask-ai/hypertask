import { loadTurnModel } from "@/lib/ai/chatStream/turnModel";
import { createChatStream } from "@/lib/ai/chatStream/stream";
import { NextRequest } from "next/server";
import { getAiRequestUser } from "@/app/api/ai/_lib/requestUser";
import { getCronServiceRequestUser } from "@/app/api/ai/_lib/cronServiceAuth";
import { decodeHeartbeatTurnMessage } from "@/lib/nativeAgent/heartbeatTurnEnvelope";
import prisma from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_6278_CHAT_TURN_FAILURE_FLAG, HTPR_7048_CTRLJ_CHAT_LEASE_FLAG } from "@/lib/flags/keys";
import { ensureNativeChatTurn, findNativeAssistantReplay } from "@/app/api/ai/chat/stream/ensureNativeChatTurn";
import { resolveAiUsageTaskId } from "@/app/api/ai/_lib/currentTaskContext";

import { randomUUID } from "node:crypto";
import { acquireAiChatStreamLease, releaseAiChatStreamLease } from "@/app/api/ai/chat/stream/streamLease";
import { startHeartbeatExecution } from "@/app/api/ai/_lib/heartbeatExecution";

import { createSseErrorResponse, requestErrorMessage, reportHandledChatError, errorMessage, sseFrame } from "@/lib/ai/chatStream/errors";
import { ChatRequest, chatRequestSchema } from "@/lib/ai/chatStream/request";
import { AuthedUser } from "@/lib/ai/chatStream/types";
import { SSE_HEADERS } from "@/lib/ai/tools/constants";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  // The platform time budget starts here, so the graceful deadline below must
  // count from here too, not from when the stream body starts.
  const turnStartedAtMs = Date.now();
  const requestUser =
    (await getAiRequestUser(request)) ??
    (await getCronServiceRequestUser(request));
  if (!requestUser?.id) {
    return createSseErrorResponse("Unauthorized", 401);
  }

  let body: ChatRequest;
  let json: unknown;
  try {
    json = await request.json();
  } catch (error) {
    return createSseErrorResponse(requestErrorMessage(error, "body"));
  }
  try {
    body = chatRequestSchema.parse(json);
  } catch (error) {
    return createSseErrorResponse(requestErrorMessage(error, "validation"));
  }

  const heartbeatExecutionId = request.headers.get(
    "x-hypertask-heartbeat-execution-id"
  );
  if (
    (heartbeatExecutionId || body.heartbeat_execution_id) &&
    heartbeatExecutionId !== body.heartbeat_execution_id
  ) {
    return createSseErrorResponse("Heartbeat execution identity mismatch", 409);
  }
  const heartbeatTurn = heartbeatExecutionId
    ? decodeHeartbeatTurnMessage(body.message)
    : null;
  if (heartbeatExecutionId) {
    const agentId = request.headers.get("x-hypertask-heartbeat-agent-id");
    const claimedAt = request.headers.get("x-hypertask-heartbeat-claimed-at");
    if (
      !heartbeatTurn ||
      heartbeatTurn.metadata.executionId !== heartbeatExecutionId ||
      heartbeatTurn.metadata.agentId !== agentId ||
      heartbeatTurn.metadata.claimedAt !== claimedAt ||
      heartbeatTurn.metadata.scanWatermark !== claimedAt
    ) {
      return createSseErrorResponse("Heartbeat turn marker mismatch", 409);
    }
  }
  const requestMessage = heartbeatTurn?.prompt ?? body.message;

  let dbUser: AuthedUser | null;
  try {
    dbUser = await prisma.user.findUnique({
      where: { id: requestUser.id },
      select: { id: true, email: true, displayName: true },
    });
  } catch (error) {
    await reportHandledChatError(error, "load-user");
    return createSseErrorResponse(errorMessage(error));
  }
  if (!dbUser) {
    return createSseErrorResponse("Unauthorized", 401);
  }

  // HTPR-6278: the platform kills this function at maxDuration with no
  // finally, so the turn ends with nothing persisted, no tool run, no error
  // report, and a stream lease that blocks the next turn for 30 more seconds.
  // Under the flag, end the turn gracefully just before that kill instead.
  // ponytail: phases that ignore the abort signal (a hung tool, a non-stream
  // DB call) can still run into the platform kill; the upgrade path is
  // per-phase timeouts at each trust boundary.
  const turnDeadlineEnabled = await isFeatureEnabled(
    HTPR_6278_CHAT_TURN_FAILURE_FLAG,
    dbUser.id,
  );

  let userMessagePersisted = false;
  if (body.session_id && body.user_message_id) {
    try {
      const nativeTurnPersistence = await ensureNativeChatTurn({
        db: prisma,
        sessionId: body.session_id,
        messageId: body.user_message_id,
        userId: dbUser.id,
        content: body.message,
      });
      if (nativeTurnPersistence === "conflict") {
        return createSseErrorResponse(
          "This chat could not be synchronized. Start a new chat and try again.",
          409,
        );
      }
      userMessagePersisted = true;
    } catch (error) {
      console.error(
        "[ai/chat/stream] native user-message persistence failed; local history remains authoritative",
        error,
      );
    }
  }

  if (body.session_id && body.assistant_message_id) {
    try {
      const replay = await findNativeAssistantReplay({
        db: prisma,
        sessionId: body.session_id,
        messageId: body.assistant_message_id,
        userId: dbUser.id,
      });
      if (replay.status === "conflict") {
        return createSseErrorResponse(
          "This chat could not be synchronized. Start a new chat and try again.",
          409,
        );
      }
      if (replay.status === "completed") {
        return new Response(
          sseFrame("content", { content: replay.content }) +
          sseFrame("done", {
            status: "complete",
            replayed: true,
            user_message_persisted: userMessagePersisted,
            assistant_persisted: true,
          }),
          { headers: SSE_HEADERS },
        );
      }
    } catch (error) {
      await reportHandledChatError(error, "native-replay-check");
      return createSseErrorResponse(
        "AI chat could not verify this request. Try again.",
        503,
      );
    }
  }

  // Best-effort: link the session to the board used for its first message. The
  // null guard makes the original board sticky if the composer scope changes.
  const contextProjectId = body.default_context?.project_id;
  if (body.session_id && typeof contextProjectId === "number") {
    try {
      await prisma.chatSession.updateMany({
        where: {
          id: body.session_id,
          userId: dbUser.id,
          projectId: null,
        },
        data: { projectId: contextProjectId },
      });
    } catch (error) {
      console.error("[ai/chat/stream] session projectId stamp failed:", error);
    }
  }

  // Best-effort: link the session to the ticket it was opened on (HTPR-4311). Never
  // blocks the chat request — a bad task_id just leaves the session unlinked.
  const contextTaskId = await resolveAiUsageTaskId({
    taskId: body.default_context?.task_id,
    projectId: body.default_context?.project_id,
    userId: dbUser.id,
  });
  if (body.session_id && contextTaskId !== null) {
    try {
      await prisma.chatSession.updateMany({
        where: {
          id: body.session_id,
          userId: dbUser.id,
          taskId: null,
        },
        data: { taskId: contextTaskId },
      });
    } catch (error) {
      console.error("[ai/chat/stream] session taskId stamp failed:", error);
    }
  }
  const turnModel = await loadTurnModel(body, dbUser);
  if (turnModel instanceof Response) return turnModel;
  const { selected, titleByokApiKey, streamCredential, streamModelOption, gatewayTags, usageProjectId, actingAgent, teamProviderSettings } = turnModel;

  // A retry reuses the assistant UUID for idempotent persistence, while each
  // network attempt gets its own cancellation identity. The server generates
  // one for older clients, which can stream safely but cannot issue exact Stop.
  const streamId = body.stream_id ?? randomUUID();
  // Always guard the agent across flag toggles; flag Off also guards its owner.
  // The agent identity is resolved from the owned session, never request input.
  const isolateAgentLease = !!actingAgent && await isFeatureEnabled(HTPR_7048_CTRLJ_CHAT_LEASE_FLAG, dbUser.id);
  const streamLease = await acquireAiChatStreamLease(
    dbUser.id,
    body.session_id ? { sessionId: body.session_id, streamId } : undefined,
    undefined,
    actingAgent?.id,
    isolateAgentLease,
  );
  if (streamLease === "busy") {
    return createSseErrorResponse(
      "Another AI reply is already in progress. Reopen that chat or wait for it to finish.",
      409,
    );
  }
  if (streamLease === "limited") {
    return createSseErrorResponse(
      "Too many AI replies were started recently. Please wait a minute and try again.",
      429,
    );
  }
  if (streamLease === "unavailable") {
    return createSseErrorResponse(
      "AI chat is temporarily unavailable. Please try again shortly.",
      503,
    );
  }

  let heartbeatExecutionTerminal = false;
  if (heartbeatExecutionId) {
    const agentId = request.headers.get("x-hypertask-heartbeat-agent-id");
    const claimedAt = request.headers.get("x-hypertask-heartbeat-claimed-at");
    if (
      !agentId ||
      !claimedAt ||
      !body.session_id ||
      !body.user_message_id ||
      !body.assistant_message_id
    ) {
      await releaseAiChatStreamLease(streamLease);
      return createSseErrorResponse("Incomplete heartbeat execution", 409);
    }
    try {
      await startHeartbeatExecution({
        executionId: heartbeatExecutionId,
        agentId,
        userId: dbUser.id,
        sessionId: body.session_id,
        userMessageId: body.user_message_id,
        assistantMessageId: body.assistant_message_id,
        claimedAt: new Date(claimedAt).toISOString(),
      });
    } catch (error) {
      await releaseAiChatStreamLease(streamLease);
      return createSseErrorResponse(errorMessage(error), 409);
    }
  }

  const firstTurn = !body.chat_history?.length;
  return createChatStream({ body, dbUser, requestMessage, heartbeatExecutionId, heartbeatTurn, turnDeadlineEnabled, userMessagePersisted, contextTaskId, selected, titleByokApiKey, streamCredential, streamModelOption, gatewayTags, usageProjectId, actingAgent, teamProviderSettings, streamId, streamLease, firstTurn, turnStartedAtMs, maxDuration, heartbeatExecutionTerminal });
}
