import { HTPR_7683_AI_CHAT_TICKET_ROWS_FLAG } from "@/lib/flags/definitions/htpr-7683-ai-chat-ticket-rows";
import { hydrateTicketGroups } from "./ticketGroups";
import { TICKET_ROWS_PROMPT } from "@/lib/ai/tools/showTicketRows";
import type { ChatTicketGroupReferences } from "@/models/model";


import { renderPrompt } from "@/lib/ai/prompts/registry";
import { HTPR_7622_AI_SETTINGS_FLAG } from "@/lib/flags/definitions/htpr-7622-ai-settings";
import { settingsPages, type SettingProposalCard } from "@/lib/ai/settings/catalog";
import { HTPR_7514_INLINE_AGENT_IMAGES_FLAG, HTPR_7755_BULK_PREVIEW_CONFIRMATION_FLAG, HTPR_7761_CHAT_IMAGE_URLS_FLAG } from "@/lib/flags/keys";
import prisma from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7756_CHAT_OPENS_TASK_FLAG, HTPR_7363_CHAT_TASK_WRITER_FLAG, HTPR_7760_CHAT_SURFACE_FLAG } from "@/lib/flags/keys";

import { loadCurrentTaskContext } from "@/app/api/ai/_lib/currentTaskContext";
import { type ModelMessage } from "ai";

import { acquireAiChatCompletionFence, finishAiChatCompletionFence, releaseAiChatCompletionFence, assertAiChatToolCanStart, acquireAiChatToolFence, keepAiChatCompletionFenceAlive } from "@/app/api/ai/chat/stream/streamLease";
import { failHeartbeatExecution, completeHeartbeatExecution, markHeartbeatMutationStarted } from "@/app/api/ai/_lib/heartbeatExecution";
import { persistAssistantMessage } from "@/app/api/ai/chat/stream/persistAssistantMessage";
import { linkifyTicketRefs } from "@/utils/controllers/comments/linkifyTicketRefs";

import { resolveSkillsForAiRequest } from "@/app/api/ai/_lib/chatSkillResolution";

import { ChatRequest } from "@/lib/ai/chatStream/request";
import { ToolExecution } from "@/lib/ai/chatStream/types";

import { AGENT_SYSTEM_PROMPT, PRODUCT_ANSWERS_FROM_DOCS_PROMPT, chatSurfacePrompt } from "@/lib/ai/chatStream/prompt";
import { HTPR_7780_DOCS_ROUTING_FLAG } from "@/lib/flags/definitions/htpr-7780-docs-routing";
import { aiPromptCachingEnabled, configureAiModelUsage } from "@/app/api/ai/_lib/modelProvider";
import { createUserContent, createImageAwareUserContent } from "@/lib/ai/chatStream/content";
import { writeToolNames } from "@/lib/ai/tools/metadata";
import { generateConversationTitle } from "@/lib/ai/chatStream/title";
import { HTPR_7768_CHAT_SKILL_DRAFTS_FLAG } from "@/lib/flags/keys";
import { buildTools } from "@/lib/ai/tools";
import type { StreamState } from "./streamState";

import { generateModelReply } from "./modelReply";
import { nameChatFromFirstMessage } from "./chatNames";

export async function runModelTurn(state: StreamState, resolvedBody: ChatRequest, skillResolution: Awaited<ReturnType<typeof resolveSkillsForAiRequest>>) {
  const { body, dbUser, heartbeatExecutionId, heartbeatTurn, userMessagePersisted, contextTaskId, titleByokApiKey, gatewayTags, usageProjectId, actingAgent, streamId, streamLease, firstTurn, requestMessage } = state;

  const chatNameGuardTitle = await nameChatFromFirstMessage({ enabled: firstTurn && !heartbeatTurn, sessionId: body.session_id, userId: dbUser.id, message: requestMessage });

  const agentPromptAddition = actingAgent
    ? `You are acting as "${actingAgent.displayName}", a native Hypertask agent. ` +
    `Comments, assignments, moves, and tasks you create are attributed to this ` +
    `agent, not the human you're talking to.` +
    (actingAgent.prompt ? ` Follow these instructions:\n${actingAgent.prompt}` : "")
    : null;
  const inlineAgentImagesEnabled = await isFeatureEnabled(HTPR_7514_INLINE_AGENT_IMAGES_FLAG, dbUser.id);
  const docsRoutingEnabled = await isFeatureEnabled(HTPR_7780_DOCS_ROUTING_FLAG, dbUser.id);
  const settingsEnabled = !actingAgent && !!resolvedBody.settings_context && await isFeatureEnabled(HTPR_7622_AI_SETTINGS_FLAG, dbUser.id);
  const settingsScope = settingsEnabled ? resolvedBody.settings_context : undefined;
  const chatOpensTaskEnabled = await isFeatureEnabled(HTPR_7756_CHAT_OPENS_TASK_FLAG, dbUser.id);
  const bulkScopeConfirmationEnabled = await isFeatureEnabled(HTPR_7755_BULK_PREVIEW_CONFIRMATION_FLAG, dbUser.id);
  const skillDraftsEnabled = await isFeatureEnabled(HTPR_7768_CHAT_SKILL_DRAFTS_FLAG, dbUser.id);
  const ticketRowsEnabled = Boolean(body.session_id && body.assistant_message_id) && await isFeatureEnabled(HTPR_7683_AI_CHAT_TICKET_ROWS_FLAG, dbUser.id);
  let ticketGroups: ChatTicketGroupReferences | undefined;
  const instructions = [
    AGENT_SYSTEM_PROMPT,
    docsRoutingEnabled ? PRODUCT_ANSWERS_FROM_DOCS_PROMPT : null,
    skillDraftsEnabled ? renderPrompt("chat-skill-drafts") : null,
    chatOpensTaskEnabled ? "When the user asks to open a task, including one from a previous list, call hypertask_get_tasks with open=true and exactly that task. This is navigation, not detail enrichment. Do not say Opened or claim navigation happened before the tool returns navigation_emitted=true. If it fails or no navigation was emitted, say you could not open the task." : null,
    settingsScope ? `The person is in Settings, section ${settingsScope.section}: ${settingsPages[settingsScope.section]}. Use hypertask_settings to read current values before proposing one change. You can propose theme, notification category/channel and board roles only on their open page. Every change requires the app's Apply/Cancel card; never apply through any other action or claim it is done. The app renders the real card; do not fabricate buttons or review links. For unsupported changes, explain the location and use open. The page catalog covers nearby settings, but other pages' values and actions require navigating there first. This Settings scope overrides unrelated board/task instructions.` : null,
    resolvedBody.surface && await isFeatureEnabled(HTPR_7760_CHAT_SURFACE_FLAG, dbUser.id)
      ? chatSurfacePrompt(resolvedBody.surface)
      : null,
    bulkScopeConfirmationEnabled
      ? "For bulk task updates, assignments, unassignments and comments: preview EVERY batch with confirmed: false before asking the user once for the full list. A confirmation_required response ends execution, but not collection of the remaining previews in that turn. After the user approves in a later message, call each previewed batch directly with confirmed: true; do not issue a fresh preview or ask again for unchanged tasks and changes. Repartitioning the same previewed list into internal batches does not require another yes. If tasks or changes differ, preview the changed scope and ask again."
      : null,
    inlineAgentImagesEnabled ? renderPrompt("inline-agent-images") : null,
    skillResolution.systemPromptAddition,
    agentPromptAddition,
    ticketRowsEnabled ? TICKET_ROWS_PROMPT : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  const currentTaskContext = await loadCurrentTaskContext(
    contextTaskId ? [contextTaskId] : [],
    dbUser.id,
    undefined,
    { projectId: body.default_context?.project_id },
  );
  configureAiModelUsage(state.selected.model, {
    initiatingUserId: dbUser.id,
    trustedChatSessionId: state.trustedChatSessionId,
    feature: "chat",
  });
  const promptCachingEnabled = await aiPromptCachingEnabled(state.selected.model);
  const messages: ModelMessage[] = [
    {
      role: "user",
      content: await isFeatureEnabled(HTPR_7761_CHAT_IMAGE_URLS_FLAG, dbUser.id)
        ? await createImageAwareUserContent(resolvedBody, dbUser, currentTaskContext, state.selected.resolvedModelId, state.providerAbort.signal, promptCachingEnabled)
        : createUserContent(resolvedBody, dbUser, currentTaskContext, promptCachingEnabled),
    },
  ];
  const toolExecutions: ToolExecution[] = [];
  const taskProgress: string[] = [];
  const streamedContent: string[] = [];
  const catalogTools = buildTools(
    dbUser,
    resolvedBody,
    (event, data) => {
      if (event === "task_created" && typeof data.content === "string") {
        taskProgress.push(data.content);
        streamedContent.push(data.content);
      }
      return state.send(event, data);
    },
    (execution) => {
      toolExecutions.push(execution);
    },
    actingAgent?.id ?? null,
    async (toolName) => {
      assertAiChatToolCanStart(state.cancelled, state.providerAbort.signal);
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
          await markHeartbeatMutationStarted(heartbeatExecutionId);
        }
        return release;
      } catch (error) {
        await release?.();
        throw error;
      }
    },
    heartbeatTurn?.metadata,
    await isFeatureEnabled(HTPR_7363_CHAT_TASK_WRITER_FLAG, dbUser.id),
    state.providerAbort.signal,
    inlineAgentImagesEnabled,
    actingAgent ? actingAgent.teamScope : null,
    bulkScopeConfirmationEnabled,
    skillDraftsEnabled,
    ticketRowsEnabled ? { executions: toolExecutions, setGroups: (groups) => { ticketGroups = groups; } } : undefined,
    docsRoutingEnabled,
  );
  const tools = settingsEnabled
    ? Object.fromEntries(Object.entries(catalogTools).filter(([name]) => name === "hypertask_settings"))
    : ticketRowsEnabled ? catalogTools
      : Object.fromEntries(Object.entries(catalogTools).filter(([name]) => name !== "hypertask_show_ticket_rows"));
  if (
    heartbeatExecutionId &&
    body.session_id &&
    body.user_message_id
  ) {
    const started = await prisma.chatMessage.updateMany({
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
  state.generationStartedAt = Date.now();
  let reply: Awaited<ReturnType<typeof generateModelReply>> = undefined;
  let replyFailure: { error: unknown } | undefined;
  try {
    reply = await generateModelReply(state, { instructions, messages, tools, toolExecutions, onContent: (content) => streamedContent.push(content) });
  } catch (error) {
    if (!taskProgress.length) throw error;
    replyFailure = { error };
  }
  if (!reply && !taskProgress.length) return;
  const chunks = taskProgress.length ? streamedContent : reply?.chunks ?? [];
  if (!reply) chunks.push("<p>Reply stopped. Your saved ticket remains.</p>");
  if (settingsEnabled) {
    const result = toolExecutions.find((execution) => execution.name === "hypertask_settings" && (execution.result as { proposal?: SettingProposalCard })?.proposal)?.result as { proposal: SettingProposalCard } | undefined;
    if (result?.proposal) {
      const card = `<p><a href="/settings/ai-change/${result.proposal.id}">Review setting change</a></p>`;
      chunks.push(card);
      state.send("content", { content: card });
    }
  }

  const ticketRowsAllowed = reply?.ticketRowsAllowed ?? false;
  state.turnDeadline?.clear();

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
      state.cancelled = true;
      state.providerAbort.abort("User stopped this reply before persistence");
      state.finish("error", { cancelled: true, content: "Stream cancelled." });
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
        ...(ticketGroups && ticketRowsAllowed ? { ticketGroups } : {}),
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
          console.error(
            "[ai/chat/stream] completion fence will expire automatically",
            error,
          );
        }
      }
    }
  }

  if (replyFailure) throw replyFailure.error;
  if (!reply) return;

  if (heartbeatExecutionId) {
    if (assistantPersisted) {
      await completeHeartbeatExecution(heartbeatExecutionId);
    } else {
      await failHeartbeatExecution(
        heartbeatExecutionId,
        "assistant reply was not persisted"
      );
    }
    state.heartbeatExecutionTerminal = true;
  }

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
      state.providerAbort.signal,
    );
    if (generatedTitle && chatNameGuardTitle !== null) {
      state.send("title", { content: generatedTitle });
      if (body.session_id) {
        try {
          await prisma.chatSession.updateMany({
            where: { id: body.session_id, userId: dbUser.id, ...(chatNameGuardTitle === undefined ? {} : { title: chatNameGuardTitle }) },
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

  let hydratedTicketGroups;
  if (assistantPersisted && ticketGroups && ticketRowsAllowed) {
    try {
      hydratedTicketGroups = await hydrateTicketGroups(ticketGroups.groups, dbUser.id, actingAgent);
    } catch (error) {
      console.error("[ai/chat/stream] ticket row hydration failed", error);
    }
  }

  state.finish("complete", {
    user_message_persisted: userMessagePersisted,
    assistant_persisted: assistantPersisted,
    ...(hydratedTicketGroups ? { ticketGroups: hydratedTicketGroups } : {}),
  });
}
