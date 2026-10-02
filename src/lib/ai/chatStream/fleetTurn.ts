

import prisma from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_6284_AGENT_MENTION_ROUTING_FLAG } from "@/lib/flags/keys";

import { AI_CHAT_TURN_DEADLINE_REASON, acquireAiChatCompletionFence, finishAiChatCompletionFence, releaseAiChatCompletionFence } from "@/app/api/ai/chat/stream/streamLease";
import { failHeartbeatExecution, completeHeartbeatExecution } from "@/app/api/ai/_lib/heartbeatExecution";
import { persistAssistantMessage } from "@/app/api/ai/chat/stream/persistAssistantMessage";
import { linkifyTicketRefs } from "@/utils/controllers/comments/linkifyTicketRefs";

import { decideAgentMentionRouting, extractMentionedAgentIds } from "@/app/api/ai/chat/stream/agentMention";
import { getAccessibleAgentBoard, getBoardAgentMembers } from "@/utils/controllers/agents/boardMembers";
import { askFleetAgent } from "@/app/api/ai/chat/stream/fleetAsk";
import { escapeHtml } from "@/utils/helperFunctions/escapeHtml";

import { ChatRequest } from "@/lib/ai/chatStream/request";

import type { StreamState } from "./streamState";

export async function routeAgentMention(state: StreamState, resolvedBody: ChatRequest) {
  const { body, dbUser, heartbeatExecutionId, userMessagePersisted, actingAgent, streamId, streamLease } = state;

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
      state.send("status", {
        content: `Asking ${routedAgent.displayName}...`,
      });
      state.generationStartedAt = Date.now();
      state.observedAgentId = routedAgent.id;
      state.observedModel = "fleet-agent";
      state.observedProvider = "hypertask";
      const fleet = await askFleetAgent({
        agentId: routedAgent.id,
        question: resolvedBody.message,
        context: {
          boardId: routedBoardId,
          taskId: body.default_context?.task_id,
          requesterName: dbUser.displayName || undefined,
        },
        abortSignal: state.providerAbort.signal,
      });

      if (state.turnDeadlineHit) {
        state.recordTurnOutcome("failed", AI_CHAT_TURN_DEADLINE_REASON);
        await state.endDeadlineTurn();
        return true;
      }
      // Deadline wins over the generic cancelled branch: both abort the
      // provider signal, and only the deadline path runs its cleanup.
      if (state.cancelled || state.providerAbort.signal.aborted) {
        state.recordTurnOutcome("cancelled");
        if (heartbeatExecutionId && !state.heartbeatExecutionTerminal) {
          await failHeartbeatExecution(
            heartbeatExecutionId,
            "AI reply cancelled",
          ).catch(() => undefined);
          state.heartbeatExecutionTerminal = true;
        }
        state.finish("error", { cancelled: true, content: "Stream cancelled." });
        return true;
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
        state.send("agent", {
          agentId: routedAgent.id,
          agentName: routedAgent.displayName,
        });
      }

      const chunks = replyHtml ? [replyHtml] : [];
      if (replyHtml) {
        state.send("content", { content: replyHtml });
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
            state.finish("error", {
              cancelled: true,
              content: "Stream cancelled.",
            });
            return true;
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

      state.recordTurnOutcome(
        fleet.success ? "ok" : "failed",
        fleet.success ? undefined : fleet.error,
      );

      if (heartbeatExecutionId && !state.heartbeatExecutionTerminal) {
        if (assistantPersisted) {
          await completeHeartbeatExecution(heartbeatExecutionId);
        } else {
          await failHeartbeatExecution(
            heartbeatExecutionId,
            "assistant reply was not persisted",
          );
        }
        state.heartbeatExecutionTerminal = true;
      }

      state.finish("complete", {
        user_message_persisted: userMessagePersisted,
        assistant_persisted: assistantPersisted,
      });
      return true;
    }
    // Not routable (agent gone from the board): the assistant turn below
    // is exactly the pre-HTPR-6284 behavior for that mention.
  }
  return false;
}
