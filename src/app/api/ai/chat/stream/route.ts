import { loadSidebarChatRequest } from "@/lib/agents/chatAccess";
import { loadTurnModel } from "@/lib/ai/chatStream/turnModel";
import { createChatStream } from "@/lib/ai/chatStream/stream";
import { NextRequest } from "next/server";
import { getAiRequestUser, getCliBearerChatUser } from "@/app/api/ai/_lib/requestUser";
import { getCronServiceRequestUser } from "@/app/api/ai/_lib/cronServiceAuth";
import { decodeHeartbeatTurnMessage } from "@/lib/nativeAgent/heartbeatTurnEnvelope";
import prisma from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7765_PARALLEL_CHATS_FLAG, HTPR_7048_CTRLJ_CHAT_LEASE_FLAG, HTPR_7316_CHAT_SCOPE_TICKET_FLAG } from "@/lib/flags/keys";
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
  const turnStartedAtMs = Date.now();
  const sessionOrServiceUser =
    (await getAiRequestUser(request)) ??
    (await getCronServiceRequestUser(request));
  const requestUser = sessionOrServiceUser ?? (await getCliBearerChatUser(request, "chat-stream"));
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

  const sidebarAccess = await loadSidebarChatRequest(request, body.session_id ?? "");
  if (!sidebarAccess.ok) return createSseErrorResponse(sidebarAccess.error, sidebarAccess.status);

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

  if (body.default_context?.scope === "ticket") {
    if (!await isFeatureEnabled(HTPR_7316_CHAT_SCOPE_TICKET_FLAG, dbUser.id)) {
      delete body.default_context.scope;
    }
  }
  const contextTaskId = await resolveAiUsageTaskId({
    taskId: body.default_context?.task_id,
    projectId: body.default_context?.project_id,
    userId: dbUser.id,
  });
  if (body.default_context?.scope === "ticket") {
    if (contextTaskId === null) {
      return createSseErrorResponse("Ticket not found or access denied", 403);
    }
    body.context_list = [];
    delete body.default_context.view_id;
    delete body.default_context.view_name;
  }

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
  const { selected, titleByokApiKey, streamCredential, streamModelOption, gatewayTags, usageProjectId, actingAgent, teamProviderSettings, trustedChatSessionId } = turnModel;

  const streamId = body.stream_id ?? randomUUID();
  const isolateAgentLease = !!actingAgent && await isFeatureEnabled(HTPR_7048_CTRLJ_CHAT_LEASE_FLAG, dbUser.id);
  const streamLease = await acquireAiChatStreamLease(
    dbUser.id,
    body.session_id ? { sessionId: body.session_id, streamId } : undefined,
    undefined,
    actingAgent?.id,
    isolateAgentLease,
    await isFeatureEnabled(HTPR_7765_PARALLEL_CHATS_FLAG, dbUser.id),
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
  return createChatStream({ body, dbUser, requestMessage, heartbeatExecutionId, heartbeatTurn, userMessagePersisted, contextTaskId, selected, titleByokApiKey, streamCredential, streamModelOption, gatewayTags, usageProjectId, actingAgent, teamProviderSettings, trustedChatSessionId, streamId, streamLease, firstTurn, turnStartedAtMs, maxDuration, heartbeatExecutionTerminal });
}
