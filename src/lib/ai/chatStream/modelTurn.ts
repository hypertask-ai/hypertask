

import { renderPrompt } from "@/lib/ai/prompts/registry";
import { HTPR_7514_INLINE_AGENT_IMAGES_FLAG } from "@/lib/flags/keys";
import prisma from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7756_CHAT_OPENS_TASK_FLAG, HTPR_7363_CHAT_TASK_WRITER_FLAG } from "@/lib/flags/keys";

import { loadCurrentTaskContext } from "@/app/api/ai/_lib/currentTaskContext";
import { type ModelMessage } from "ai";

import { acquireAiChatCompletionFence, finishAiChatCompletionFence, releaseAiChatCompletionFence, assertAiChatToolCanStart, acquireAiChatToolFence, keepAiChatCompletionFenceAlive } from "@/app/api/ai/chat/stream/streamLease";
import { failHeartbeatExecution, completeHeartbeatExecution, markHeartbeatMutationStarted } from "@/app/api/ai/_lib/heartbeatExecution";
import { persistAssistantMessage } from "@/app/api/ai/chat/stream/persistAssistantMessage";
import { linkifyTicketRefs } from "@/utils/controllers/comments/linkifyTicketRefs";

import { resolveSkillsForAiRequest } from "@/app/api/ai/_lib/chatSkillResolution";

import { ChatRequest } from "@/lib/ai/chatStream/request";
import { ToolExecution } from "@/lib/ai/chatStream/types";

import { AGENT_SYSTEM_PROMPT } from "@/lib/ai/chatStream/prompt";
import { aiPromptCachingEnabled, configureAiModelUsage } from "@/app/api/ai/_lib/modelProvider";
import { createUserContent } from "@/lib/ai/chatStream/content";
import { writeToolNames } from "@/lib/ai/tools/metadata";
import { generateConversationTitle } from "@/lib/ai/chatStream/title";
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
  const chatOpensTaskEnabled = await isFeatureEnabled(HTPR_7756_CHAT_OPENS_TASK_FLAG, dbUser.id);
  const instructions = [
    AGENT_SYSTEM_PROMPT,
    chatOpensTaskEnabled ? "When the user asks to open a task, including one from a previous list, call hypertask_get_tasks with open=true and exactly that task. This is navigation, not detail enrichment. Do not say Opened or claim navigation happened before the tool returns navigation_emitted=true. If it fails or no navigation was emitted, say you could not open the task." : null,
    inlineAgentImagesEnabled ? renderPrompt("inline-agent-images") : null,
    skillResolution.systemPromptAddition,
    agentPromptAddition,
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
  });
  const promptCachingEnabled = await aiPromptCachingEnabled(state.selected.model);
  const messages: ModelMessage[] = [
    {
      role: "user",
      content: createUserContent(resolvedBody, dbUser, currentTaskContext, promptCachingEnabled),
    },
  ];
  const toolExecutions: ToolExecution[] = [];
  const tools = buildTools(
    dbUser,
    resolvedBody,
    state.send,
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
    actingAgent ? actingAgent.teamScope : null
  );
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
  const reply = await generateModelReply(state, { instructions, messages, tools, toolExecutions });
  if (!reply) return;
  const { chunks } = reply;

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

  state.finish("complete", {
    user_message_persisted: userMessagePersisted,
    assistant_persisted: assistantPersisted,
  });
}
