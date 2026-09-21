import { AGENT_SYSTEM_PROMPT, MAX_TOOL_STEPS, ModelSelection, ProviderId, SSE_HEADERS, createSseErrorResponse, createUserContent, defaultModelSelection, generateConversationTitle, loadActingAgent, reportEmptyCompletion, reportHandledChatError, requestErrorMessage, resolveModelSelection, selectModel, selectionFromModelOption, sseFrame, userFacingErrorDetails, userFacingErrorMessage, withHigherEffort, writeToolNames } from "./chatStreamSupport";
import { AuthedUser, ChatRequest, SendSse, ToolExecution, buildTools, chatRequestSchema, errorMessage } from "./buildTools";
import { chatStore } from "@/utils/controllers/chat";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { generateText, stepCountIs, streamText, type LanguageModel, type ModelMessage } from "ai";
import prisma from "@/lib/prisma";
import { linkifyTicketRefs } from "@/utils/controllers/comments/linkifyTicketRefs";
import { persistAssistantMessage } from "./persistAssistantMessage";
import { decideAgentMentionRouting, extractMentionedAgentIds } from "./agentMention";
import { askFleetAgent } from "./fleetAsk";
import { ensureNativeChatTurn, findNativeAssistantReplay } from "./ensureNativeChatTurn";
import { acquireAiChatStreamLease, acquireAiChatCompletionFence, acquireAiChatToolFence, assertAiChatToolCanStart, createTurnDeadline, isAiChatCancellationRequested, AI_CHAT_TURN_DEADLINE_REASON, AI_CHAT_TURN_DEADLINE_RESERVE_SECONDS, AI_CHAT_TURN_DEADLINE_USER_MESSAGE, finishAiChatCompletionFence, keepAiChatCompletionFenceAlive, releaseAiChatStreamLease, releaseAiChatCompletionFence, watchAiChatCancellation } from "./streamLease";
import { completeHeartbeatExecution, failHeartbeatExecution, markHeartbeatMutationStarted, startHeartbeatExecution } from "@/app/api/ai/_lib/heartbeatExecution";
import { decodeHeartbeatTurnMessage } from "@/lib/nativeAgent/heartbeatTurnEnvelope";
import { resolveAgentModelPin } from "@/lib/nativeAgent/modelPin";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_6278_CHAT_TURN_FAILURE_FLAG } from "@/lib/flags/keys";
import { HTPR_6284_AGENT_MENTION_ROUTING_FLAG } from "@/lib/flags/keys";
import { HTPR_6320_AI_OBSERVABILITY_FLAG } from "@/lib/flags/keys";
import { recordAiChatTurn, type AiChatTurnOutcome } from "@/lib/telemetry/aiChatObservability";
import { logAiUsage } from "@/app/api/ai/_lib/aiUsage";
import { loadCurrentTaskContext, resolveAiUsageTaskId } from "@/app/api/ai/_lib/currentTaskContext";
import { buildChatProviderContext, resolveChatTeamContext } from "@/app/api/ai/_lib/chatTeamContext";
import { getByokOrTeamGatewayApiKeyForProvider, getByokOrTeamGatewayApiKeyForModelOption, getTeamGatewayApiKey } from "@/app/api/ai/_lib/byokKeys";
import { isCustomEndpointConfig, isVercelAiGatewayKey, type AiGatewayTags, type AiProviderOptions } from "@/app/api/ai/_lib/modelProvider";
import { getDefaultAiModelOptionForPlan, preferredAiModelOption } from "@/lib/aiModelOptions";
import { filterModelOptionForTeam } from "@/app/api/ai/_lib/providerGate";
import { resolveSkillsForAiRequest } from "@/app/api/ai/_lib/chatSkillResolution";
import { getAiRequestUser } from "@/app/api/ai/_lib/requestUser";
import { getCronServiceRequestUser } from "@/app/api/ai/_lib/cronServiceAuth";
import { assertModelAllowedForPlan, storePlanIdForProject } from "@/app/api/ai/_lib/planGate";
import { getAccessibleAgentBoard, getBoardAgentMembers } from "@/utils/controllers/agents/boardMembers";
import { escapeHtml } from "@/utils/helperFunctions/escapeHtml";
import { isAiFeatureEnabled } from "@/lib/systemModelLadder";
import { getAiModelPreferenceIds, type TAiModelPreferenceSurface, type TAiModelPreferences } from "@/lib/aiModelPreferences";
import { buildEmptyCompletionSummary, hasVisibleCompletion } from "./bulkTools";

const maxDuration = 300;

export async function POST(request: NextRequest) {
  // The platform time budget starts here, so the graceful deadline below must
  // count from here too, not from when the stream body starts.
  const turnStartedAtMs = Date.now();
  const requestUser =
    (await getAiRequestUser(request)) ??
    (await getCronServiceRequestUser(request));
  if (!requestUser?.id) {
    return createSseErrorResponse("Unauthorized");
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
    return createSseErrorResponse("Unauthorized");
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
  // HTPR-6320: one flag read per turn decides whether this turn is recorded in
  // PostHog AI observability.
  const aiObservabilityEnabled = await isFeatureEnabled(
    HTPR_6320_AI_OBSERVABILITY_FLAG,
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
      await chatStore().sessions.updateMany({
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
      await chatStore().sessions.updateMany({
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
  const gatewayTags: AiGatewayTags = {
    teamId: null,
    projectId: null,
    userId: dbUser.id,
  };
  let usageProjectId: number | null = null;
  let actingAgent: Awaited<ReturnType<typeof loadActingAgent>> = null;
  // External agents are chatted with from Agent Chat, not this native stream.
  // Checked before any provider or model work so the turn never starts.
  if (body.session_id) {
    const chatAgent = await chatStore().sessions.findFirst({
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
    const teamProviderSettings = chatTeamContext?.aiProviderSettings;
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
    const requestDefaultModelOption = getDefaultAiModelOptionForPlan(
      storePlanId,
      hasEligibleByokCredential,
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
    );
    if (selection.modelOption) {
      selection = selectionFromModelOption(
        filterModelOptionForTeam(selection.modelOption, teamProviderSettings)
      );
    }
    const getSelectionApiKey = (
      selected: ModelSelection
    ) =>
      selected.modelOption
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
        );
      } else if (!byokApiKey) {
        selection = defaultModelSelection(
          teamProviderSettings,
          body.aiFeature,
          personalModelOptionId,
          true,
          requestDefaultModelOption,
        );
        byokApiKey = await getSelectionApiKey(selection);
      }
    }

    await assertModelAllowedForPlan(
      planGateProjectId,
      selection.modelOption,
      gatewayTags.teamId,
      byokApiKey,
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

  // A retry reuses the assistant UUID for idempotent persistence, while each
  // network attempt gets its own cancellation identity. The server generates
  // one for older clients, which can stream safely but cannot issue exact Stop.
  const streamId = body.stream_id ?? randomUUID();
  const streamLease = await acquireAiChatStreamLease(
    dbUser.id,
    body.session_id ? { sessionId: body.session_id, streamId } : undefined,
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
  const encoder = new TextEncoder();
  let clientConnected = true;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let doneSent = false;
      let errorSent = false;
      let cancelled = false;
      const providerAbort = new AbortController();
      // Single winner: if user Stop already aborted the signal, the deadline
      // must not claim the termination.
      let turnDeadlineHit = false;
      const turnDeadline = turnDeadlineEnabled
        ? createTurnDeadline(
            (reason) => {
              if (providerAbort.signal.aborted) return;
              turnDeadlineHit = true;
              providerAbort.abort(reason);
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
      const endDeadlineTurn = async () => {
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
              finish("error", { cancelled: true, content: "Stream cancelled." });
              if (heartbeatExecutionId && !heartbeatExecutionTerminal) {
                await failHeartbeatExecution(
                  heartbeatExecutionId,
                  "AI reply cancelled",
                ).catch(() => undefined);
                heartbeatExecutionTerminal = true;
              }
              return;
            }
          } catch {
            // Unreadable cancellation state: fall through to the deadline path.
          }
        }
        send("error", { content: AI_CHAT_TURN_DEADLINE_USER_MESSAGE });
        finish("error");
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
        if (heartbeatExecutionId && !heartbeatExecutionTerminal) {
          steps.push([
            "heartbeat",
            failHeartbeatExecution(
              heartbeatExecutionId,
              AI_CHAT_TURN_DEADLINE_REASON,
            ),
          ]);
          heartbeatExecutionTerminal = true;
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
              if (cancelled) return;
              cancelled = true;
              providerAbort.abort("User stopped this reply");
            },
          )
        : () => undefined;
      const send: SendSse = (event, data) => {
        if (!clientConnected) return;
        try {
          controller.enqueue(encoder.encode(sseFrame(event, data)));
        } catch (error) {
          clientConnected = false;
          console.info(
            "[ai/chat/stream] client disconnected; completing in background",
            error,
          );
        }
      };
      const finish = (
        status: "complete" | "error",
        data: Record<string, unknown> = {},
      ) => {
        if (doneSent) return;
        doneSent = true;
        send("done", { status, ...data });
        if (!clientConnected) return;
        try {
          controller.close();
        } catch {
          clientConnected = false;
        }
      };

      // HTPR-6320: one turn = one PostHog AI observability generation. Declared
      // outside the try below so every exit path, including the catch and
      // finally, can name its outcome.
      // All of it is best effort and never changes what the user receives.
      let generationStartedAt = Date.now();
      let observedAgentId = actingAgent?.id ?? null;
      let observedModel = selected.resolvedModelId;
      let observedProvider = selected.usageProvider;
      let turnUsage: { inputTokens?: number; outputTokens?: number } | undefined;
      let generationFinishedWithError = false;
      let turnOutcomeRecorded = false;
      const recordTurnOutcome = (
        outcome: AiChatTurnOutcome,
        error?: unknown,
      ) => {
        if (!aiObservabilityEnabled || turnOutcomeRecorded) return;
        turnOutcomeRecorded = true;
        const observation = recordAiChatTurn({
          userId: dbUser.id,
          projectId: usageProjectId,
          taskId: contextTaskId,
          agentId: observedAgentId,
          model: observedModel,
          provider: observedProvider,
          traceId: streamId,
          outcome,
          latencyMs: Date.now() - generationStartedAt,
          inputTokens: turnUsage?.inputTokens,
          outputTokens: turnUsage?.outputTokens,
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
          body.aiFeature,
          (error) => reportHandledChatError(error, "skills-feature-flag"),
        );
        const resolvedBody = {
          ...body,
          // A message of only "/standup" strips to empty; fall back to the raw
          // message so retrieval and the model query are never blank. The skill
          // body in the system prompt still carries the intent.
          message: skillResolution.cleanedText || requestMessage,
        };

        // HTPR-6284: a single @<agent> mention routes the whole turn to that
        // fleet agent and the assistant model loop below is skipped. Anything
        // else — no or several mentions, attachments, no board context, a
        // native agent's own session, the flag off — falls through unchanged.
        const mentionDecision = decideAgentMentionRouting({
          routingEnabled: await isFeatureEnabled(
            HTPR_6284_AGENT_MENTION_ROUTING_FLAG,
            dbUser.id,
          ),
          mentionedAgentIds: extractMentionedAgentIds(resolvedBody.context_list),
          hasAttachments:
            (resolvedBody.attachments?.length ?? 0) > 0 ||
            (resolvedBody.images64?.length ?? 0) > 0 ||
            (resolvedBody.pdfs64?.length ?? 0) > 0 ||
            (resolvedBody.docx64?.length ?? 0) > 0,
          hasBoardContext:
            Number.isInteger(body.default_context?.project_id) &&
            Number(body.default_context?.project_id) > 0,
          hasActingAgent: Boolean(actingAgent),
        });

        if (mentionDecision.route) {
          const routedBoardId = Number(body.default_context?.project_id);
          let routedAgent: { id: string; displayName: string } | null = null;
          // Same proven-access rule the hypertask_ask_agent tool applies: the
          // board comes from the client, so the caller's access is proven
          // before its agents are reachable.
          if (await getAccessibleAgentBoard(routedBoardId, dbUser.id)) {
            const boardAgents = await getBoardAgentMembers(
              routedBoardId,
              dbUser.id,
            );
            const memberRow = boardAgents.find(
              (candidate) => candidate.agent.id === mentionDecision.agentId,
            );
            // getBoardAgentMembers already filters revoked, archived and
            // invisible agents, so a found row is an active visible agent.
            if (memberRow) {
              routedAgent = {
                id: memberRow.agent.id,
                displayName: memberRow.agent.displayName,
              };
            }
          }

          if (routedAgent) {
            send("status", {
              content: `Asking ${routedAgent.displayName}...`,
            });
            generationStartedAt = Date.now();
            observedAgentId = routedAgent.id;
            observedModel = "fleet-agent";
            observedProvider = "hypertask";
            const fleet = await askFleetAgent({
              agentId: routedAgent.id,
              question: resolvedBody.message,
              context: {
                boardId: routedBoardId,
                taskId: body.default_context?.task_id,
                requesterName: dbUser.displayName || undefined,
              },
              abortSignal: providerAbort.signal,
            });

            if (turnDeadlineHit) {
              recordTurnOutcome("failed", AI_CHAT_TURN_DEADLINE_REASON);
              await endDeadlineTurn();
              return;
            }
            // Deadline wins over the generic cancelled branch: both abort the
            // provider signal, and only the deadline path runs its cleanup.
            if (cancelled || providerAbort.signal.aborted) {
              recordTurnOutcome("cancelled");
              if (heartbeatExecutionId && !heartbeatExecutionTerminal) {
                await failHeartbeatExecution(
                  heartbeatExecutionId,
                  "AI reply cancelled",
                ).catch(() => undefined);
                heartbeatExecutionTerminal = true;
              }
              finish("error", { cancelled: true, content: "Stream cancelled." });
              return;
            }

            const failureMessage =
              fleet.success || fleet.error === "aborted"
                ? null
                : `<p>${escapeHtml(routedAgent.displayName)} could not be reached just now. Try again in a moment.</p>`;
            // The bridge answer is the agent's own words; keep it verbatim
            // (escaped, plain paragraphs) instead of paraphrasing it through
            // the model. ponytail: once the bridge guarantees an HTML reply,
            // render it as-is behind sanitizeAiHtml.
            const replyHtml = fleet.success
              ? fleet.answer
                  .split(/\n{2,}/)
                  .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
                  .join("")
              : failureMessage;

            // Tell the client who is answering before the first content frame,
            // so attribution lands on this message and nothing after it.
            if (fleet.success) {
              send("agent", {
                agentId: routedAgent.id,
                agentName: routedAgent.displayName,
              });
            }

            const chunks = replyHtml ? [replyHtml] : [];
            if (replyHtml) {
              send("content", { content: replyHtml });
            }

            let assistantPersisted = false;
            if (body.session_id && body.assistant_message_id && chunks.length) {
              let completionFenceToken: string | null = null;
              if (streamId) {
                completionFenceToken = await acquireAiChatCompletionFence(
                  streamLease.redis,
                  dbUser.id,
                  body.session_id,
                  streamId,
                  body.assistant_message_id,
                );
                if (!completionFenceToken) {
                  finish("error", {
                    cancelled: true,
                    content: "Stream cancelled.",
                  });
                  return;
                }
              }
              try {
                assistantPersisted = await persistAssistantMessage({
                  db: prisma,
                  messageId: body.assistant_message_id,
                  sessionId: body.session_id,
                  userId: dbUser.id,
                  content: chunks.join(""),
                  linkify: linkifyTicketRefs,
                  // The reply (or the failure sentence) is this agent's turn,
                  // except a failure sentence, which the agent never wrote.
                  authorAgentId: fleet.success ? routedAgent.id : null,
                });
              } catch (error) {
                console.error(
                  "[ai/chat/stream] assistant persistence failed; client will retry",
                  error,
                );
              } finally {
                if (completionFenceToken) {
                  try {
                    if (assistantPersisted) {
                      await finishAiChatCompletionFence(
                        streamLease.redis,
                        dbUser.id,
                        body.session_id,
                        body.assistant_message_id,
                        completionFenceToken,
                      );
                    } else {
                      await releaseAiChatCompletionFence(
                        streamLease.redis,
                        dbUser.id,
                        body.session_id,
                        body.assistant_message_id,
                        completionFenceToken,
                      );
                    }
                  } catch (error) {
                    console.error(
                      "[ai/chat/stream] completion fence will expire automatically",
                      error,
                    );
                  }
                }
              }
            }

            recordTurnOutcome(
              fleet.success ? "ok" : "failed",
              fleet.success ? undefined : fleet.error,
            );

            if (heartbeatExecutionId && !heartbeatExecutionTerminal) {
              if (assistantPersisted) {
                await completeHeartbeatExecution(heartbeatExecutionId);
              } else {
                await failHeartbeatExecution(
                  heartbeatExecutionId,
                  "assistant reply was not persisted",
                );
              }
              heartbeatExecutionTerminal = true;
            }

            finish("complete", {
              user_message_persisted: userMessagePersisted,
              assistant_persisted: assistantPersisted,
            });
            return;
          }
          // Not routable (agent gone from the board): the assistant turn below
          // is exactly the pre-HTPR-6284 behavior for that mention.
        }
        const agentPromptAddition = actingAgent
          ? `You are acting as "${actingAgent.displayName}", a native Hypertask agent. ` +
            `Comments, assignments, moves, and tasks you create are attributed to this ` +
            `agent, not the human you're talking to.` +
            (actingAgent.prompt ? ` Follow these instructions:\n${actingAgent.prompt}` : "")
          : null;
        const instructions = [
          AGENT_SYSTEM_PROMPT,
          skillResolution.systemPromptAddition,
          agentPromptAddition,
        ]
          .filter(Boolean)
          .join("\n\n");
        // Always load the ticket the user is viewing so the chat can answer
        // about "this ticket" without depending on the model choosing to search.
        const currentTaskContext = await loadCurrentTaskContext(
          contextTaskId ? [contextTaskId] : [],
          dbUser.id,
          undefined,
          { projectId: body.default_context?.project_id },
        );
        const messages: ModelMessage[] = [
          {
            role: "user",
            content: createUserContent(resolvedBody, dbUser, currentTaskContext),
          },
        ];
        const toolExecutions: ToolExecution[] = [];
        const tools = buildTools(
          dbUser,
          resolvedBody,
          send,
          (execution) => {
            toolExecutions.push(execution);
          },
          actingAgent?.id ?? null,
          async (toolName) => {
            // Stop is cooperative: an operation already committed cannot be
            // undone, but no later tool may begin after cancellation lands.
            assertAiChatToolCanStart(cancelled, providerAbort.signal);
            const release = body.session_id && streamId
              ? await acquireAiChatToolFence(
                  streamLease.redis,
                  dbUser.id,
                  body.session_id,
                  streamId,
                )
              : undefined;
            try {
              if (heartbeatExecutionId && writeToolNames.has(toolName)) {
                // Persist the unsafe-to-replay boundary BEFORE a mutating tool
                // begins. If Redis cannot record it, the tool does not run.
                await markHeartbeatMutationStarted(heartbeatExecutionId);
              }
              return release;
            } catch (error) {
              await release?.();
              throw error;
            }
          },
          heartbeatTurn?.metadata
        );
        if (
          heartbeatExecutionId &&
          body.session_id &&
          body.user_message_id
        ) {
          // This durable phase flip happens immediately before the model can
          // execute tools. Recovery can retry an unstarted reservation, but
          // never treats a started turn as safe to replay after Redis loss.
          const started = await chatStore().messages.updateMany({
            where: {
              id: body.user_message_id,
              sessionId: body.session_id,
              role: "human",
              content: body.message,
              isDelivered: false,
            },
            data: { isDelivered: true },
          });
          if (started.count !== 1) {
            throw new Error("Heartbeat durable reservation could not start");
          }
        }
        // $ai_latency measures the generation itself, not the turn setup.
        generationStartedAt = Date.now();
        const result = streamText({
          model: selected.model,
          instructions,
          messages,
          tools,
          stopWhen: stepCountIs(MAX_TOOL_STEPS),
          maxRetries: 2,
          abortSignal: providerAbort.signal,
          onFinish: async ({ usage, finishReason }) => {
            turnUsage = {
              inputTokens: usage.inputTokens ?? undefined,
              outputTokens: usage.outputTokens ?? undefined,
            };
            generationFinishedWithError = finishReason === "error";
            await logAiUsage({
              userId: dbUser.id,
              teamId: gatewayTags.teamId ?? null,
              projectId: usageProjectId,
              taskId: contextTaskId,
              // Without this an agent's own turns land as agentId: null, so the
              // team is billed for work nobody can trace back to the agent.
              agentId: actingAgent?.id ?? null,
              provider: selected.usageProvider,
              model: selected.modelId,
              feature: "chat",
              inputTokens: usage.inputTokens ?? 0,
              outputTokens: usage.outputTokens ?? 0,
              totalTokens: usage.totalTokens ?? 0,
            });
          },
          onError: async ({ error }) => {
            recordTurnOutcome(cancelled ? "cancelled" : "failed", error);
            if (errorSent) return;
            errorSent = true;
            if (cancelled) {
              if (heartbeatExecutionId) {
                await failHeartbeatExecution(
                  heartbeatExecutionId,
                  "AI reply cancelled",
                );
                heartbeatExecutionTerminal = true;
              }
              finish("error", { cancelled: true, content: "Stream cancelled." });
              return;
            }
            if (turnDeadlineHit) {
              await endDeadlineTurn();
              return;
            }
            // This is the only path that can end the turn with no assistant
            // message ever persisted (every other exit reaches
            // persistAssistantMessage, even the empty-completion fallback).
            // A tool can execute before the model errors out, so callers
            // that infer "nothing happened" from an absent reply (the
            // native-agent heartbeat's retry logic) need this flag to avoid
            // re-sending the same instructions and replaying that write.
            send("error", {
              content: userFacingErrorMessage(error, "model-stream"),
              toolsExecuted: toolExecutions.length > 0,
              ...userFacingErrorDetails(error, gatewayTags.teamId ?? null),
            });
            finish("error");
            if (heartbeatExecutionId) {
              await failHeartbeatExecution(
                heartbeatExecutionId,
                errorMessage(error)
              );
              heartbeatExecutionTerminal = true;
            }
            await reportHandledChatError(error, "model-stream", {
              model: selected.resolvedModelId,
              provider: selected.usageProvider,
            });
          },
          providerOptions: selected.providerOptions,
          ...selected.settings,
        });

        const chunks: string[] = [];
        for await (const chunk of result.textStream) {
          if (errorSent || cancelled) break;
          if (!chunk) continue;
          chunks.push(chunk);
          send("content", { content: chunk });
        }

        if (errorSent || cancelled) return;

        // GPT-5.5 (especially Instant / low effort) can return an empty completion
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
          if (errorSent) return;
          const ranTools = Array.isArray(toolCalls) && toolCalls.length > 0;
          if (!ranTools && !cancelled && !providerAbort.signal.aborted) {
            try {
              const retry = await generateText({
                model: selected.model,
                instructions,
                messages,
                tools,
                stopWhen: stepCountIs(MAX_TOOL_STEPS),
                maxRetries: 1,
                abortSignal: providerAbort.signal,
                providerOptions: withHigherEffort(selected.providerOptions),
                ...selected.settings,
              });
              reachedStepLimit =
                reachedStepLimit || retry.steps.length >= MAX_TOOL_STEPS;
              turnUsage = {
                inputTokens:
                  (turnUsage?.inputTokens ?? 0) + (retry.usage.inputTokens ?? 0),
                outputTokens:
                  (turnUsage?.outputTokens ?? 0) + (retry.usage.outputTokens ?? 0),
              };
              await logAiUsage({
                userId: dbUser.id,
                teamId: gatewayTags.teamId ?? null,
                projectId: usageProjectId,
                taskId: contextTaskId,
                agentId: actingAgent?.id ?? null,
                provider: selected.usageProvider,
                model: selected.modelId,
                feature: "chat",
                inputTokens: retry.usage.inputTokens ?? 0,
                outputTokens: retry.usage.outputTokens ?? 0,
                totalTokens: retry.usage.totalTokens ?? 0,
              });
              const retryText = retry.text?.trim() ?? "";
              if (retryText) {
                generationFinishedWithError = retry.finishReason === "error";
                chunks.push(retryText);
                send("content", { content: retryText });
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
        if (errorSent) return;
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
          send("content", { content: fallback });
          chunks.push(fallback);
          recordTurnOutcome(
            "failed",
            emptyCompletionError ?? "AI generation returned no visible reply",
          );
        } else if (generationFinishedWithError) {
          recordTurnOutcome("failed", "AI generation finished with an error");
        } else {
          recordTurnOutcome("ok");
        }

        // The provider/tool phase is over: a deadline from here on must not
        // misclassify a persist-phase failure as a timeout.
        turnDeadline?.clear();

        let completionFenceToken: string | null = null;
        let stopCompletionFenceRenewal: (() => Promise<void>) | null = null;
        if (body.session_id && streamId && body.assistant_message_id) {
          completionFenceToken = await acquireAiChatCompletionFence(
            streamLease.redis,
            dbUser.id,
            body.session_id,
            streamId,
            body.assistant_message_id,
          );
          if (!completionFenceToken) {
            cancelled = true;
            providerAbort.abort("User stopped this reply before persistence");
            finish("error", { cancelled: true, content: "Stream cancelled." });
            return;
          }
          stopCompletionFenceRenewal = keepAiChatCompletionFenceAlive(
            streamLease.redis,
            dbUser.id,
            body.session_id,
            body.assistant_message_id,
            completionFenceToken,
          );
        }

        let assistantPersisted = false;
        if (body.session_id && body.assistant_message_id) {
          try {
            assistantPersisted = await persistAssistantMessage({
              db: prisma,
              messageId: body.assistant_message_id,
              sessionId: body.session_id,
              userId: dbUser.id,
              content: chunks.join(""),
              linkify: linkifyTicketRefs,
            });
          } catch (error) {
            console.error(
              "[ai/chat/stream] assistant persistence failed; client will retry",
              error,
            );
          } finally {
            if (completionFenceToken) {
              try {
                await stopCompletionFenceRenewal?.();
                if (assistantPersisted) {
                  await finishAiChatCompletionFence(
                    streamLease.redis,
                    dbUser.id,
                    body.session_id,
                    body.assistant_message_id,
                    completionFenceToken,
                  );
                } else {
                  await releaseAiChatCompletionFence(
                    streamLease.redis,
                    dbUser.id,
                    body.session_id,
                    body.assistant_message_id,
                    completionFenceToken,
                  );
                }
              } catch (error) {
                // Persistence already has its own durable outcome. Redis
                // cleanup must never turn that outcome into a retryable write.
                console.error(
                  "[ai/chat/stream] completion fence will expire automatically",
                  error,
                );
              }
            }
          }
        }

        if (heartbeatExecutionId) {
          if (assistantPersisted) {
            await completeHeartbeatExecution(heartbeatExecutionId);
          } else {
            await failHeartbeatExecution(
              heartbeatExecutionId,
              "assistant reply was not persisted"
            );
          }
          heartbeatExecutionTerminal = true;
        }

        // The completed reply is durable before title enrichment begins. A
        // title-provider or metadata-write failure must never cost the answer.
        if (firstTurn) {
          const generatedTitle = await generateConversationTitle(
            chunks.join(""),
            skillResolution.cleanedText,
            titleByokApiKey,
            gatewayTags,
            {
              userId: dbUser.id,
              projectId: usageProjectId,
              taskId: contextTaskId,
              agentId: actingAgent?.id ?? null,
            },
            providerAbort.signal,
          );
          if (generatedTitle) {
            send("title", { content: generatedTitle });
            if (body.session_id) {
              try {
                await chatStore().sessions.updateMany({
                  where: { id: body.session_id, userId: dbUser.id },
                  data: { title: generatedTitle },
                });
              } catch (error) {
                console.error(
                  "[ai/chat/stream] title persistence failed after reply persistence",
                  error,
                );
              }
            }
          }
        }

        finish("complete", {
          user_message_persisted: userMessagePersisted,
          assistant_persisted: assistantPersisted,
        });
      } catch (error) {
        recordTurnOutcome(cancelled ? "cancelled" : "failed", error);
        if (cancelled) {
          if (!doneSent) {
            finish("error", { cancelled: true, content: "Stream cancelled." });
          }
          return;
        }
        // The deadline abort lands here as an iterator error. Its own message,
        // persistence, heartbeat, and diagnostics already ran (or run here
        // once); the generic handler must not report the abort again.
        if (turnDeadlineHit) {
          if (!errorSent) {
            errorSent = true;
            await endDeadlineTurn();
          }
          return;
        }
        console.error("[ai/chat/stream] stream error", error);
        await reportHandledChatError(error, "stream-handler", {
          model: selected.resolvedModelId,
          provider: selected.usageProvider,
        });
        if (!errorSent) {
          errorSent = true;
          send("error", {
            content: userFacingErrorMessage(error, "stream-handler"),
            ...userFacingErrorDetails(error, gatewayTags.teamId ?? null),
          });
          finish("error");
        }
        if (heartbeatExecutionId && !heartbeatExecutionTerminal) {
          await failHeartbeatExecution(
            heartbeatExecutionId,
            errorMessage(error)
          ).catch(() => undefined);
          heartbeatExecutionTerminal = true;
        }
      } finally {
        // Every model exit above names its outcome before reaching here. This
        // only covers a turn that ended before the model ever ran, and records
        // it only when cancellation gives it a real terminal outcome.
        if (cancelled) recordTurnOutcome("cancelled");
        turnDeadline?.clear();
        stopCancellationWatch();
        await releaseAiChatStreamLease(streamLease);
      }
    },
    cancel() {
      // Do not abort the model request. The server owns completion and
      // persistence so a mobile tab can be suspended or evicted safely.
      clientConnected = false;
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
