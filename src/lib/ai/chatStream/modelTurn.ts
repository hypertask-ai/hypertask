

import prisma from "@/lib/prisma";

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
import { createUserContent } from "@/lib/ai/chatStream/content";
import { writeToolNames } from "@/lib/ai/tools/metadata";
import { generateConversationTitle } from "@/lib/ai/chatStream/title";
import { buildTools } from "@/lib/ai/tools";
import type { StreamState } from "./streamState";

import { generateModelReply } from "./modelReply";

export async function runModelTurn(state: StreamState, resolvedBody: ChatRequest, skillResolution: Awaited<ReturnType<typeof resolveSkillsForAiRequest>>) {
  const { body, dbUser, heartbeatExecutionId, heartbeatTurn, userMessagePersisted, contextTaskId, titleByokApiKey, gatewayTags, usageProjectId, actingAgent, streamId, streamLease, firstTurn, chatNameGuardTitle } = state;

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
    state.send,
    (execution) => {
      toolExecutions.push(execution);
    },
    actingAgent?.id ?? null,
    async (toolName) => {
      // Stop is cooperative: an operation already committed cannot be
      // undone, but no later tool may begin after cancellation lands.
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
  // $ai_latency measures the generation itself, not the turn setup.
  state.generationStartedAt = Date.now();
  const reply = await generateModelReply(state, { instructions, messages, tools, toolExecutions });
  if (!reply) return;
  const { chunks } = reply;

  // The provider/tool phase is over: a deadline from here on must not
  // misclassify a persist-phase failure as a timeout.
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
    state.heartbeatExecutionTerminal = true;
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
